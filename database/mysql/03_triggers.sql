-- =============================================================================
-- RVCE Campus Navigation & Visitor Management System
-- Relational Integrity & Automated Audit Triggers (MySQL 8.0+)
-- =============================================================================

USE campusguide;

DROP TRIGGER IF EXISTS trg_floor_plans_before_insert;
DROP TRIGGER IF EXISTS trg_floor_plans_before_update;
DROP TRIGGER IF EXISTS trg_visitor_logs_before_update;
DROP TRIGGER IF EXISTS trg_buildings_after_update;
DROP TRIGGER IF EXISTS trg_rooms_after_update;
DROP TRIGGER IF EXISTS trg_staff_after_update;
DROP TRIGGER IF EXISTS trg_visitor_logs_after_insert;
DROP TRIGGER IF EXISTS trg_visitor_logs_after_update;

DELIMITER $$

-- 1. Prevent publishing unapproved floor plans to public portal
CREATE TRIGGER trg_floor_plans_before_insert
BEFORE INSERT ON floor_plans
FOR EACH ROW
BEGIN
    IF NEW.is_active_public = TRUE AND NEW.approval_status <> 'APPROVED' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Only APPROVED floor plans may be set as active public plans.';
    END IF;
END$$

CREATE TRIGGER trg_floor_plans_before_update
BEFORE UPDATE ON floor_plans
FOR EACH ROW
BEGIN
    IF NEW.is_active_public = TRUE AND NEW.approval_status <> 'APPROVED' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Only APPROVED floor plans may be set as active public plans.';
    END IF;
END$$

-- 2. Enforce Visitor Check-in / Check-out Lifecycle & Host Approval Rules
CREATE TRIGGER trg_visitor_logs_before_update
BEFORE UPDATE ON visitor_logs
FOR EACH ROW
BEGIN
    IF NEW.visit_status = 'CHECKED_IN' AND OLD.visit_status IN ('CANCELLED', 'CHECKED_OUT') THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Cannot check in a visit that is already checked out or cancelled.';
    END IF;

    IF NEW.visit_status = 'CHECKED_IN' AND NEW.approval_status = 'REJECTED' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Cannot check in a visitor whose host approval was rejected.';
    END IF;

    IF NEW.visit_status = 'CHECKED_IN' AND NEW.check_in_at IS NULL THEN
        SET NEW.check_in_at = CURRENT_TIMESTAMP;
    END IF;

    IF NEW.visit_status = 'CHECKED_OUT' THEN
        IF OLD.check_in_at IS NULL AND NEW.check_in_at IS NULL THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Visitor must be checked in before recording check-out.';
        END IF;
        IF NEW.check_out_at IS NULL THEN
            SET NEW.check_out_at = CURRENT_TIMESTAMP;
        END IF;
    END IF;
END$$

-- 3. Automated Database-Level Audit Logging Triggers
CREATE TRIGGER trg_buildings_after_update
AFTER UPDATE ON buildings
FOR EACH ROW
BEGIN
    INSERT INTO change_audit_log (user_id, action_type, table_name, record_id, old_value, new_value)
    VALUES (
        @current_app_user_id,
        'UPDATE',
        'buildings',
        NEW.building_id,
        JSON_OBJECT(
            'building_code', OLD.building_code,
            'building_name', OLD.building_name,
            'latitude', OLD.latitude,
            'longitude', OLD.longitude,
            'verification_status', OLD.verification_status,
            'status', OLD.status
        ),
        JSON_OBJECT(
            'building_code', NEW.building_code,
            'building_name', NEW.building_name,
            'latitude', NEW.latitude,
            'longitude', NEW.longitude,
            'verification_status', NEW.verification_status,
            'status', NEW.status
        )
    );
END$$

CREATE TRIGGER trg_rooms_after_update
AFTER UPDATE ON rooms
FOR EACH ROW
BEGIN
    INSERT INTO change_audit_log (user_id, action_type, table_name, record_id, old_value, new_value)
    VALUES (
        @current_app_user_id,
        'UPDATE',
        'rooms',
        NEW.room_id,
        JSON_OBJECT(
            'room_number', OLD.room_number,
            'room_name', OLD.room_name,
            'room_type', OLD.room_type,
            'public_visibility', OLD.public_visibility,
            'status', OLD.status
        ),
        JSON_OBJECT(
            'room_number', NEW.room_number,
            'room_name', NEW.room_name,
            'room_type', NEW.room_type,
            'public_visibility', NEW.public_visibility,
            'status', NEW.status
        )
    );
END$$

CREATE TRIGGER trg_staff_after_update
AFTER UPDATE ON staff
FOR EACH ROW
BEGIN
    INSERT INTO change_audit_log (user_id, action_type, table_name, record_id, old_value, new_value)
    VALUES (
        @current_app_user_id,
        'UPDATE',
        'staff',
        NEW.staff_id,
        JSON_OBJECT(
            'display_name', OLD.display_name,
            'designation', OLD.designation,
            'office_room_id', OLD.office_room_id,
            'profile_visibility', OLD.profile_visibility,
            'status', OLD.status
        ),
        JSON_OBJECT(
            'display_name', NEW.display_name,
            'designation', NEW.designation,
            'office_room_id', NEW.office_room_id,
            'profile_visibility', NEW.profile_visibility,
            'status', NEW.status
        )
    );
END$$

CREATE TRIGGER trg_visitor_logs_after_insert
AFTER INSERT ON visitor_logs
FOR EACH ROW
BEGIN
    INSERT INTO change_audit_log (user_id, action_type, table_name, record_id, old_value, new_value)
    VALUES (
        COALESCE(NEW.registered_by_user_id, @current_app_user_id),
        'INSERT',
        'visitor_logs',
        NEW.visit_id,
        NULL,
        JSON_OBJECT(
            'visit_pass_code', NEW.visit_pass_code,
            'visitor_id', NEW.visitor_id,
            'visit_status', NEW.visit_status,
            'approval_status', NEW.approval_status,
            'gate_name', NEW.gate_name
        )
    );
END$$

CREATE TRIGGER trg_visitor_logs_after_update
AFTER UPDATE ON visitor_logs
FOR EACH ROW
BEGIN
    IF OLD.visit_status <> NEW.visit_status OR OLD.approval_status <> NEW.approval_status THEN
        INSERT INTO change_audit_log (user_id, action_type, table_name, record_id, old_value, new_value)
        VALUES (
            COALESCE(@current_app_user_id, NEW.checked_out_by_user_id, NEW.checked_in_by_user_id),
            'STATE_TRANSITION',
            'visitor_logs',
            NEW.visit_id,
            JSON_OBJECT(
                'visit_status', OLD.visit_status,
                'approval_status', OLD.approval_status,
                'check_in_at', OLD.check_in_at,
                'check_out_at', OLD.check_out_at
            ),
            JSON_OBJECT(
                'visit_status', NEW.visit_status,
                'approval_status', NEW.approval_status,
                'check_in_at', NEW.check_in_at,
                'check_out_at', NEW.check_out_at
            )
        );
    END IF;
END$$

DELIMITER ;
