# Database Identity Mapping & Data Protection

## 1. Zero-Secret Relational Schema (`campusguide`)

The existing MySQL schema (`database/mysql/01_schema.sql`) reuses the institutional `departments`, `staff`, `faculty_availability`, `roles`, `user_roles`, and `change_audit_log` tables without duplicating faculty records.

### Prohibited Data Never Stored in MySQL or MongoDB
Verified automatically by `test_zero_password_database_and_aesgcm_roundtrip` against `information_schema.columns`:
- **No** plaintext passwords or password hashes (`password_hash` column completely removed).
- **No** raw OAuth access tokens, ID tokens, or refresh tokens.
- **No** TOTP MFA shared secrets (`AssociateSoftwareToken` secrets live only inside Cognito).
- **No** plaintext recovery codes.

---

## 2. Entity-Relationship Identity Mapping

```mermaid
erDiagram
  STAFF ||--o| USERS : "linked_staff_id (1:0..1)"
  STAFF ||--o{ STAFF_ELIGIBILITY_ALLOWLIST : "linked_staff_id"
  STAFF ||--o{ FACULTY_AVAILABILITY : "staff_id"
  DEPARTMENTS ||--o{ STAFF : "dept_id"
  USERS ||--o{ USER_ROLES : "user_id"
  ROLES ||--o{ USER_ROLES : "role_id"
  USERS ||--o{ REVOKED_TOKEN_JTIS : "user_id"
  USERS ||--o{ CHANGE_AUDIT_LOG : "user_id"

  USERS {
    int user_id PK
    varchar cognito_sub UK "Stable Cognito OIDC sub UUID"
    varchar username UK
    varchar email UK "CHECK (email LIKE '%@rvce.edu.in')"
    varchar full_name
    int linked_staff_id FK "Nullable for non-teaching gate/admin staff"
    varbinary encrypted_recovery_meta "AES-256-GCM ciphertext (nonce||tag||ct)"
    enum auth_provider "COGNITO_OIDC"
    boolean email_verified
    boolean mfa_enabled
    enum approval_status "PENDING_APPROVAL|APPROVED|REJECTED|SUSPENDED|REVOKED"
    datetime terms_accepted_at
    int approved_by_user_id FK
    datetime approved_at
    datetime tokens_valid_after "UTC epoch revocation cutoff"
    boolean is_active
  }

  STAFF_ELIGIBILITY_ALLOWLIST {
    int allowlist_id PK
    varchar email UK "CHECK (email LIKE '%@rvce.edu.in')"
    int linked_staff_id FK
    enum assigned_role_code "FACULTY|STAFF"
    boolean is_active
    int added_by_user_id FK
  }

  REVOKED_TOKEN_JTIS {
    char jti_hash PK "SHA-256 hex digest of JWT jti"
    int user_id FK
    datetime expires_at
  }
```

---

## 3. Cryptographic Protection & Honest Key-Management Disclosure

- **Authenticated Field Encryption (`AES-256-GCM`)**:
  - Sensitive internal metadata (`users.encrypted_recovery_meta`) is encrypted using 256-bit `AESGCM` (`cryptography.hazmat.primitives.ciphers.aead.AESGCM`) with a fresh 96-bit CSPRNG nonce per write and authenticated additional data (`AAD = "users.encrypted_recovery_meta"`).
  - Key material is injected via environment/KMS secret `DATA_PROTECTION_KEY_B64` (never committed to source control; `validate_security_posture()` blocks startup in `production` if missing).
- **Explicit Non-Zero-Knowledge Disclosure**:
  - This architecture provides **application-layer authenticated encryption at rest**, **not** end-to-end / zero-knowledge encryption, because the authorised backend service holds `DATA_PROTECTION_KEY_B64` to encrypt and decrypt protected fields when needed.
- **Public Directory Privacy Boundary**:
  - Public endpoints (`GET /api/v1/faculty`, `GET /api/v1/rooms/{id}`, `GET /api/v1/search`) filter on `s.status = 'ACTIVE' AND s.profile_visibility = 'PUBLIC'` (`vw_public_faculty_directory`) and expose only institutional office metadata (`display_name`, `designation`, `dept_name`, `office_room_number`, `public_email`, `effective_availability`). Internal `cognito_sub`, personal onboarding notes, and `INTERNAL_ONLY`/`HIDDEN` staff profiles are never returned to public callers.

---

## 4. Least-Privilege Database Principal (`06_least_privilege_db_user.sql`)

Production runtime connections use the restricted MySQL principal `campusguide_app` rather than `root`:
- Granted only `SELECT, INSERT, UPDATE, DELETE, EXECUTE` on `campusguide.*`.
- **No** `DROP`, `ALTER`, `TRUNCATE`, `CREATE USER`, `SUPER`, or `FILE` privileges.
- `DELETE` on `campusguide.change_audit_log` is explicitly revoked so runtime application compromise cannot erase historical audit records.
