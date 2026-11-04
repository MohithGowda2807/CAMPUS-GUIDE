-- =============================================================================
-- RVCE Campus Navigation & Visitor Management System
-- MySQL 8.0+ Authoritative Relational Schema (Third Normal Form — 3NF)
-- Database: campusguide
-- =============================================================================

CREATE DATABASE IF NOT EXISTS campusguide
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE campusguide;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS change_audit_log;
DROP TABLE IF EXISTS visitor_logs;
DROP TABLE IF EXISTS visitors;
DROP TABLE IF EXISTS user_roles;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS faculty_availability;
DROP TABLE IF EXISTS staff;
DROP TABLE IF EXISTS facilities;
DROP TABLE IF EXISTS floor_plans;
DROP TABLE IF EXISTS rooms;
DROP TABLE IF EXISTS floors;
DROP TABLE IF EXISTS departments;
DROP TABLE IF EXISTS buildings;
DROP TABLE IF EXISTS campuses;

SET FOREIGN_KEY_CHECKS = 1;

-- -----------------------------------------------------------------------------
-- 1. CAMPUSES
-- -----------------------------------------------------------------------------
CREATE TABLE campuses (
    campus_id INT AUTO_INCREMENT PRIMARY KEY,
    campus_code VARCHAR(20) NOT NULL,
    campus_name VARCHAR(150) NOT NULL,
    address VARCHAR(300) NOT NULL,
    latitude DECIMAL(9, 6) NOT NULL,
    longitude DECIMAL(9, 6) NOT NULL,
    default_zoom TINYINT UNSIGNED NOT NULL DEFAULT 18,
    verification_status ENUM('VERIFIED', 'PENDING_REVIEW', 'SAMPLE_DEV') NOT NULL DEFAULT 'PENDING_REVIEW',
    status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT uq_campuses_code UNIQUE (campus_code),
    CONSTRAINT chk_campuses_lat CHECK (latitude BETWEEN -90.000000 AND 90.000000),
    CONSTRAINT chk_campuses_lng CHECK (longitude BETWEEN -180.000000 AND 180.000000),
    CONSTRAINT chk_campuses_zoom CHECK (default_zoom BETWEEN 1 AND 22)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 2. BUILDINGS
-- -----------------------------------------------------------------------------
CREATE TABLE buildings (
    building_id INT AUTO_INCREMENT PRIMARY KEY,
    campus_id INT NOT NULL,
    building_code VARCHAR(25) NOT NULL,
    building_name VARCHAR(150) NOT NULL,
    building_type ENUM(
        'ACADEMIC_BLOCK',
        'ADMINISTRATION',
        'LIBRARY',
        'LABORATORY_COMPLEX',
        'AUDITORIUM',
        'HOSTEL',
        'AMENITIES',
        'SECURITY_GATE'
    ) NOT NULL DEFAULT 'ACADEMIC_BLOCK',
    description TEXT NULL,
    latitude DECIMAL(9, 6) NOT NULL,
    longitude DECIMAL(9, 6) NOT NULL,
    total_floors TINYINT UNSIGNED NOT NULL DEFAULT 1,
    is_accessible BOOLEAN NOT NULL DEFAULT TRUE,
    verification_status ENUM('VERIFIED', 'PENDING_REVIEW', 'SAMPLE_DEV') NOT NULL DEFAULT 'PENDING_REVIEW',
    status ENUM('ACTIVE', 'MAINTENANCE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_buildings_campus FOREIGN KEY (campus_id)
        REFERENCES campuses (campus_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT uq_buildings_campus_code UNIQUE (campus_id, building_code),
    CONSTRAINT chk_buildings_lat CHECK (latitude BETWEEN -90.000000 AND 90.000000),
    CONSTRAINT chk_buildings_lng CHECK (longitude BETWEEN -180.000000 AND 180.000000),
    CONSTRAINT chk_buildings_floors CHECK (total_floors >= 1),
    INDEX idx_buildings_type_status (building_type, status),
    FULLTEXT INDEX ft_buildings_search (building_name, building_code, description)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 3. DEPARTMENTS
-- -----------------------------------------------------------------------------
CREATE TABLE departments (
    dept_id INT AUTO_INCREMENT PRIMARY KEY,
    primary_building_id INT NULL,
    dept_code VARCHAR(20) NOT NULL,
    dept_name VARCHAR(150) NOT NULL,
    dept_category ENUM('ENGINEERING', 'PG_PROGRAMME', 'BASIC_SCIENCES', 'CAMPUS_CENTRAL') NOT NULL DEFAULT 'ENGINEERING',
    short_description VARCHAR(500) NULL,
    official_email VARCHAR(150) NULL,
    verification_status ENUM('VERIFIED', 'PENDING_REVIEW', 'SAMPLE_DEV') NOT NULL DEFAULT 'PENDING_REVIEW',
    status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_departments_building FOREIGN KEY (primary_building_id)
        REFERENCES buildings (building_id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT uq_departments_code UNIQUE (dept_code),
    CONSTRAINT uq_departments_name UNIQUE (dept_name)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 4. FLOORS
-- -----------------------------------------------------------------------------
CREATE TABLE floors (
    floor_id INT AUTO_INCREMENT PRIMARY KEY,
    building_id INT NOT NULL,
    floor_number TINYINT NOT NULL,
    floor_name VARCHAR(60) NOT NULL,
    display_order TINYINT NOT NULL DEFAULT 0,
    has_lift_access BOOLEAN NOT NULL DEFAULT FALSE,
    status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_floors_building FOREIGN KEY (building_id)
        REFERENCES buildings (building_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT uq_floors_building_num UNIQUE (building_id, floor_number),
    INDEX idx_floors_building_order (building_id, display_order)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 5. ROOMS
-- -----------------------------------------------------------------------------
CREATE TABLE rooms (
    room_id INT AUTO_INCREMENT PRIMARY KEY,
    floor_id INT NOT NULL,
    dept_id INT NULL,
    room_number VARCHAR(30) NOT NULL,
    room_name VARCHAR(150) NOT NULL,
    room_type ENUM(
        'CLASSROOM',
        'LABORATORY',
        'SEMINAR_HALL',
        'FACULTY_OFFICE',
        'HOD_CABIN',
        'ADMIN_OFFICE',
        'LIBRARY_ZONE',
        'RESTROOM',
        'UTILITY',
        'RECEPTION'
    ) NOT NULL DEFAULT 'CLASSROOM',
    capacity INT UNSIGNED NULL,
    description VARCHAR(500) NULL,
    is_accessible BOOLEAN NOT NULL DEFAULT TRUE,
    public_visibility BOOLEAN NOT NULL DEFAULT TRUE,
    verification_status ENUM('VERIFIED', 'PENDING_REVIEW', 'SAMPLE_DEV') NOT NULL DEFAULT 'PENDING_REVIEW',
    status ENUM('ACTIVE', 'MAINTENANCE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_rooms_floor FOREIGN KEY (floor_id)
        REFERENCES floors (floor_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_rooms_dept FOREIGN KEY (dept_id)
        REFERENCES departments (dept_id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT uq_rooms_floor_number UNIQUE (floor_id, room_number),
    INDEX idx_rooms_type_visibility (room_type, public_visibility, status),
    FULLTEXT INDEX ft_rooms_search (room_number, room_name, description)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 6. ROLES & USERS (Defined prior to floor_plans & visitor_logs for FK audit links)
-- -----------------------------------------------------------------------------
CREATE TABLE roles (
    role_id INT AUTO_INCREMENT PRIMARY KEY,
    role_code VARCHAR(40) NOT NULL,
    role_name VARCHAR(80) NOT NULL,
    description VARCHAR(255) NOT NULL,
    CONSTRAINT uq_roles_code UNIQUE (role_code)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 7. STAFF / FACULTY (Aligned with Official RVCE Teaching & Institutional Roster)
-- -----------------------------------------------------------------------------
CREATE TABLE staff (
    staff_id INT AUTO_INCREMENT PRIMARY KEY,
    dept_id INT NOT NULL,
    office_room_id INT NULL,
    employee_code VARCHAR(30) NOT NULL,
    display_name VARCHAR(140) NOT NULL,
    qualification VARCHAR(40) NULL,
    designation VARCHAR(180) NOT NULL,
    cadre_rank TINYINT UNSIGNED NOT NULL DEFAULT 5,
    program_name VARCHAR(180) NULL,
    leadership_role VARCHAR(140) NULL,
    staff_type ENUM('FACULTY', 'LIBRARIAN_SPORTS', 'ADMIN_STAFF', 'TECHNICAL_STAFF', 'SECURITY_STAFF') NOT NULL DEFAULT 'FACULTY',
    date_of_joining DATE NULL,
    professor_designated_date DATE NULL,
    currently_associated BOOLEAN NOT NULL DEFAULT TRUE,
    association_nature ENUM('REGULAR', 'CONTRACT', 'ADJUNCT') NOT NULL DEFAULT 'REGULAR',
    employment_mode ENUM('FULL_TIME', 'PART_TIME') NOT NULL DEFAULT 'FULL_TIME',
    deputation_remarks VARCHAR(255) NULL,
    public_email VARCHAR(150) NULL,
    official_profile_url VARCHAR(255) NULL,
    profile_visibility ENUM('PUBLIC', 'INTERNAL_ONLY', 'HIDDEN') NOT NULL DEFAULT 'PUBLIC',
    verification_status ENUM('VERIFIED', 'PENDING_REVIEW', 'SAMPLE_DEV') NOT NULL DEFAULT 'VERIFIED',
    status ENUM('ACTIVE', 'ON_LEAVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_staff_dept FOREIGN KEY (dept_id)
        REFERENCES departments (dept_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_staff_room FOREIGN KEY (office_room_id)
        REFERENCES rooms (room_id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT uq_staff_emp_code UNIQUE (employee_code),
    INDEX idx_staff_dept_cadre (dept_id, cadre_rank, display_name),
    INDEX idx_staff_leadership (leadership_role),
    FULLTEXT INDEX ft_staff_search (display_name, designation, employee_code, program_name, leadership_role)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 8. USERS & USER_ROLES (RBAC)
-- -----------------------------------------------------------------------------
CREATE TABLE users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    linked_staff_id INT NULL,
    username VARCHAR(60) NOT NULL,
    email VARCHAR(150) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    auth_provider ENUM('LOCAL', 'RVCE_SSO') NOT NULL DEFAULT 'LOCAL',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_users_staff FOREIGN KEY (linked_staff_id)
        REFERENCES staff (staff_id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT uq_users_username UNIQUE (username),
    CONSTRAINT uq_users_email UNIQUE (email),
    CONSTRAINT uq_users_linked_staff UNIQUE (linked_staff_id)
) ENGINE=InnoDB;

CREATE TABLE user_roles (
    user_id INT NOT NULL,
    role_id INT NOT NULL,
    assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, role_id),
    CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id)
        REFERENCES users (user_id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id)
        REFERENCES roles (role_id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 9. FLOOR PLANS (Indoor Schematic / Architectural Asset Metadata)
-- -----------------------------------------------------------------------------
CREATE TABLE floor_plans (
    floor_plan_id INT AUTO_INCREMENT PRIMARY KEY,
    floor_id INT NOT NULL,
    version_label VARCHAR(30) NOT NULL DEFAULT 'v1.0',
    asset_url VARCHAR(300) NULL,
    file_format ENUM('SVG', 'PNG', 'WEBP', 'PDF', 'VECTOR_OVERLAY') NOT NULL DEFAULT 'VECTOR_OVERLAY',
    canvas_width INT UNSIGNED NOT NULL DEFAULT 1000,
    canvas_height INT UNSIGNED NOT NULL DEFAULT 650,
    coordinate_space ENUM('LOCAL_PIXEL', 'NORMALIZED_1000') NOT NULL DEFAULT 'NORMALIZED_1000',
    source_reference VARCHAR(255) NOT NULL,
    approval_status ENUM('DRAFT', 'APPROVED', 'SUPERSEDED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    is_active_public BOOLEAN NOT NULL DEFAULT FALSE,
    is_schematic_sample BOOLEAN NOT NULL DEFAULT TRUE,
    approved_by_user_id INT NULL,
    approved_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_floor_plans_floor FOREIGN KEY (floor_id)
        REFERENCES floors (floor_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_floor_plans_approver FOREIGN KEY (approved_by_user_id)
        REFERENCES users (user_id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT uq_floor_plans_version UNIQUE (floor_id, version_label),
    CONSTRAINT chk_floor_plans_dimensions CHECK (canvas_width > 0 AND canvas_height > 0),
    INDEX idx_floor_plans_active (floor_id, is_active_public, approval_status)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 10. FACILITIES & POINTS OF INTEREST (Indoor & Outdoor POIs)
-- -----------------------------------------------------------------------------
CREATE TABLE facilities (
    facility_id INT AUTO_INCREMENT PRIMARY KEY,
    campus_id INT NOT NULL,
    building_id INT NULL,
    floor_id INT NULL,
    room_id INT NULL,
    facility_name VARCHAR(150) NOT NULL,
    category ENUM(
        'GATE_RECEPTION',
        'LIBRARY',
        'CAFETERIA_FOOD',
        'ADMIN_SERVICE',
        'BANK_ATM',
        'PARKING',
        'WASHROOM',
        'MEDICAL_FIRST_AID',
        'AUDITORIUM_HALL',
        'SPORTS_AMENITY',
        'ACCESSIBILITY_LIFT_RAMP'
    ) NOT NULL,
    description VARCHAR(500) NULL,
    latitude DECIMAL(9, 6) NULL,
    longitude DECIMAL(9, 6) NULL,
    opening_hours VARCHAR(120) NULL,
    is_accessible BOOLEAN NOT NULL DEFAULT TRUE,
    public_visibility BOOLEAN NOT NULL DEFAULT TRUE,
    verification_status ENUM('VERIFIED', 'PENDING_REVIEW', 'SAMPLE_DEV') NOT NULL DEFAULT 'PENDING_REVIEW',
    status ENUM('ACTIVE', 'MAINTENANCE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_facilities_campus FOREIGN KEY (campus_id)
        REFERENCES campuses (campus_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_facilities_building FOREIGN KEY (building_id)
        REFERENCES buildings (building_id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_facilities_floor FOREIGN KEY (floor_id)
        REFERENCES floors (floor_id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_facilities_room FOREIGN KEY (room_id)
        REFERENCES rooms (room_id) ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX idx_facilities_cat_vis (category, public_visibility, status),
    FULLTEXT INDEX ft_facilities_search (facility_name, description)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 11. FACULTY AVAILABILITY (Time-bounded, Source-attributed Status)
-- -----------------------------------------------------------------------------
CREATE TABLE faculty_availability (
    availability_id INT AUTO_INCREMENT PRIMARY KEY,
    staff_id INT NOT NULL,
    availability_state ENUM('AVAILABLE', 'BUSY_SCHEDULED', 'UNAVAILABLE', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    source_type ENUM('FACULTY_SELF', 'DEPARTMENT_OFFICE', 'APPROVED_SCHEDULE', 'SYSTEM_EXPIRED') NOT NULL,
    public_note VARCHAR(200) NULL,
    valid_from DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    valid_until DATETIME NULL,
    last_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by_user_id INT NULL,
    CONSTRAINT fk_availability_staff FOREIGN KEY (staff_id)
        REFERENCES staff (staff_id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_availability_updater FOREIGN KEY (updated_by_user_id)
        REFERENCES users (user_id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_availability_window CHECK (valid_until IS NULL OR valid_until > valid_from),
    INDEX idx_availability_staff_latest (staff_id, last_updated_at DESC)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 12. VISITORS & VISITOR_LOGS (Data-minimised Security Gate & Host Workflow)
-- -----------------------------------------------------------------------------
CREATE TABLE visitors (
    visitor_id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(120) NOT NULL,
    contact_phone VARCHAR(20) NOT NULL,
    contact_email VARCHAR(150) NULL,
    organization VARCHAR(150) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_visitors_phone (contact_phone),
    INDEX idx_visitors_name (full_name)
) ENGINE=InnoDB;

CREATE TABLE visitor_logs (
    visit_id INT AUTO_INCREMENT PRIMARY KEY,
    visit_pass_code VARCHAR(30) NOT NULL,
    visitor_id INT NOT NULL,
    campus_id INT NOT NULL,
    destination_building_id INT NULL,
    destination_room_id INT NULL,
    host_staff_id INT NULL,
    purpose VARCHAR(255) NOT NULL,
    gate_name VARCHAR(60) NOT NULL DEFAULT 'Main Mysuru Road Gate',
    approval_status ENUM('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'NOT_REQUIRED',
    visit_status ENUM('REGISTERED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED') NOT NULL DEFAULT 'REGISTERED',
    scheduled_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    check_in_at DATETIME NULL,
    check_out_at DATETIME NULL,
    registered_by_user_id INT NULL,
    checked_in_by_user_id INT NULL,
    checked_out_by_user_id INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT uq_visitor_logs_pass_code UNIQUE (visit_pass_code),
    CONSTRAINT fk_visits_visitor FOREIGN KEY (visitor_id)
        REFERENCES visitors (visitor_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_visits_campus FOREIGN KEY (campus_id)
        REFERENCES campuses (campus_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_visits_building FOREIGN KEY (destination_building_id)
        REFERENCES buildings (building_id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_visits_room FOREIGN KEY (destination_room_id)
        REFERENCES rooms (room_id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_visits_host FOREIGN KEY (host_staff_id)
        REFERENCES staff (staff_id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_visits_reg_user FOREIGN KEY (registered_by_user_id)
        REFERENCES users (user_id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_visits_in_user FOREIGN KEY (checked_in_by_user_id)
        REFERENCES users (user_id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_visits_out_user FOREIGN KEY (checked_out_by_user_id)
        REFERENCES users (user_id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_visits_timestamps CHECK (check_out_at IS NULL OR (check_in_at IS NOT NULL AND check_out_at >= check_in_at)),
    INDEX idx_visits_status_date (visit_status, scheduled_at DESC),
    INDEX idx_visits_host_approval (host_staff_id, approval_status)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- 13. CHANGE AUDIT LOG (Immutable Administrative & Security Audit Trail)
-- -----------------------------------------------------------------------------
CREATE TABLE change_audit_log (
    log_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    action_type ENUM('INSERT', 'UPDATE', 'DELETE', 'STATE_TRANSITION', 'AUTH_EVENT') NOT NULL,
    table_name VARCHAR(60) NOT NULL,
    record_id INT NOT NULL,
    old_value JSON NULL,
    new_value JSON NULL,
    changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_audit_user FOREIGN KEY (user_id)
        REFERENCES users (user_id) ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX idx_audit_table_record (table_name, record_id, changed_at DESC),
    INDEX idx_audit_user_time (user_id, changed_at DESC)
) ENGINE=InnoDB;
