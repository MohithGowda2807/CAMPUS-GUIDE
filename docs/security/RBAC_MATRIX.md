# Role-Based Access Control (RBAC) Matrix

## 1. Security Enforcement Rules

1. **Default-Deny Backend Enforcement**: Every protected FastAPI route enforces `Depends(get_current_user)` or `Depends(require_roles(...))` on the server (`backend/app/auth/security.py`). Frontend visibility hides inapplicable UI cards for usability, **never** as a security boundary.
2. **Non-Selectable Roles**: Registration schemas (`CompleteRegistrationRequest`) use `ConfigDict(extra="forbid")` and accept zero role fields. Roles are assigned strictly via backend allowlist resolution (`staff_eligibility_allowlist`) or explicit `ADMIN` approval (`POST /api/v1/admin/accounts/{user_id}/decision`).
3. **Strict Record Ownership (Anti-IDOR)**: Faculty members (`FACULTY`) can update **only** their own linked `staff_id` availability and profile fields. Attempting to pass another faculty member's `staff_id` returns `403 Forbidden`.
4. **Unauthenticated Public Access Preserved**: `PUBLIC` users never require a Cognito token for campus map, directory, room search, or navigation endpoints.

---

## 2. Canonical Roles

| Role Code | Description | Assigned How |
| :--- | :--- | :--- |
| **`PUBLIC`** | Unauthenticated campus visitors, students, prospective parents, and guests | Implicit (no account required) |
| **`FACULTY`** *(+ `FACULTY_STAFF`, `DEPT_COORDINATOR`)* | Verified RVCE teaching/research faculty linked to an official `staff` directory record | Allowlist match (`FACULTY`) or `ADMIN` approval |
| **`STAFF`** *(+ `SECURITY_RECEPTION`, `FACILITY_ADMIN`)* | Verified RVCE administrative, estate, or main-gate reception staff | Allowlist match (`STAFF`) or `ADMIN` approval |
| **`ADMIN`** *(+ `SYSTEM_ADMIN`)* | Institutional portal administrators authorised to govern staff eligibility, campus entities, and audit trails | Controlled `ADMIN` assignment (self-approval blocked) |

*(Note: Accounts in `PENDING_APPROVAL`, `REJECTED`, `SUSPENDED`, or `REVOKED` state hold **zero** active permissions and are rejected with `403 Forbidden` by `get_current_user`.)*

---

## 3. Endpoint-to-Role Permission Matrix

| Endpoint | Method | `PUBLIC` | `PENDING_APPROVAL` | `FACULTY` | `STAFF` | `ADMIN` | Ownership / Constraint |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| `/api/v1/health` | `GET` | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | Public service status |
| `/api/v1/map/config` | `GET` | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | Approved GeoJSON & tile config |
| `/api/v1/buildings`, `/buildings/{id}` | `GET` | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | Public `ACTIVE` buildings only |
| `/api/v1/floors/{id}/floor-plan` | `GET` | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | Public schematic & rooms |
| `/api/v1/rooms/{id}` | `GET` | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | Public rooms & visible occupants |
| `/api/v1/departments`, `/faculty` | `GET` | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | `profile_visibility = 'PUBLIC'` only |
| `/api/v1/facilities`, `/search` | `GET` | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | Public campus search |
| `/api/v1/navigation/route` | `GET` | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | Walking & vehicle Dijkstra routing |
| `/api/v1/visits/pre-register` | `POST` | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | Public visitor gate pass request |
| `/api/v1/auth/config` | `GET` | ALLOW | ALLOW | ALLOW | ALLOW | ALLOW | Public OIDC client metadata (no secrets) |
| `/api/v1/auth/complete-registration` | `POST` | DENY (`401`) | ALLOW (Idempotent) | ALLOW | ALLOW | ALLOW | Requires verified `@rvce.edu.in` JWT |
| `/api/v1/auth/session-status` | `GET` | DENY (`401`) | ALLOW (Status only) | ALLOW | ALLOW | ALLOW | Returns onboarding state |
| `/api/v1/auth/me` | `GET` | DENY (`401`) | DENY (`403`) | ALLOW | ALLOW | ALLOW | Approved active accounts only |
| `/api/v1/auth/profile` | `GET` | DENY (`401`) | DENY (`403`) | ALLOW (Own) | ALLOW (Own) | ALLOW (Own) | Linked `staff_id` profile |
| `/api/v1/auth/profile` | `PATCH` | DENY (`401`) | DENY (`403`) | ALLOW (Own) | ALLOW (Own) | ALLOW (Own) | Own `staff_id` + 15m `auth_time` reauth |
| `/api/v1/auth/availability` | `PUT` | DENY (`401`) | DENY (`403`) | ALLOW (Own) | DENY (`403`) | ALLOW (Any) | `FACULTY` restricted to `user.linked_staff_id` |
| `/api/v1/auth/mfa-sync` | `POST` | DENY (`401`) | DENY (`403`) | ALLOW (Own) | ALLOW (Own) | ALLOW (Own) | Syncs Cognito MFA flag |
| `/api/v1/auth/logout`, `/logout-all` | `POST` | DENY (`401`) | ALLOW (Own) | ALLOW (Own) | ALLOW (Own) | ALLOW (Own) | Revokes JTI / advances `tokens_valid_after` |
| `/api/v1/visits` | `GET` | DENY (`401`) | DENY (`403`) | ALLOW (Hosted) | ALLOW | ALLOW | `FACULTY` sees hosted visits; Gate/Admin sees all |
| `/api/v1/visits` | `POST` | DENY (`401`) | DENY (`403`) | DENY (`403`) | ALLOW (Gate) | ALLOW | Express walk-in gate pass |
| `/api/v1/visits/{id}/action` | `POST` | DENY (`401`) | DENY (`403`) | ALLOW (Host approve) | ALLOW (Gate check-in/out) | ALLOW | Action-level role validation |
| `/api/v1/admin/users` | `GET` | DENY (`401`) | DENY (`403`) | DENY (`403`) | DENY (`403`) | ALLOW | Staff account governance list |
| `/api/v1/admin/accounts/{id}/decision` | `POST` | DENY (`401`) | DENY (`403`) | DENY (`403`) | DENY (`403`) | ALLOW | `actor.user_id != target.user_id` enforced |
| `/api/v1/admin/allowlist` | `GET/POST/DELETE` | DENY (`401`) | DENY (`403`) | DENY (`403`) | DENY (`403`) | ALLOW | `@rvce.edu.in` allowlist CRUD |
| `/api/v1/admin/buildings`, `/rooms` | `POST` | DENY (`401`) | DENY (`403`) | DENY (`403`) | ALLOW (Facility) | ALLOW | Audited directory mutations |
| `/api/v1/admin/reports/summary` | `GET` | DENY (`401`) | DENY (`403`) | DENY (`403`) | ALLOW | ALLOW | Aggregated operational KPIs |
| `/api/v1/admin/audit-logs` | `GET` | DENY (`401`) | DENY (`403`) | DENY (`403`) | ALLOW (Facility) | ALLOW | Read-only `change_audit_log` |
