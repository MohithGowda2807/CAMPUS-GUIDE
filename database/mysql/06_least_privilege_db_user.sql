-- =============================================================================
-- RVCE Campus Navigator — Least-Privilege Runtime Database Principal
-- Execute as DBA (`root`) during Staging / Production provisioning.
-- The FastAPI runtime (`campusguide_app`) receives ONLY data-manipulation
-- privileges on `campusguide` and ZERO DDL (`DROP`, `ALTER`, `TRUNCATE`) or
-- administrative (`SUPER`, `FILE`, `GRANT OPTION`) permissions.
-- =============================================================================

CREATE USER IF NOT EXISTS 'campusguide_app'@'%'
    IDENTIFIED BY 'REPLACE_WITH_KMS_MANAGED_STRONG_RUNTIME_SECRET';

GRANT SELECT, INSERT, UPDATE ON campusguide.* TO 'campusguide_app'@'%';

-- Allow cleanup of expired SHA-256 JTI revocation hashes and role revocations only
GRANT DELETE ON campusguide.revoked_token_jtis TO 'campusguide_app'@'%';
GRANT DELETE ON campusguide.user_roles TO 'campusguide_app'@'%';
GRANT DELETE ON campusguide.staff_eligibility_allowlist TO 'campusguide_app'@'%';

-- Allow executing approved stored procedures
GRANT EXECUTE ON PROCEDURE campusguide.sp_register_visitor_pass TO 'campusguide_app'@'%';
GRANT EXECUTE ON PROCEDURE campusguide.sp_record_gate_action TO 'campusguide_app'@'%';
GRANT EXECUTE ON PROCEDURE campusguide.sp_activate_floor_plan TO 'campusguide_app'@'%';
GRANT EXECUTE ON PROCEDURE campusguide.sp_expire_faculty_statuses TO 'campusguide_app'@'%';
GRANT EXECUTE ON PROCEDURE campusguide.sp_campus_operations_summary TO 'campusguide_app'@'%';

-- Explicitly note: NO DELETE on change_audit_log (immutable audit trail)!
FLUSH PRIVILEGES;
