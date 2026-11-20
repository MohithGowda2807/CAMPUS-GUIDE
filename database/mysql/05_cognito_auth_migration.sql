-- =============================================================================
-- RVCE Campus Navigator — Non-Destructive In-Place Migration (MySQL 8.0+)
-- Migrates legacy local-password `users` table to Zero-Password Cognito OIDC
-- Identity Mapping (`cognito_sub`), Staff Eligibility Allowlist, and Granular
-- Faculty Availability States while preserving all buildings, rooms & staff.
-- =============================================================================

USE campusguide;

-- 1. Ensure canonical RBAC roles exist alongside operational sub-roles
INSERT IGNORE INTO roles (role_code, role_name, description) VALUES
    ('PUBLIC', 'Public Campus User', 'Unauthenticated access to public campus navigation, buildings, rooms, and POIs.'),
    ('FACULTY', 'RVCE Faculty Member', 'Update own approved profile, availability, and host visitor approvals.'),
    ('STAFF', 'Authorised RVCE Staff', 'Authorised non-teaching & gate operations permissions.'),
    ('ADMIN', 'Institutional Administrator', 'Approve/suspend/revoke staff accounts, manage allowlist, campus directory, and audit logs.');

-- 2. Expand faculty_availability states non-destructively
ALTER TABLE faculty_availability
    MODIFY COLUMN availability_state ENUM(
        'AVAILABLE',
        'BUSY',
        'IN_CLASS',
        'IN_MEETING',
        'BUSY_SCHEDULED',
        'UNAVAILABLE',
        'NOT_SPECIFIED',
        'UNKNOWN'
    ) NOT NULL DEFAULT 'NOT_SPECIFIED';

-- 3. Create administrator-managed staff eligibility allowlist table
CREATE TABLE IF NOT EXISTS staff_eligibility_allowlist (
    allowlist_id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(150) NOT NULL,
    linked_staff_id INT NULL,
    assigned_role_code ENUM('FACULTY', 'STAFF') NOT NULL DEFAULT 'FACULTY',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    added_by_user_id INT NULL,
    notes VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT uq_allowlist_email UNIQUE (email),
    CONSTRAINT fk_allowlist_staff FOREIGN KEY (linked_staff_id)
        REFERENCES staff (staff_id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_allowlist_added_by FOREIGN KEY (added_by_user_id)
        REFERENCES users (user_id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_allowlist_rvce_email CHECK (email LIKE '%@rvce.edu.in')
) ENGINE=InnoDB;

-- 4. Create SHA-256 JTI revocation table (never stores raw access/refresh tokens)
CREATE TABLE IF NOT EXISTS revoked_token_jtis (
    jti_hash CHAR(64) NOT NULL PRIMARY KEY,
    user_id INT NULL,
    expires_at DATETIME NOT NULL,
    revoked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_revoked_jti_user FOREIGN KEY (user_id)
        REFERENCES users (user_id) ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_revoked_jti_exp (expires_at)
) ENGINE=InnoDB;
