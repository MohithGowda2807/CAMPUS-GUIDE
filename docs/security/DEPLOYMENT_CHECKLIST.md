# Production Deployment & Governance Checklist

> [!IMPORTANT]
> **Honest Production Readiness Statement**: While the RVCE Campus Navigator codebase, zero-password relational schema, OIDC + `S256` PKCE mobile client, backend `RS256` RBAC enforcement, and automated security test suites are complete and verified in development, **production deployment must NOT occur** until the institutional, legal/privacy, live AWS cloud, and independent security review gates below are formally signed off by RVCE authorities.

---

## Gate 1 — Institutional & Privacy Governance
- [ ] Written approval from **RVCE Principal / Dean Academics / IT Nodal Office** authorising the official `staff_eligibility_allowlist` feed from HR records.
- [ ] Institutional **Privacy Notice & Terms of Use** reviewed for compliance with India's **Digital Personal Data Protection (DPDP) Act, 2023** (data minimisation, purpose limitation, grievance officer contact).
- [ ] Designation of at least **two** verified `@rvce.edu.in` `ADMIN` custodians (enforcing non-self-approval dual governance) and custody of the physical break-glass MFA hardware token.

---

## Gate 2 — Live AWS Cognito (Free / Lite Tier) Provisioning
- [ ] Create production Amazon Cognito User Pool in `ap-south-1` (Mumbai) on the **Lite / Free Tier** (<=10,000 MAU; Cognito Plus add-ons **OFF**; SMS MFA **OFF**).
- [ ] Configure **Public App Client** (`Generate client secret = OFF`), Authorization Code Grant + `S256` PKCE, callback `rvce-navigator://auth/callback`, sign-out `rvce-navigator://auth/logout`, 15-minute access/ID token TTL, and Token Revocation **ON**.
- [ ] Configure **TOTP Software Token MFA** (`SOFTWARE_TOKEN_MFA`) and **Email-only** account recovery.
- [ ] Configure verified Amazon SES identity for `noreply@rvce.edu.in` (moving out of SES sandbox if daily verification/reset volume exceeds 50 emails/day).

---

## Gate 3 — Backend, Database & TLS Hardening
- [ ] Provision production TLS 1.2/1.3 termination (ACM / Let's Encrypt certificate on HTTPS domain, e.g., `https://navigator-api.rvce.edu.in`) and set `android:usesCleartextTraffic="false"` in production release manifest.
- [ ] Generate a dedicated 256-bit `DATA_PROTECTION_KEY_B64` stored in **AWS Secrets Manager / KMS** (never in Git or container images).
- [ ] Set `APP_ENV=production` and populate `COGNITO_USER_POOL_ID`, `COGNITO_APP_CLIENT_ID`, and `COGNITO_DOMAIN` (verifying `DEV_OIDC_SANDBOX` routes are disabled).
- [ ] Execute `database/mysql/01_schema.sql`..`04_procedures.sql` and `06_least_privilege_db_user.sql` so FastAPI connects strictly as `campusguide_app` over TLS (`MYSQL_SSL_REQUIRED=true`) with `DELETE` revoked on `change_audit_log`.
- [ ] Configure upstream reverse-proxy / WAF rate limiting and ship `change_audit_log` + API access logs to append-only institutional log storage.

---

## Gate 4 — Mobile Release Signing & Independent Security Review
- [ ] Generate an RVCE-owned Android upload/release keystore (stored in institutional vault, replacing the local debug signing key in `mobile/android/app/build.gradle`).
- [ ] Publish `https://<campus-domain>/.well-known/assetlinks.json` to upgrade custom-scheme callbacks to verified **Android App Links** where supported.
- [ ] Conduct an **independent external penetration test** (web API + mobile APK dynamic/static assessment) and remediate any findings prior to campus-wide rollout.
