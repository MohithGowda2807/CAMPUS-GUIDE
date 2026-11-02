-- =============================================================================
-- RVCE Campus Navigation & Visitor Management System
-- Relational Views (Public Projections, Live Availability & Analytics)
-- =============================================================================

USE campusguide;

-- 1. Public Building Directory View (Aggregates active floors, rooms & POIs)
CREATE OR REPLACE VIEW vw_public_building_directory AS
SELECT
    b.building_id,
    b.campus_id,
    c.campus_name,
    b.building_code,
    b.building_name,
    b.building_type,
    b.description,
    b.latitude,
    b.longitude,
    b.total_floors,
    b.is_accessible,
    b.verification_status,
    b.status,
    COUNT(DISTINCT f.floor_id) AS mapped_floors_count,
    COUNT(DISTINCT CASE WHEN r.public_visibility = TRUE AND r.status = 'ACTIVE' THEN r.room_id END) AS public_rooms_count,
    COUNT(DISTINCT CASE WHEN fp.is_active_public = TRUE AND fp.approval_status = 'APPROVED' THEN fp.floor_plan_id END) AS approved_plans_count
FROM buildings b
INNER JOIN campuses c ON c.campus_id = b.campus_id
LEFT JOIN floors f ON f.building_id = b.building_id AND f.status = 'ACTIVE'
LEFT JOIN rooms r ON r.floor_id = f.floor_id
LEFT JOIN floor_plans fp ON fp.floor_id = f.floor_id
WHERE b.status <> 'INACTIVE'
GROUP BY
    b.building_id, b.campus_id, c.campus_name, b.building_code, b.building_name,
    b.building_type, b.description, b.latitude, b.longitude, b.total_floors,
    b.is_accessible, b.verification_status, b.status;

-- 2. Public Room Directory View (Full Breadcrumb Hierarchy: Campus -> Building -> Floor -> Room)
CREATE OR REPLACE VIEW vw_public_room_directory AS
SELECT
    r.room_id,
    r.room_number,
    r.room_name,
    r.room_type,
    r.capacity,
    r.description,
    r.is_accessible,
    r.verification_status,
    f.floor_id,
    f.floor_number,
    f.floor_name,
    b.building_id,
    b.building_code,
    b.building_name,
    b.latitude AS building_latitude,
    b.longitude AS building_longitude,
    d.dept_id,
    d.dept_code,
    d.dept_name,
    EXISTS (
        SELECT 1 FROM floor_plans fp
        WHERE fp.floor_id = f.floor_id
          AND fp.is_active_public = TRUE
          AND fp.approval_status = 'APPROVED'
    ) AS has_active_floor_plan
FROM rooms r
INNER JOIN floors f ON f.floor_id = r.floor_id AND f.status = 'ACTIVE'
INNER JOIN buildings b ON b.building_id = f.building_id AND b.status <> 'INACTIVE'
LEFT JOIN departments d ON d.dept_id = r.dept_id
WHERE r.public_visibility = TRUE
  AND r.status = 'ACTIVE';

-- 3. Public Faculty & Staff Directory View (Truthful Time-Bounded Availability + Official Roster Metadata)
CREATE OR REPLACE VIEW vw_public_faculty_directory AS
SELECT
    s.staff_id,
    s.employee_code,
    s.display_name,
    s.qualification,
    s.designation,
    s.cadre_rank,
    s.program_name,
    s.leadership_role,
    s.staff_type,
    s.date_of_joining,
    s.professor_designated_date,
    CASE
        WHEN s.date_of_joining IS NOT NULL
        THEN TIMESTAMPDIFF(YEAR, s.date_of_joining, CURRENT_DATE)
        ELSE NULL
    END AS years_at_rvce,
    s.association_nature,
    s.employment_mode,
    s.deputation_remarks,
    s.public_email,
    s.official_profile_url,
    s.verification_status,
    s.status AS staff_status,
    d.dept_id,
    d.dept_code,
    d.dept_name,
    d.dept_category,
    r.room_id AS office_room_id,
    r.room_number AS office_room_number,
    r.room_name AS office_room_name,
    f.floor_id,
    f.floor_name,
    b.building_id,
    b.building_code,
    b.building_name,
    b.latitude AS building_latitude,
    b.longitude AS building_longitude,
    CASE
        WHEN s.status = 'ON_LEAVE' THEN 'UNAVAILABLE'
        WHEN fa.availability_id IS NULL THEN 'UNKNOWN'
        WHEN fa.valid_until IS NOT NULL AND fa.valid_until < CURRENT_TIMESTAMP THEN 'UNKNOWN'
        WHEN fa.valid_from > CURRENT_TIMESTAMP THEN 'UNKNOWN'
        ELSE fa.availability_state
    END AS effective_availability,
    CASE
        WHEN s.status = 'ON_LEAVE' THEN 'DEPARTMENT_OFFICE'
        ELSE fa.source_type
    END AS availability_source,
    CASE
        WHEN s.status = 'ON_LEAVE' THEN s.deputation_remarks
        WHEN fa.valid_until IS NOT NULL AND fa.valid_until < CURRENT_TIMESTAMP THEN NULL
        ELSE fa.public_note
    END AS availability_note,
    fa.valid_until AS availability_valid_until,
    fa.last_updated_at AS availability_updated_at
FROM staff s
INNER JOIN departments d ON d.dept_id = s.dept_id
LEFT JOIN rooms r ON r.room_id = s.office_room_id
LEFT JOIN floors f ON f.floor_id = r.floor_id
LEFT JOIN buildings b ON b.building_id = f.building_id
LEFT JOIN faculty_availability fa ON fa.availability_id = (
    SELECT fa2.availability_id
    FROM faculty_availability fa2
    WHERE fa2.staff_id = s.staff_id
    ORDER BY fa2.last_updated_at DESC, fa2.availability_id DESC
    LIMIT 1
)
WHERE s.profile_visibility = 'PUBLIC'
  AND s.status <> 'INACTIVE';

-- 3b. Department Summary View (Aggregates Faculty Qualifications, Cadres & HODs)
CREATE OR REPLACE VIEW vw_department_directory AS
SELECT
    d.dept_id,
    d.dept_code,
    d.dept_name,
    d.dept_category,
    d.short_description,
    d.official_email,
    d.verification_status,
    COUNT(DISTINCT CASE WHEN s.profile_visibility = 'PUBLIC' AND s.status <> 'INACTIVE' THEN s.staff_id END) AS faculty_count,
    COUNT(DISTINCT CASE WHEN s.profile_visibility = 'PUBLIC' AND s.status <> 'INACTIVE' AND s.qualification = 'Ph.D' THEN s.staff_id END) AS phd_completed_count,
    COUNT(DISTINCT CASE WHEN s.profile_visibility = 'PUBLIC' AND s.status <> 'INACTIVE' AND s.cadre_rank <= 2 THEN s.staff_id END) AS professors_count,
    COUNT(DISTINCT CASE WHEN r.public_visibility = TRUE AND r.status = 'ACTIVE' THEN r.room_id END) AS room_count,
    (
        SELECT s_hod.display_name
        FROM staff s_hod
        WHERE s_hod.dept_id = d.dept_id
          AND s_hod.status <> 'INACTIVE'
          AND (s_hod.designation LIKE '%HOD%' OR s_hod.leadership_role LIKE '%HOD%')
        ORDER BY s_hod.cadre_rank ASC, s_hod.staff_id ASC
        LIMIT 1
    ) AS hod_name
FROM departments d
LEFT JOIN staff s ON s.dept_id = d.dept_id
LEFT JOIN rooms r ON r.dept_id = d.dept_id
WHERE d.status = 'ACTIVE'
GROUP BY d.dept_id, d.dept_code, d.dept_name, d.dept_category, d.short_description, d.official_email, d.verification_status;

-- 4. Security & Reception Live Visitor Board View
CREATE OR REPLACE VIEW vw_security_visitor_board AS
SELECT
    vl.visit_id,
    vl.visit_pass_code,
    v.visitor_id,
    v.full_name AS visitor_name,
    v.contact_phone,
    v.contact_email,
    v.organization,
    vl.purpose,
    vl.gate_name,
    vl.approval_status,
    vl.visit_status,
    vl.scheduled_at,
    vl.check_in_at,
    vl.check_out_at,
    TIMESTAMPDIFF(MINUTE, vl.check_in_at, COALESCE(vl.check_out_at, CURRENT_TIMESTAMP)) AS duration_minutes,
    b.building_id AS destination_building_id,
    b.building_name AS destination_building_name,
    b.building_code AS destination_building_code,
    r.room_id AS destination_room_id,
    r.room_number AS destination_room_number,
    r.room_name AS destination_room_name,
    hs.staff_id AS host_staff_id,
    hs.display_name AS host_name,
    hd.dept_code AS host_dept_code
FROM visitor_logs vl
INNER JOIN visitors v ON v.visitor_id = vl.visitor_id
LEFT JOIN buildings b ON b.building_id = vl.destination_building_id
LEFT JOIN rooms r ON r.room_id = vl.destination_room_id
LEFT JOIN staff hs ON hs.staff_id = vl.host_staff_id
LEFT JOIN departments hd ON hd.dept_id = hs.dept_id;

-- 5. Daily Gate & Facility Visitor Analytics View
CREATE OR REPLACE VIEW vw_daily_visitor_analytics AS
SELECT
    DATE(COALESCE(vl.check_in_at, vl.scheduled_at)) AS visit_date,
    vl.gate_name,
    COALESCE(b.building_name, 'General Campus') AS destination_building,
    COUNT(vl.visit_id) AS total_visits,
    SUM(CASE WHEN vl.visit_status = 'CHECKED_IN' THEN 1 ELSE 0 END) AS currently_inside,
    SUM(CASE WHEN vl.visit_status = 'CHECKED_OUT' THEN 1 ELSE 0 END) AS completed_visits,
    SUM(CASE WHEN vl.approval_status = 'PENDING' THEN 1 ELSE 0 END) AS pending_host_approvals,
    ROUND(AVG(
        CASE
            WHEN vl.check_in_at IS NOT NULL AND vl.check_out_at IS NOT NULL
            THEN TIMESTAMPDIFF(MINUTE, vl.check_in_at, vl.check_out_at)
        END
    ), 1) AS avg_visit_duration_minutes
FROM visitor_logs vl
LEFT JOIN buildings b ON b.building_id = vl.destination_building_id
GROUP BY
    DATE(COALESCE(vl.check_in_at, vl.scheduled_at)),
    vl.gate_name,
    COALESCE(b.building_name, 'General Campus');
