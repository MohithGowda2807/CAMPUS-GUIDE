# System & Hybrid Database Architecture

## 1. Architectural Overview

The **RVCE Campus Navigation & Visitor Management Portal** separates structured relational transactions from semi-structured spatial overlays and telemetry across two dedicated database engines:

1. **MySQL 8.0+ (`campusguide`)** — System of record for all institutional entities, access control, referential integrity, visitor pass lifecycles, and immutable administrative audit trails.
2. **MongoDB 9.0+ (`campusguide_nosql`)** — Geospatial `2dsphere` store for outdoor GeoJSON polygons, non-geographic indoor floor-plan vector overlays (`NORMALIZED_1000`), and high-write search telemetry pipelines.

The React + TypeScript frontend communicates exclusively with the Python FastAPI backend over REST (`/api/v1/*`); no client ever accesses either database directly.

---

## 2. Relational Database Design — MySQL 8.0 (`campusguide`)

### 2.1 Third Normal Form (3NF) Verification

All **15 InnoDB tables** in `database/mysql/01_schema.sql` satisfy First, Second, and Third Normal Forms:
- **Atomic attributes (1NF):** Multi-valued role assignments (`user_roles`), floor rooms (`rooms`), and per-visit logs (`visitor_logs`) are decomposed into dedicated relation tables. Search telemetry was extracted out of `visitor_logs` to eliminate unrelated repeating attributes.
- **Full functional dependency on candidate keys (2NF):** Every non-prime attribute in composite-key junctions (`user_roles(user_id, role_id)`) depends on the whole key; entity attributes reside in `users` and `roles`.
- **Zero transitive dependencies (3NF):**
  - Department attributes (`dept_code`, `dept_name`, `official_email`) are stored once in `departments` and referenced via `dept_id` from `rooms` and `staff`.
  - Repeat visitor identity (`full_name`, `contact_phone`, `contact_email`, `organization`) is normalized into `visitors`, while per-visit timestamps, host approvals, and gate checkpoints reside in `visitor_logs`.
  - Dynamic faculty status (`faculty_availability`) is separated from permanent `staff` profiles.

### 2.2 Core Relational Tables & Constraints

| Table | Primary Key | Key Foreign Keys & Rules | Integrity Constraints & Indexes |
|---|---|---|---|
| `campuses` | `campus_id` | — | `UNIQUE(campus_code)`, `CHECK` lat `[-90,90]` & lng `[-180,180]` |
| `departments` | `dept_id` | — | `UNIQUE(dept_code)`, `UNIQUE(dept_name)` |
| `buildings` | `building_id` | `campus_id → campuses` (`RESTRICT`) | `UNIQUE(campus_id, building_code)`, `FULLTEXT(building_name, building_code, description)` |
| `floors` | `floor_id` | `building_id → buildings` (`RESTRICT`) | `UNIQUE(building_id, floor_number)` |
| `rooms` | `room_id` | `floor_id → floors` (`RESTRICT`), `dept_id → departments` (`SET NULL`) | `UNIQUE(floor_id, room_number)`, `FULLTEXT(room_number, room_name, description)` |
| `floor_plans` | `floor_plan_id` | `floor_id → floors` (`RESTRICT`), `approved_by_user_id → users` (`SET NULL`) | `UNIQUE(floor_id, version_label)`, `CHECK(canvas_width > 0 AND canvas_height > 0)` |
| `facilities` | `facility_id` | `campus_id` (`RESTRICT`), nullable `building_id`, `floor_id`, `room_id` (`SET NULL`) | Supports both standalone outdoor POIs and indoor room-linked amenities |
| `staff` | `staff_id` | `dept_id → departments` (`RESTRICT`), `office_room_id → rooms` (`SET NULL`) | `UNIQUE(employee_code)`, `FULLTEXT(display_name, designation, employee_code)` |
| `faculty_availability` | `availability_id` | `staff_id → staff` (`CASCADE`), `updated_by_user_id → users` (`SET NULL`) | `CHECK(valid_until IS NULL OR valid_until > valid_from)` |
| `roles` | `role_id` | — | `UNIQUE(role_code)` |
| `users` | `user_id` | `linked_staff_id → staff` (`SET NULL`) | `UNIQUE(username)`, `UNIQUE(email)`, `UNIQUE(linked_staff_id)` |
| `user_roles` | `(user_id, role_id)` | `user_id → users` (`CASCADE`), `role_id → roles` (`RESTRICT`) | Composite PK enforcing M:N RBAC mapping |
| `visitors` | `visitor_id` | — | Indexed on `contact_phone` and `full_name` |
| `visitor_logs` | `visit_id` | `visitor_id` (`RESTRICT`), `campus_id` (`RESTRICT`), `destination_building_id`, `destination_room_id`, `host_staff_id` (`SET NULL`) | `UNIQUE(visit_pass_code)`, `CHECK(check_out_at >= check_in_at)` |
| `change_audit_log` | `log_id` | `user_id → users` (`SET NULL`) | JSON `old_value` / `new_value` snapshots indexed by `(table_name, record_id, changed_at)` |

### 2.3 Views (`database/mysql/02_views.sql`)
- `vw_public_building_directory`: Joins `buildings`, `campuses`, `floors`, `rooms`, and `floor_plans` to compute mapped floor counts, public room counts, and approved floor-plan counts without exposing restricted records.
- `vw_public_room_directory`: Pre-joins the 4-level hierarchy (`Campus → Building → Floor → Room`) and department metadata for unified search and indoor navigation.
- `vw_public_faculty_directory`: Resolves each public staff member's latest `faculty_availability` record and dynamically evaluates `valid_until < CURRENT_TIMESTAMP` to return `'UNKNOWN'` when stale.
- `vw_security_visitor_board`: Denormalized operational view for authorised reception staff with live `TIMESTAMPDIFF` visit duration calculations.
- `vw_daily_visitor_analytics`: Aggregated daily check-in, active-inside, pending-host-approval, and average-duration metrics per gate and destination building.

### 2.4 Triggers (`database/mysql/03_triggers.sql`)
- `trg_floor_plans_before_insert` / `trg_floor_plans_before_update`: Blocks activating any floor plan (`is_active_public = TRUE`) unless `approval_status = 'APPROVED'` via `SIGNAL SQLSTATE '45000'`.
- `trg_visitor_logs_before_update`: Enforces valid visit state transitions (rejects checking in a `CANCELLED` or `REJECTED` pass; rejects checking out prior to check-in; guarantees `check_in_at` / `check_out_at` timestamps).
- `trg_buildings_after_update`, `trg_rooms_after_update`, `trg_staff_after_update`, `trg_visitor_logs_after_insert`, `trg_visitor_logs_after_update`: Automatically append structured `JSON_OBJECT` before/after snapshots into `change_audit_log` using the session-bound `@current_app_user_id`.

### 2.5 Transactional Stored Procedures (`database/mysql/04_procedures.sql`)
- `sp_register_visitor_pass`: Executes an ACID transaction with `DECLARE EXIT HANDLER FOR SQLEXCEPTION ROLLBACK` to match or insert `visitors`, generate sequential pass codes (`RVCE-YYYYMMDD-NNNN`), and insert `visitor_logs`.
- `sp_record_gate_action`: Atomically applies `CHECK_IN`, `CHECK_OUT`, `APPROVE_HOST`, `REJECT_HOST`, and `CANCEL` transitions.
- `sp_activate_floor_plan`: Uses `SELECT ... FOR UPDATE` row locking to supersede any prior active floor plan on the target floor before promoting the newly approved revision.
- `sp_expire_faculty_statuses` & `sp_campus_operations_summary`: Batch status expiration and multi-resultset KPI reporting.

---

## 3. Document & Geospatial Store — MongoDB 9.0 (`campusguide_nosql`)

Configured in `database/mongodb/init_nosql.py` with server-side `$jsonSchema` validation:

1. **`campus_geometries`**
   - Stores GeoJSON `Polygon` and `Point` features for campus boundaries, building footprints, and gate entrances, linked to MySQL via `(entity_type, mysql_id)`.
   - Indexed with a `2dsphere` index (`idx_geo_2dsphere`) for spatial queries.
2. **`floor_plan_overlays`**
   - Stores local-coordinate (`NORMALIZED_1000`: `1000 × 650` canvas) room polygons, walkable corridors, vertical circulation landmarks (`LIFT`, `STAIRS`, `ENTRANCE`), and optional indoor routing graphs.
   - Keeps indoor schematic coordinates strictly isolated from outdoor WGS84 latitude/longitude.
3. **`search_telemetry`**
   - Captures anonymised search terms, category filters, result counts, and latency (`duration_ms`) with a 180-day TTL retention index (`ttl_search_telemetry_180d`).
   - Queried via MongoDB Aggregation Pipelines (`$match`, `$group`, `$sort`, `$avg`) in `/api/v1/admin/reports/summary` to surface high-demand destinations and unmatched search terms.
4. **`system_events`**
   - Operational audit & lifecycle event stream with automatic 90-day TTL expiration.
