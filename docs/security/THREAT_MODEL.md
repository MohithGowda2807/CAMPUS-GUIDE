# Threat Model — RVCE Campus Navigator Authentication & RBAC

Aligned with **STRIDE**, **OWASP ASVS v4.0.3 (L2)**, and **OWASP MASVS v2.1 (`MASVS-STORAGE`, `MASVS-AUTH`, `MASVS-NETWORK`, `MASVS-CODE`)**.

---

## 1. Trust Boundaries

1. **Boundary 1 — Public Mobile Device (`PUBLIC` / Untrusted Client) <-> FastAPI Backend**:
   - Any APK binary can be decompiled (`jadx` / `apktool`) and any HTTP request can be replayed or tampered with via an intercepting proxy.
2. **Boundary 2 — Mobile App <-> Amazon Cognito OIDC Provider**:
   - Crosses network and custom URL scheme (`rvce-navigator://auth/callback`) boundaries on Android.
3. **Boundary 3 — FastAPI Backend <-> MySQL (`campusguide`) & MongoDB (`campusguide_nosql`)**:
   - Separates stateless JWT validation/RBAC logic from persistent institutional state and audit logs.

---

## 2. STRIDE Threat Catalogue & Implemented Mitigations

| ID | STRIDE Category | Threat Scenario | OWASP Mapping | Mitigation Implemented | Residual Risk / Operational Control |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **T-01** | **Spoofing** | Non-RVCE user registers with `@gmail.com` or lookalike `@rvce.edu.in.evil.com` | ASVS V2.1, MASVS-AUTH-1 | Exact domain parser (`domain == "rvce.edu.in"`) on mobile, backend `normalize_and_validate_rvce_email`, and MySQL `CHECK` constraint | Ensure Cognito Pre-Sign-Up or SES domain restriction mirrors backend policy in AWS |
| **T-02** | **Elevation of Privilege** | Student or non-faculty `@rvce.edu.in` mailbox holder registers to gain Faculty Portal access | ASVS V4.1 | Verified email alone grants **zero** roles; non-allowlisted users land in `PENDING_APPROVAL` (`is_active=FALSE`) until `ADMIN` approval | Institutional HR/HoD must curate `staff_eligibility_allowlist` accurately |
| **T-03** | **Tampering / EoP** | Attacker injects `{"role": "ADMIN"}` in registration JSON or attempts self-approval | ASVS V4.1, V13.2 | Pydantic `ConfigDict(extra="forbid")` (`422`), server-side role resolution, and explicit `actor.user_id != target.user_id` self-approval block (`403`) | None in API path; DB direct writes restricted to `campusguide_app` |
| **T-04** | **Spoofing / Forgery** | Attacker crafts forged JWT signed with `HS256`, `none`, or wrong RSA key | ASVS V3.5 | `CognitoTokenVerifier` strictly requires `alg == "RS256"` against trusted JWKS, verifying `iss`, `client_id`/`aud`, `exp`, and `iat` | Keep `PyJWT` & `cryptography` patched |
| **T-05** | **Information Disclosure** | APK decompilation searches for embedded AWS keys, Cognito client secret, or demo passwords | MASVS-STORAGE-1, MASVS-CODE-4 | Public OIDC client with `S256` PKCE; zero client secrets, zero AWS keys, and zero hardcoded passwords in mobile codebase | Enforce CI secret scanning before releases |
| **T-06** | **Information Disclosure** | Stolen/compromised MySQL backup inspected for staff passwords or TOTP seeds | ASVS V2.4, V6.2 | `password_hash` and MFA secret columns do not exist in MySQL; recovery metadata encrypted with `AES-256-GCM` (`DATA_PROTECTION_KEY_B64`) | Store `DATA_PROTECTION_KEY_B64` in AWS Secrets Manager / KMS |
| **T-07** | **Tampering / IDOR** | Authenticated Faculty A sends `PUT /auth/availability` with Faculty B's `staff_id` | ASVS V4.2 | Backend compares target `staff_id` against `user.linked_staff_id`; non-admin cross-staff edits rejected with `403 Forbidden` | Covered by automated regression test `test_04` |
| **T-08** | **Information Disclosure** | Login or Forgot-Password probed to enumerate valid `@rvce.edu.in` staff accounts | ASVS V2.2 | Uniform login failure string (`"Invalid institutional email or password."`), uniform password-reset response, and sliding-window `429` rate limiting | Place AWS WAF / Reverse Proxy rate limits in front of production API |
| **T-09** | **Replay / Session Hijacking** | Stolen access/refresh token reused after staff signs out or loses phone | ASVS V3.3, MASVS-AUTH-3 | Short 15-min access token TTL, Keystore `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, `revoked_token_jtis` SHA-256 blocklist, and `tokens_valid_after` UTC cutoff on `logout-all` | Educate staff to use "Sign Out From All Devices" if phone is lost |
| **T-10** | **Authorization Code Interception** | Malicious Android app registers `rvce-navigator://` custom scheme to intercept OAuth code | RFC 8252, MASVS-AUTH-2 | `S256` PKCE binds authorization code to in-memory 256-bit `code_verifier`; intercepted `code` cannot be redeemed at `/oauth2/token` | Upgrade to Android App Links (`https://.../.well-known/assetlinks.json`) once production domain is assigned |
| **T-11** | **Repudiation** | Compromised or rogue admin approves unauthorised account and attempts to delete logs | ASVS V7.2 | MySQL `AFTER UPDATE` trigger (`trg_users_after_update`) + API audit logging; `campusguide_app` DB role lacks `DELETE` on `change_audit_log` | Ship production MySQL audit logs to append-only CloudWatch / S3 |
| **T-12** | **Denial of Service / Abuse** | Rapid repeated login or registration submissions overwhelm auth endpoints | ASVS V11.1 | Client-side submission lock + backend `SlidingWindowRateLimiter` (`429 Too Many Requests`) | Add upstream reverse-proxy / Cloudflare / ALB rate limiting in production |
