# Security Test Results — RVCE Campus Navigator v2.2.0

**Execution Date:** 2026-11-05  
**Target Release:** `edu.rvce.campusguide` (`versionName="2.2.0"`, `versionCode=4`)

---

## 1. Automated Verification Summary

| Test Suite | Command | Result | Duration |
| :--- | :--- | :---: | :---: |
| **Backend API, Cognito RS256 OIDC, RBAC & DB Suite** | `.\backend\.venv\Scripts\pytest.exe backend/tests/ -v` | **12 / 12 PASSED** | `4.97s` |
| **Mobile TypeScript Strict Check** | `npx tsc --noEmit` (`mobile/`) | **EXIT 0 (0 errors)** | `~10s` |
| **Mobile Cognito Security & Routing Vitest Suite** | `vitest run --root "mobile"` | **79 / 79 PASSED** | `632ms` |
| **Web Frontend TypeScript + Production Build** | `npm run build` (`frontend/`) | **EXIT 0 (`tsc -b && vite build`)** | `1.08s` |
| **Web Routing Parity Vitest Suite** | `npx vitest run` (`frontend/`) | **64 / 64 PASSED** | `429ms` |
| **Mobile Source & Bundle Secret Scan** | Regex scan (`AKIA`, `client_secret`, `AWS_SECRET_ACCESS_KEY`, legacy demo passwords) | **0 SECRET HITS** | `<1s` |
| **Android Native Release Build** | `.\gradlew.bat :app:assembleRelease` | **BUILD SUCCESSFUL** (`91.15 MB`) | `3m 55s` |
| **Android Emulator Runtime Verification (`rvce_pixel6`)** | `adb install -r RVCE-Campus-Navigator-v2.2.0.apk` + `MainActivity` + `OkHttp` connectivity | **0 `AndroidRuntime` / `ReactNativeJS` crashes** | Verified |

---

## 2. Detailed Results for All 17 Security Scenarios

| Case ID | Scenario | Result | Evidence |
| :---: | :--- | :---: | :--- |
| **TC-01** | Allowlisted `@rvce.edu.in` registration & OTP confirmation | **PASS** | `test_01` verified automatic `APPROVED` activation & `FACULTY` role assignment |
| **TC-02** | Non-RVCE email domain rejection (`@gmail.com`, `@sub.rvce.edu.in`, `@rvce.edu.in.evil.com`) | **PASS** | Rejected by `test_02` (`400`/`422`) and `cognitoAuth.test.ts` |
| **TC-03** | Non-allowlisted `@rvce.edu.in` held in `PENDING_APPROVAL` | **PASS** | `test_01` verified `is_active=FALSE`, zero roles, `GET /auth/me` -> `403`, then `ADMIN` approval activates |
| **TC-04** | Unverified email login & registration blocked | **PASS** | `test_02` verified `EMAIL_NOT_VERIFIED` challenge & `403` on unverified claim |
| **TC-05** | Incorrect password & anti-enumeration error parity | **PASS** | `test_05` & `cognitoAuth.test.ts` verified uniform `"Invalid institutional email or password."` |
| **TC-06** | Password reset OTP & strong password enforcement | **PASS** | `test_03` verified full `forgot-password` -> `confirm-forgot-password` flow |
| **TC-07** | TOTP Authenticator MFA enrolment & login step-up | **PASS** | `test_03` verified RFC-6238 TOTP enrolment, wrong code rejection (`401`), valid code acceptance |
| **TC-08** | Expired `RS256` JWT rejection | **PASS** | `test_04` verified expired token returns `401 Unauthorized` |
| **TC-09** | Tampered / `HS256` / forged RSA signature rejection | **PASS** | `test_04` verified `HS256` and rogue RSA keys return `401 Unauthorized` |
| **TC-10** | Role injection (`{"role":"ADMIN"}`) & self-approval block | **PASS** | `test_01` & `test_04` verified `422` on extra fields and `403` on admin self-approval |
| **TC-11** | Public user blocked from staff APIs while public map remains open | **PASS** | `test_protected_endpoints_enforce_authentication` verified `401` on staff routes and `200` on public map/routing |
| **TC-12** | Cross-faculty availability IDOR blocked | **PASS** | `test_04` verified Faculty A modifying Faculty B `staff_id` returns `403 Forbidden` |
| **TC-13** | Non-admin blocked from `/admin/*` governance endpoints | **PASS** | `test_04` verified approved `FACULTY` receives `403 Forbidden` on `/admin/*` |
| **TC-14** | Single-session JTI revocation & global `logout-all` cutoff | **PASS** | `test_03` & `test_04` verified immediate `401` on revoked token reuse & `tokens_valid_after` UTC epoch cutoff |
| **TC-15** | OAuth 2.0 Authorization Code Flow + `S256` PKCE | **PASS** | `test_03` & `cognitoAuth.test.ts` verified wrong `code_verifier` fails (`400`) and valid SHA-256 verifier succeeds |
| **TC-16** | Zero-password MySQL schema & `AES-256-GCM` integrity | **PASS** | `test_zero_password_database_and_aesgcm_roundtrip` verified 0 password/MFA/token columns in `information_schema` |
| **TC-17** | Sensitive log redaction, `429` rate limiting & `production` posture | **PASS** | `test_05` verified `[REDACTED]` log output, `429` throttling, and fail-closed `validate_security_posture()` |

---

## 3. Scope Disclaimer

- Automated unit, integration, RBAC, cryptographic, static secret scan, and Android emulator runtime checks passed cleanly.
- **Independent External Penetration Test**: Not yet performed. As documented in `DEPLOYMENT_CHECKLIST.md`, an independent third-party penetration test, institutional HR allowlist sign-off, DPDP privacy review, and live AWS Cognito User Pool provisioning are required prior to production launch.
