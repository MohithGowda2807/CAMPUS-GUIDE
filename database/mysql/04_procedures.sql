-- =============================================================================
-- RVCE Campus Navigation & Visitor Management System
-- Transactional Stored Procedures & Operational Analytics (MySQL 8.0+)
-- =============================================================================

USE campusguide;

DROP PROCEDURE IF EXISTS sp_register_visitor_pass;
DROP PROCEDURE IF EXISTS sp_record_gate_action;
DROP PROCEDURE IF EXISTS sp_activate_floor_plan;
DROP PROCEDURE IF EXISTS sp_expire_faculty_statuses;
DROP PROCEDURE IF EXISTS sp_campus_operations_summary;

DELIMITER $$

-- 1. Atomic Visitor Registration & Pass Generation
CREATE PROCEDURE sp_register_visitor_pass(
    IN p_full_name VARCHAR(120),
    IN p_contact_phone VARCHAR(20),
    IN p_contact_email VARCHAR(150),
    IN p_organization VARCHAR(150),
    IN p_campus_id INT,
    IN p_destination_building_id INT,
    IN p_destination_room_id INT,
    IN p_host_staff_id INT,
    IN p_purpose VARCHAR(255),
    IN p_gate_name VARCHAR(60),
    IN p_requires_host_approval BOOLEAN,
    IN p_registered_by_user_id INT,
    OUT o_visit_id INT,
    OUT o_pass_code VARCHAR(30)
)
BEGIN
    DECLARE v_visitor_id INT DEFAULT NULL;
    DECLARE v_approval ENUM('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED');
    DECLARE v_daily_seq INT DEFAULT 1;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;
    SET @current_app_user_id = p_registered_by_user_id;

    -- Reuse existing visitor identity when name + phone match
    SELECT visitor_id INTO v_visitor_id
    FROM visitors
    WHERE contact_phone = p_contact_phone
      AND LOWER(TRIM(full_name)) = LOWER(TRIM(p_full_name))
    ORDER BY visitor_id DESC
    LIMIT 1;

    IF v_visitor_id IS NULL THEN
        INSERT INTO visitors (full_name, contact_phone, contact_email, organization)
        VALUES (TRIM(p_full_name), TRIM(p_contact_phone), NULLIF(TRIM(p_contact_email), ''), NULLIF(TRIM(p_organization), ''));
        SET v_visitor_id = LAST_INSERT_ID();
    ELSE
        UPDATE visitors
        SET contact_email = COALESCE(NULLIF(TRIM(p_contact_email), ''), contact_email),
            organization = COALESCE(NULLIF(TRIM(p_organization), ''), organization)
        WHERE visitor_id = v_visitor_id;
    END IF;

    SELECT COUNT(*) + 1 INTO v_daily_seq
    FROM visitor_logs
    WHERE DATE(created_at) = CURRENT_DATE;

    SET o_pass_code = CONCAT('RVCE-', DATE_FORMAT(CURRENT_TIMESTAMP, '%Y%m%d'), '-', LPAD(v_daily_seq, 4, '0'));
    SET v_approval = IF(p_requires_host_approval AND p_host_staff_id IS NOT NULL, 'PENDING', 'NOT_REQUIRED');

    INSERT INTO visitor_logs (
        visit_pass_code,
        visitor_id,
        campus_id,
        destination_building_id,
        destination_room_id,
        host_staff_id,
        purpose,
        gate_name,
        approval_status,
        visit_status,
        registered_by_user_id
    ) VALUES (
        o_pass_code,
        v_visitor_id,
        p_campus_id,
        p_destination_building_id,
        p_destination_room_id,
        p_host_staff_id,
        TRIM(p_purpose),
        COALESCE(NULLIF(TRIM(p_gate_name), ''), 'Main Mysuru Road Gate'),
        v_approval,
        'REGISTERED',
        p_registered_by_user_id
    );

    SET o_visit_id = LAST_INSERT_ID();
    COMMIT;
END$$

-- 2. Gate Checkpoint & Host Decision Transition Procedure
CREATE PROCEDURE sp_record_gate_action(
    IN p_visit_id INT,
    IN p_action VARCHAR(25),
    IN p_actor_user_id INT,
    IN p_gate_name VARCHAR(60)
)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;
    SET @current_app_user_id = p_actor_user_id;

    CASE UPPER(p_action)
        WHEN 'CHECK_IN' THEN
            UPDATE visitor_logs
            SET visit_status = 'CHECKED_IN',
                check_in_at = CURRENT_TIMESTAMP,
                checked_in_by_user_id = p_actor_user_id,
                gate_name = COALESCE(NULLIF(TRIM(p_gate_name), ''), gate_name)
            WHERE visit_id = p_visit_id;

        WHEN 'CHECK_OUT' THEN
            UPDATE visitor_logs
            SET visit_status = 'CHECKED_OUT',
                check_out_at = CURRENT_TIMESTAMP,
                checked_out_by_user_id = p_actor_user_id
            WHERE visit_id = p_visit_id;

        WHEN 'APPROVE_HOST' THEN
            UPDATE visitor_logs
            SET approval_status = 'APPROVED'
            WHERE visit_id = p_visit_id;

        WHEN 'REJECT_HOST' THEN
            UPDATE visitor_logs
            SET approval_status = 'REJECTED',
                visit_status = IF(visit_status = 'REGISTERED', 'CANCELLED', visit_status)
            WHERE visit_id = p_visit_id;

        WHEN 'CANCEL' THEN
            UPDATE visitor_logs
            SET visit_status = 'CANCELLED'
            WHERE visit_id = p_visit_id
              AND visit_status = 'REGISTERED';

        ELSE
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Unsupported gate action requested.';
    END CASE;

    COMMIT;
END$$

-- 3. Atomic Floor Plan Version Activation (Supersedes previous active plan)
CREATE PROCEDURE sp_activate_floor_plan(
    IN p_floor_plan_id INT,
    IN p_approver_user_id INT
)
BEGIN
    DECLARE v_floor_id INT DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;
    SET @current_app_user_id = p_approver_user_id;

    SELECT floor_id INTO v_floor_id
    FROM floor_plans
    WHERE floor_plan_id = p_floor_plan_id
    FOR UPDATE;

    IF v_floor_id IS NULL THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Requested floor plan record does not exist.';
    END IF;

    -- Supersede any previously active public plan for the same floor
    UPDATE floor_plans
    SET is_active_public = FALSE,
        approval_status = IF(approval_status = 'APPROVED', 'SUPERSEDED', approval_status)
    WHERE floor_id = v_floor_id
      AND floor_plan_id <> p_floor_plan_id
      AND is_active_public = TRUE;

    -- Approve & activate target plan
    UPDATE floor_plans
    SET approval_status = 'APPROVED',
        is_active_public = TRUE,
        approved_by_user_id = p_approver_user_id,
        approved_at = CURRENT_TIMESTAMP
    WHERE floor_plan_id = p_floor_plan_id;

    INSERT INTO change_audit_log (user_id, action_type, table_name, record_id, old_value, new_value)
    VALUES (
        p_approver_user_id,
        'STATE_TRANSITION',
        'floor_plans',
        p_floor_plan_id,
        NULL,
        JSON_OBJECT('floor_id', v_floor_id, 'approval_status', 'APPROVED', 'is_active_public', TRUE)
    );

    COMMIT;
END$$

-- 4. Expire Stale Faculty Availability Records
CREATE PROCEDURE sp_expire_faculty_statuses(OUT o_expired_count INT)
BEGIN
    UPDATE faculty_availability
    SET availability_state = 'UNKNOWN',
        source_type = 'SYSTEM_EXPIRED',
        public_note = NULL
    WHERE valid_until IS NOT NULL
      AND valid_until < CURRENT_TIMESTAMP
      AND availability_state <> 'UNKNOWN';

    SET o_expired_count = ROW_COUNT();
END$$

-- 5. Multi-Dimensional Campus Operations & Visitor Summary Report
CREATE PROCEDURE sp_campus_operations_summary(
    IN p_from_date DATE,
    IN p_to_date DATE
)
BEGIN
    -- Result Set 1: Overall KPI counts
    SELECT
        (SELECT COUNT(*) FROM buildings WHERE status = 'ACTIVE') AS active_buildings,
        (SELECT COUNT(*) FROM rooms WHERE status = 'ACTIVE' AND public_visibility = TRUE) AS public_rooms,
        (SELECT COUNT(*) FROM staff WHERE status = 'ACTIVE' AND profile_visibility = 'PUBLIC') AS listed_faculty_staff,
        (SELECT COUNT(*) FROM facilities WHERE status = 'ACTIVE' AND public_visibility = TRUE) AS active_facilities,
        (SELECT COUNT(*) FROM visitor_logs WHERE DATE(created_at) BETWEEN p_from_date AND p_to_date) AS period_total_visits,
        (SELECT COUNT(*) FROM visitor_logs WHERE visit_status = 'CHECKED_IN') AS visitors_currently_inside;

    -- Result Set 2: Visits grouped by destination building
    SELECT
        COALESCE(b.building_name, 'General Campus') AS building_name,
        COALESCE(b.building_code, 'GEN') AS building_code,
        COUNT(vl.visit_id) AS visit_count,
        SUM(CASE WHEN vl.visit_status = 'CHECKED_IN' THEN 1 ELSE 0 END) AS active_inside,
        ROUND(AVG(TIMESTAMPDIFF(MINUTE, vl.check_in_at, vl.check_out_at)), 1) AS avg_duration_minutes
    FROM visitor_logs vl
    LEFT JOIN buildings b ON b.building_id = vl.destination_building_id
    WHERE DATE(vl.created_at) BETWEEN p_from_date AND p_to_date
    GROUP BY b.building_id, b.building_name, b.building_code
    ORDER BY visit_count DESC;
END$$

DELIMITER ;
