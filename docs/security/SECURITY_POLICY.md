# Developer & Administrator Security Policy

## 1. Credential & Secret Isolation Policy

1. **Developers Cannot View User Passwords or Hashes**:
   - All staff passwords and TOTP MFA secrets are managed inside Amazon Cognito User Pools. Neither developers nor database administrators can read plaintext passwords, password hashes, or MFA seeds from MySQL or application logs.
2. **Zero Secrets in Source Control or Mobile APK**:
   - `.env` files containing production credentials are excluded via `.gitignore`; only `.env.example` placeholder templates exist in Git.
   - The Android APK (`edu.rvce.campusguide`) is a **public OIDC native client** containing **zero Cognito client secrets** and **zero AWS IAM access keys**.
3. **Environment Separation**:
   - Separate User Pools, MySQL schemas, and encryption keys (`DATA_PROTECTION_KEY_B64`) must be maintained across `development`, `staging`, and `production`.
   - `DEV_OIDC_SANDBOX` is strictly restricted to non-production local testing and is hard-blocked by `Settings.validate_security_posture()` when `APP_ENV=production`.

---

## 2. Cloud IAM & Production Database Governance

1. **Mandatory MFA on Privileged Cloud & Portal Accounts**:
   - AWS Root and IAM Administrator principals managing the RVCE Cognito User Pool or production RDS/EC2 instances must enforce hardware FIDO2/WebAuthn or TOTP MFA.
   - All RVCE Portal `ADMIN` accounts must enrol TOTP MFA immediately upon provisioning.
2. **Temporary Credentials & Least-Privilege IAM**:
   - Production workloads must use IAM Roles (EC2 Instance Profile / ECS Task Role / OIDC Workload Identity) with temporary STS credentials — never long-lived static `AKIA...` IAM user keys.
3. **No Routine Developer Access to Production Personal Data**:
   - Developers use synthetic/publicly listed directory seed data (`setup_databases.py`) locally and have zero standing network or SQL credentials to the production MySQL database.
4. **Immutable Audit Logging**:
   - Every administrative account approval, rejection, suspension, revocation, allowlist modification, availability update, and building/room change is recorded in `change_audit_log` with `actor_user_id`, `action_type`, `old_value`, `new_value`, and timestamp (`03_triggers.sql` + API audit writers).

---

## 3. Auditable Break-Glass Emergency Access Procedure

In the event that all normal `ADMIN` staff portal sessions or AWS Cognito administrators are locked out:

1. **Authorisation Gate (Dual Control)**:
   - Requires joint approval from **(a) RVCE Head of Institution / Nominated IT Nodal Officer** and **(b) Designated Cloud Infrastructure Custodian**, recorded with an incident ticket ID.
2. **Scoped Activation**:
   - Retrieve the offline hardware MFA token stored in institutional physical custody to assume the dedicated `rvce-campus-breakglass-admin` AWS IAM role (1-hour maximum STS session duration, CloudTrail + SNS alert triggered automatically on `AssumeRole`).
3. **Remediation & Mandatory Post-Incident Rotation**:
   - Restore at least one verified `@rvce.edu.in` `ADMIN` account or reset compromised Cognito MFA settings.
   - Revoke temporary sessions (`POST /api/v1/auth/logout-all` / `GlobalSignOut`), export CloudTrail + `change_audit_log` evidence, and conduct a post-incident review within 48 hours.
