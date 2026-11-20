# Security Test Plan — RVCE Campus Navigator

## 1. Scope & Standards Alignment

This Security Test Plan validates all **17 required lifecycle, authorisation, and adversarial test scenarios** across the FastAPI backend, MySQL/MongoDB persistence tier, and Android React Native client, mapped to:
- **OWASP Application Security Verification Standard (ASVS v4.0.3)** — Chapters V2 (Authentication), V3 (Session Management), V4 (Access Control), V6 (Cryptography), V7 (Logging), V13 (API).
- **OWASP Mobile Application Security Verification Standard (MASVS v2.1)** — `MASVS-STORAGE`, `MASVS-AUTH`, `MASVS-NETWORK`, `MASVS-CODE`.

---

## 2. Test Case Matrix (All 17 Required Scenarios)

| Case ID | Scenario | Target Layer | Expected Security Outcome | Automated Test Reference |
| :---: | :--- | :--- | :--- | :--- |
| **TC-01** | Valid `@rvce.edu.in` registration (allowlisted) | Backend + Mobile | Normalized email verified via OTP; matched against `staff_eligibility_allowlist`; activated as `APPROVED` with assigned role | `test_01_valid_allowlisted_rvce_registration_and_admin_approval_workflow` |
| **TC-02** | Non-RVCE email domain rejection | Backend + Mobile | `@gmail.com`, `@rvce.ac.in`, `@sub.rvce.edu.in`, and `@rvce.edu.in.evil.com` rejected (`400`/`422` & client validation) | `test_02_non_rvce_domains_and_unverified_emails_rejected`, `cognitoAuth.test.ts` |
| **TC-03** | Unapproved RVCE email (`PENDING_APPROVAL`) | Backend | Verified `@rvce.edu.in` not on allowlist lands in `PENDING_APPROVAL` (`is_active=FALSE`), zero roles, `GET /auth/me` -> `403` | `test_01_valid_allowlisted_rvce_registration_and_admin_approval_workflow` |
| **TC-04** | Unverified email login & registration block | Backend + Mobile | Unconfirmed account returns `EMAIL_NOT_VERIFIED` challenge; forged/unverified claim rejected (`403`) | `test_02_non_rvce_domains_and_unverified_emails_rejected` |
| **TC-05** | Incorrect password & anti-enumeration | Backend + Mobile | Wrong password and unknown `@rvce.edu.in` return identical `"Invalid institutional email or password."` (`401`) | `test_05_log_redaction_rate_limiting_and_production_posture`, `cognitoAuth.test.ts` |
| **TC-06** | Password reset flow | Backend + Mobile | Reset OTP issued without leaking account existence; `ConfirmForgotPassword` updates Cognito password cleanly | `test_03_oauth2_pkce_s256_mfa_and_password_recovery_lifecycle` |
| **TC-07** | TOTP MFA enrolment & login challenge | Backend + Mobile | `AssociateSoftwareToken` + RFC-6238 `VerifySoftwareToken` enables `SOFTWARE_TOKEN_MFA`; wrong TOTP rejected, valid TOTP mints `RS256` tokens | `test_03_oauth2_pkce_s256_mfa_and_password_recovery_lifecycle` |
| **TC-08** | Expired access token rejection | Backend | `RS256` token with `exp < now` rejected with `401 Unauthorized` | `test_04_expired_revoked_idor_and_privilege_escalation_defenses` |
| **TC-09** | Tampered / forged JWT rejection | Backend | `HS256`-signed token, `alg=none`, or wrong RSA key rejected with `401 Unauthorized` | `test_04_expired_revoked_idor_and_privilege_escalation_defenses` |
| **TC-10** | Role tampering & self-approval attempt | Backend | Extra `{"role":"ADMIN"}` field rejected (`422`); admin attempting `APPROVE` on own `user_id` rejected (`403`) | `test_01`, `test_04` |
| **TC-11** | Public user accessing staff endpoints | Backend | Unauthenticated calls to `/auth/me`, `/auth/availability`, `/visits`, `/admin/*` return `401`; public map/search/route remain `200` | `test_protected_endpoints_enforce_authentication` |
| **TC-12** | Faculty cross-record IDOR attempt | Backend | Faculty A attempting `PUT /auth/availability` with Faculty B's `staff_id` rejected (`403 Forbidden`) | `test_04_expired_revoked_idor_and_privilege_escalation_defenses` |
| **TC-13** | Non-admin accessing `/admin/*` endpoints | Backend | Approved `FACULTY` calling `/admin/users`, `/admin/allowlist`, or `/admin/accounts/{id}/decision` rejected (`403`) | `test_04_expired_revoked_idor_and_privilege_escalation_defenses` |
| **TC-14** | Logout & global session revocation | Backend + Mobile | `POST /auth/logout` revokes `jti` (`401` on reuse); `POST /auth/logout-all` advances `tokens_valid_after`; Keystore wiped | `test_03`, `test_04`, `cognitoAuth.test.ts` |
| **TC-15** | OAuth 2.0 Authorization Code + `S256` PKCE | Backend + Mobile | `/oauth2/authorize` + `/oauth2/token` rejects wrong `code_verifier` (`400`) and succeeds with valid SHA-256 verifier | `test_03_oauth2_pkce_s256_mfa_and_password_recovery_lifecycle`, `cognitoAuth.test.ts` |
| **TC-16** | Zero-password DB & AES-256-GCM inspection | Database + Backend | `information_schema.columns` has zero password/MFA/token columns; `AES-256-GCM` ciphertext fails on tampered AAD | `test_zero_password_database_and_aesgcm_roundtrip` |
| **TC-17** | Log redaction, rate limiting & prod posture | Backend | Bearer tokens/passwords/OTPs scrubbed to `[REDACTED]`; rapid brute-force triggers `429`; `APP_ENV=production` fails closed without Cognito IDs | `test_05_log_redaction_rate_limiting_and_production_posture` |
