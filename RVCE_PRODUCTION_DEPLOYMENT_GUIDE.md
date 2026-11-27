# RVCE Campus Navigator — Institutional Production Deployment & Security Guide

This guide explains how to deploy **RVCE Campus Navigator** onto the official **`rvce.edu.in`** institutional domain (e.g., `https://navigator.rvce.edu.in`)—either **on-premise in the RVCE TE Department Datacenter** or on a **Cloud CSP (AWS / Azure / GCP)**—with full transport, API, database, logging, and role-visibility hardening.

---

## 1. Deployment Architecture Options (TE Dept Datacenter vs. Cloud CSP)

| Component | Option A: RVCE TE Dept Datacenter (On-Premise) | Option B: Cloud CSP (AWS `ap-south-1` Mumbai) |
| :--- | :--- | :--- |
| **Domain & DNS** | Campus DNS `A` record: `navigator.rvce.edu.in -> Campus Public IP` | Route 53 / Cloud DNS -> Application Load Balancer (ALB) |
| **TLS / HTTPS Termination** | **Nginx** reverse proxy with institutional SSL/TLS 1.3 cert (or Let's Encrypt) | **AWS ACM** TLS 1.3 certificate on HTTPS Load Balancer |
| **FastAPI Backend** | `uvicorn` behind Nginx on `127.0.0.1:8000` (4 workers, systemd service) | ECS Fargate / EC2 behind ALB (`APP_ENV=production`) |
| **Identity Provider** | Institutional OIDC / Keycloak or Amazon Cognito User Pool (`@rvce.edu.in` + TOTP MFA) | Amazon Cognito User Pool (`COGNITO_USER_POOL_ID`, OAuth 2.0 PKCE `S256` + TOTP MFA) |
| **MySQL 8.0 (`campusguide`)** | Dedicated MySQL 8.0 instance on private VLAN (`127.0.0.1:3306`, **not** exposed publicly) | Amazon RDS for MySQL 8.0 in Private Subnet (encrypted at rest via KMS) |
| **MongoDB 9.0 (`campusguide_nosql`)** | Local / private VLAN MongoDB 9.0 (`127.0.0.1:27017`, auth enabled) | MongoDB Atlas / EC2 Private Subnet (`2dsphere` + `$jsonSchema` enabled) |

---

## 2. Securing Every Endpoint, Communication & Database Layer

### A. Never Expose API Documentation or Internal Ports in Production
When `APP_ENV=production` is set in `.env`:
1. **Swagger/OpenAPI Disabled ([main.py](file:///c:/Users/mohit/RVCE/5th%20sem/DBMS/DBMS%20LAB%20EL/backend/app/main.py))**:
   - `/docs`, `/redoc`, and `/openapi.json` are automatically set to `None` so external users cannot enumerate or probe API endpoints.
2. **Dev Sandbox Blocked ([settings.py](file:///c:/Users/mohit/RVCE/5th%20sem/DBMS/DBMS%20LAB%20EL/backend/app/config/settings.py))**:
   - `use_dev_oidc_sandbox` is forced `False` in production; `validate_security_posture()` refuses to start the server unless real `COGNITO_USER_POOL_ID` and `DATA_PROTECTION_KEY_B64` (AES-256-GCM key) are configured.
3. **Firewall / Port Isolation**:
   - Only **Port 443 (HTTPS)** is open to the internet/campus Wi-Fi at Nginx/ALB.
   - Ports **8000 (FastAPI)**, **3306 (MySQL)**, and **27017 (MongoDB)** listen strictly on `127.0.0.1` / private subnet.
4. **Strict CORS & Security Headers ([main.py](file:///c:/Users/mohit/RVCE/5th%20sem/DBMS/DBMS%20LAB%20EL/backend/app/main.py))**:
   - In production, wildcard CORS regex is disabled—only explicit `CORS_ORIGINS` (e.g., `https://navigator.rvce.edu.in`) are permitted.
   - Every response carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security`, and `Cache-Control: no-store` on `/auth`, `/admin`, and `/visits` routes.

### B. Database Least-Privilege & Encryption
- **Runtime DB Principal ([06_least_privilege_db_user.sql](file:///c:/Users/mohit/RVCE/5th%20sem/DBMS/DBMS%20LAB%20EL/database/mysql/06_least_privilege_db_user.sql))**: FastAPI connects as `campusguide_app` with `SELECT, INSERT, UPDATE, EXECUTE` only—**zero `DROP`, `ALTER`, `TRUNCATE`, or `DELETE` on `change_audit_log`**.
- **Zero-Password Storage**: `users` stores zero passwords or MFA secrets; logout revocations store only **SHA-256** digests in `revoked_token_jtis`, and recovery metadata uses **AES-256-GCM** (`DATA_PROTECTION_KEY_B64`).

---

## 3. Exception Handling & Rotating Audit/Error Logging
- **Global Exception Handlers ([main.py](file:///c:/Users/mohit/RVCE/5th%20sem/DBMS/DBMS%20LAB%20EL/backend/app/main.py))**:
  - `IntegrityError` -> HTTP `409` (`INTEGRITY_CONFLICT` + `error_id`)
  - `OperationalError` -> preserves MySQL `SIGNAL SQLSTATE '45000'` rule errors (`400 RULE_VIOLATION`), otherwise returns sanitized `503` (`DATABASE_UNAVAILABLE` + `error_id`)
  - Unhandled `Exception` -> returns sanitized `500` (`Ref: <error_id>`)—**never leaks Python stack traces or SQL queries to clients**.
- **Rotating File Logs**: All errors and tracebacks are written internally to `backend/logs/rvce_backend.log` (`5 MB × 5` rotation) filtered through `SensitiveLogRedactor` so JWTs, passwords, and TOTP codes are always `[REDACTED]`.

---

## 4. Clear-Cut Visibility Rules Matrix (Who Sees What)

| Data Resource | Public / Student (No Login) | Faculty (`FACULTY_STAFF`) | HoD (`DEPT_COORDINATOR`) | Gate Security (`SECURITY_RECEPTION`) | System Admin (`SYSTEM_ADMIN`) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Campus Map, Buildings & Facilities** | Active & Public only | Active & Public | Active & Public | Active & Public | Full CRUD + Maintenance |
| **Indoor Floor Plans & Rooms** | Only `approval_status = 'APPROVED'` & `public_visibility = TRUE` | Approved Public | Approved Public | Approved Public | Draft, Approved & Version Activation |
| **Faculty Directory & Availability** | Only `profile_visibility = 'PUBLIC'` + auto-expired truthful status | Public + Edit **own** availability/cabin (`linked_staff_id` IDOR guard) | Public + Own dept | Public | Full Directory Governance |
| **Visitor Passes (`visitor_logs`)** | **Write-only** (`POST /visits/pre-register`); receives only own pass code | Sees **only** passes where `host_staff_id == own linked_staff_id`; can Approve/Reject | Sees passes for **self** + **General Campus Visits** (`host_staff_id IS NULL`) | Sees **all** passes; Check-In / Check-Out | Sees **all** passes across campus |
| **Staff Accounts, Allowlist & Audit Logs** | **Blocked (`401`)** | **Blocked (`403`)** | **Blocked (`403`)** | **Blocked (`403`)** | Full Access (`users`, `allowlist`, `change_audit_log`, KPIs) |

---

## 5. Production `.env` Checklist (Before Going Live on Campus Server)
```ini
APP_ENV=production
CORS_ORIGINS=https://navigator.rvce.edu.in
COGNITO_REGION=ap-south-1
COGNITO_USER_POOL_ID=ap-south-1_XXXXXXXXX
COGNITO_APP_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
DATA_PROTECTION_KEY_B64=<32-byte-base64-key>
MYSQL_HOST=127.0.0.1
MYSQL_USER=campusguide_app
MYSQL_PASSWORD=<strong-kms-secret>
MYSQL_DATABASE=campusguide
MONGODB_URI=mongodb://rvce_mongo_app:<secret>@127.0.0.1:27017/campusguide_nosql
```
