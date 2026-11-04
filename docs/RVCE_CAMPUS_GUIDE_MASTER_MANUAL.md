# RVCE Campus Navigation & Visitor Management Portal
## Comprehensive 0–100 Master Manual: Developer Reference & User Operating Guide

---

## Table of Contents
1. [Executive Overview & System Purpose](#1-executive-overview--system-purpose)
2. [High-Level Architecture & Technology Stack](#2-high-level-architecture--technology-stack)
3. [Relational Database Specification — MySQL 8.0 (3NF)](#3-relational-database-specification--mysql-80-3nf)
4. [Document & Geospatial Store — MongoDB 9.0](#4-document--geospatial-store--mongodb-90)
5. [Offline-First Resilience & Fallback Data Architecture](#5-offline-first-resilience--fallback-data-architecture)
6. [Backend REST API Reference (0 to 100 Endpoints)](#6-backend-rest-api-reference-0-to-100-endpoints)
7. [Frontend Architecture & UI/UX Design System](#7-frontend-architecture--uiux-design-system)
8. [Mobile Architecture — Android & Capacitor](#8-mobile-architecture--android--capacitor)
9. [User Manual: Visitor & Public Workflows](#9-user-manual-visitor--public-workflows)
10. [User Manual: Security Gate & Reception Desk](#10-user-manual-security-gate--reception-desk)
11. [User Manual: Faculty & Staff Portal](#11-user-manual-faculty--staff-portal)
12. [User Manual: Institutional Administration](#12-user-manual-institutional-administration)
13. [Operations, Deployment & Troubleshooting Guide](#13-operations-deployment--troubleshooting-guide)

---

## 1. Executive Overview & System Purpose

The **RVCE Campus Navigation & Visitor Management Portal** is a production-grade, enterprise-ready smart campus software suite built specifically for **R. V. College of Engineering (RVCE), Mysuru Road, Bengaluru – 560059**. 

### Core Problems Solved
1. **Wayfinding in a 52-Acre Campus**: RVCE spans dozens of interconnected academic blocks, research centres, food courts, auditoriums, and hostels. Visitors, first-year students, and industry delegates frequently struggle to locate specific departments, labs, and faculty cabins.
2. **Disorganized Visitor Reception**: Traditional physical visitor logbooks at security gates lead to bottlenecks, lost records, zero host verification, and lack of real-time visibility into visitors currently inside the campus.
3. **Faculty Availability Uncertainty**: Visitors often travel to campus only to discover a faculty member is in class, on deputation, or attending an administrative committee meeting.
4. **Physical Phone & Network Constraints**: On-campus Wi-Fi networks frequently enforce client isolation (blocking peer-to-peer laptop connections), while cellular connectivity can be spotty indoors. The system solves this with **100% offline-first resilience**, bundling all campus data into the mobile APK.

### Key Capabilities Matrix
- **Interactive Geospatial Map**: Real OpenStreetMap tiles overlaid with 29 verified GeoJSON polygons (campus boundary + 28 building footprints).
- **Multi-Modal Campus Routing**: Computes shortest-path navigation between any two campus locations with support for pedestrian walkways and vehicular roads.
- **Official Faculty Directory**: 339 faculty profiles extracted directly from the official April 2026 RVCE roster across 20 academic departments.
- **Pass Lifecycle & Security Gate System**: Self-service visitor pre-registration, QR-compatible pass codes (`RVCE-YYYYMMDD-NNNN`), check-in, check-out, and host approval workflows.
- **Staff & Admin Portals**: Role-based portal for staff to update real-time availability (In Office, In Lecture, In Meeting, On Leave) and for administrators to manage buildings, rooms, users, and audit trails.
- **Native Android APK (`RVCE_Campus_Guide_v1.0.apk`)**: Built with Capacitor, featuring a native bottom navigation bar, safe-area inset management, and a one-click Cloudflare/LAN server switcher.

---

## 2. High-Level Architecture & Technology Stack

```
                                    +-------------------------------------------------------+
                                    |                CLIENT LAYER                           |
                                    |  • Modern Desktop Browser (http://localhost:5173)     |
                                    |  • Native Android Mobile App (Capacitor 8.6 APK)      |
                                    +-------------------------------------------------------+
                                                                |
                                             REST HTTP/HTTPS    |  CORS Regex: ^https?://.*|^capacitor://.*
                                                                v
                                    +-------------------------------------------------------+
                                    |             REVERSE PROXY / TUNNEL                    |
                                    |  • Local Direct LAN: http://192.168.1.7:8000          |
                                    |  • Public Cloudflare: https://*.trycloudflare.com     |
                                    +-------------------------------------------------------+
                                                                |
                                                                v
                                    +-------------------------------------------------------+
                                    |             FASTAPI APPLICATION (PORT 8000)           |
                                    |  • Pydantic v2 Request/Response Validation            |
                                    |  • PyJWT Authentication & Role-Based Access Control   |
                                    |  • Routing & Multi-Modal Distance Engines             |
                                    +-------------------------------------------------------+
                                              /                                   \
                       SQLAlchemy 2.0 (PyMySQL)                                    PyMongo Driver
                                            /                                       \
                                           v                                         v
               +--------------------------------------+           +--------------------------------------+
               |          MYSQL 8.0 ENGINE            |           |         MONGODB 9.0 ENGINE           |
               |          DB: `campusguide`           |           |      DB: `campusguide_nosql`         |
               | • 15 Tables in Strict 3NF            |           | • GeoJSON 2dsphere Geospatial Index  |
               | • 6 Relational Aggregation Views     |           | • 29 Campus Footprint Polygons       |
               | • 7 Before/After Audit Triggers      |           | • Pedestrian & Road Graph Network    |
               | • 5 ACID Transaction Stored Procs    |           | • Indoor Vector Floor Plan Overlays  |
               +--------------------------------------+           +--------------------------------------+
```

### Complete Stack Breakdown
| Tier | Technology | Purpose & Version |
|---|---|---|
| **Frontend Core** | React 19.3 + TypeScript 5.8 | Component-based reactive user interface with strict compile-time types |
| **Styling & Icons** | Tailwind CSS v4 + Lucide React | Institutional deep navy (`#27447E`) design language, safe-area insets |
| **Mapping Engine** | Leaflet 1.9 + React-Leaflet | Hardware-accelerated GIS map rendering, polygon overlays, custom markers |
| **Build & Tooling** | Vite 8.3 + Oxlint | 700ms modern client bundler and high-performance linter |
| **Mobile Runtime** | Capacitor 8.6 + Android Studio SDK 36 | Cross-platform native Android bridge with Android 15/16 platform target |
| **Backend Framework** | Python 3.12 + FastAPI 0.115 + Uvicorn | Async ASGI REST API, automatic OpenAPI / Swagger documentation |
| **Relational DB** | MySQL 8.0 Community Server | ACID relational core, foreign key constraints, 3NF normalization |
| **Document/GIS DB** | MongoDB 9.0 Community Server | GeoJSON 2dsphere spatial indexes, pathway networks, telemetry |
| **Tunneling** | Cloudflare Tunnel (`cloudflared 2026.2`) | Zero-cost instant public HTTPS tunnel for remote mobile access |

---

## 3. Relational Database Specification — MySQL 8.0 (3NF)

Database Name: `campusguide`  
Engine: `InnoDB`  
Character Set: `utf8mb4`  
Collation: `utf8mb4_unicode_ci`

### 3.1 Third Normal Form (3NF) Verification
1. **First Normal Form (1NF)**: All attributes contain atomic values. Repeating groups such as user roles (`user_roles`), multiple floor rooms (`rooms`), and multiple visit logs (`visitor_logs`) have been extracted into independent relational tables.
2. **Second Normal Form (2NF)**: All tables with composite primary keys (`user_roles`) have every non-key attribute fully dependent on the entire composite key.
3. **Third Normal Form (3NF)**: Zero transitive dependencies exist.
   - Department details (`dept_name`, `official_email`) belong exclusively to `departments` and are referenced via `dept_id`.
   - Visitor demographics (`full_name`, `contact_phone`, `organization`) belong to `visitors`, while per-visit appointment records reside in `visitor_logs`.
   - Dynamic faculty presence is separated from static staff metadata into `faculty_availability`.

### 3.2 Relational Schema Table Catalog (All 15 Tables)

```
                                  +-------------------+
                                  |     campuses      |
                                  +---------+---------+
                                            | 1
                                            |
                                            | N
       +------------------------------------+------------------------------------+
       |                                    |                                    |
+------v------------+             +---------v---------+                +---------v---------+
|    buildings      |             |    departments    |                |    facilities     |
+------+------------+             +----+---------+----+                +-------------------+
       | 1                             | 1       | 1
       |                               |         |
       | N                             | N       | N
+------v------------+             +----v----+  +-v-----------------+
|     floors        |             |  rooms  |  |      staff        |
+------+------------+             +----+----+  +----+---------+----+
       | 1                             | 1          | 1       | 1
       |                               |            |         |
       | N                             | N          | N       | 1
+------v------------+                  |       +----v----+  +-v-----------------+
|   floor_plans     |                  |       | users   |  |faculty_availablty |
+-------------------+                  |       +----+----+  +-------------------+
                                       |            | 1
                                       |            |
                                       | N          | N
                                  +----v------------v---+
                                  |    visitor_logs     |
                                  +----------+----------+
                                             | N
                                             |
                                             | 1
                                  +----------v----------+
                                  |      visitors       |
                                  +---------------------+
```

#### 1. `campuses`
Represents the primary physical institution boundary.
- `campus_id` (INT, PK, Auto-Increment)
- `campus_code` (VARCHAR(30), UNIQUE) — e.g., `'RVCE-MAIN'`
- `campus_name` (VARCHAR(150)) — `'R. V. College of Engineering'`
- `address` (TEXT)
- `latitude` (DECIMAL(10,8), CHECK between -90 and 90)
- `longitude` (DECIMAL(11,8), CHECK between -180 and 180)
- `default_zoom` (TINYINT) — `17`
- `verification_status` (ENUM: `DRAFT`, `VERIFIED`, `ARCHIVED`)
- `created_at`, `updated_at` (TIMESTAMP)

#### 2. `departments`
Academic and central administrative departments.
- `dept_id` (INT, PK, Auto-Increment)
- `dept_code` (VARCHAR(20), UNIQUE) — e.g., `'CSE'`, `'AIML'`, `'ECE'`, `'ME'`
- `dept_name` (VARCHAR(150), UNIQUE)
- `dept_category` (ENUM: `'ENGINEERING'`, `'PG_PROGRAMME'`, `'BASIC_SCIENCES'`, `'CAMPUS_CENTRAL'`)
- `short_description` (TEXT)
- `official_email` (VARCHAR(150))
- `primary_building_id` (INT, FK -> `buildings.building_id`, SET NULL)
- `verification_status` (ENUM)

#### 3. `buildings`
Physical architectural structures on campus.
- `building_id` (INT, PK, Auto-Increment)
- `campus_id` (INT, FK -> `campuses.campus_id`, RESTRICT)
- `building_code` (VARCHAR(30)) — UNIQUE within campus (`UNIQUE(campus_id, building_code)`)
- `building_name` (VARCHAR(150))
- `building_type` (ENUM: `'ACADEMIC_BLOCK'`, `'ADMINISTRATION'`, `'LABORATORY_COMPLEX'`, `'LIBRARY'`, `'AUDITORIUM'`, `'HOSTEL'`, `'AMENITIES'`, `'SECURITY_GATE'`)
- `description` (TEXT)
- `latitude` (DECIMAL(10,8)), `longitude` (DECIMAL(11,8))
- `total_floors` (TINYINT)
- `is_accessible` (BOOLEAN) — Wheelchair access
- `status` (ENUM: `'ACTIVE'`, `'INACTIVE'`, `'UNDER_MAINTENANCE'`)
- `verification_status` (ENUM)

#### 4. `floors`
Horizontal floor partitions within buildings.
- `floor_id` (INT, PK, Auto-Increment)
- `building_id` (INT, FK -> `buildings.building_id`, RESTRICT)
- `floor_number` (TINYINT) — e.g., `0` for Ground Floor, `1` for 1st Floor (`UNIQUE(building_id, floor_number)`)
- `floor_name` (VARCHAR(80)) — e.g., `'Ground Floor'`, `'First Floor'`
- `display_order` (SMALLINT)
- `has_lift_access` (BOOLEAN)

#### 5. `rooms`
Individual indoor destination units (classrooms, labs, faculty cabins, department offices).
- `room_id` (INT, PK, Auto-Increment)
- `floor_id` (INT, FK -> `floors.floor_id`, RESTRICT)
- `dept_id` (INT, FK -> `departments.dept_id`, SET NULL)
- `room_number` (VARCHAR(40)) — UNIQUE per floor (`UNIQUE(floor_id, room_number)`)
- `room_name` (VARCHAR(120))
- `room_type` (ENUM: `'CLASSROOM'`, `'LABORATORY'`, `'FACULTY_CABIN'`, `'HOD_OFFICE'`, `'SEMINAR_HALL'`, `'RESTROOM'`, `'ADMIN_OFFICE'`, `'UTILITY'`)
- `capacity` (SMALLINT)
- `is_accessible` (BOOLEAN)

#### 6. `floor_plans`
Architectural floor plan drawings and vector map configurations.
- `floor_plan_id` (INT, PK, Auto-Increment)
- `floor_id` (INT, FK -> `floors.floor_id`, RESTRICT)
- `version_label` (VARCHAR(40)) — e.g., `'v1.0-2026'` (`UNIQUE(floor_id, version_label)`)
- `file_format` (ENUM: `'SVG'`, `'PNG'`, `'JSON_VECTOR'`)
- `image_url` (VARCHAR(500))
- `canvas_width` (INT, CHECK > 0), `canvas_height` (INT, CHECK > 0)
- `approval_status` (ENUM: `'DRAFT'`, `'REVIEW'`, `'APPROVED'`, `'REJECTED'`)
- `approved_by_user_id` (INT, FK -> `users.user_id`, SET NULL)
- `is_active_public` (BOOLEAN) — Only 1 active plan allowed per floor

#### 7. `facilities`
Points of interest across campus (both standalone outdoor and indoor amenities).
- `facility_id` (INT, PK, Auto-Increment)
- `campus_id` (INT, FK -> `campuses.campus_id`, RESTRICT)
- `building_id` (INT, FK -> `buildings.building_id`, SET NULL)
- `floor_id` (INT, FK -> `floors.floor_id`, SET NULL)
- `room_id` (INT, FK -> `rooms.room_id`, SET NULL)
- `facility_name` (VARCHAR(150))
- `category` (ENUM: `'CAFETERIA_FOOD'`, `'BANK_ATM'`, `'MEDICAL_FIRST_AID'`, `'LIBRARY'`, `'AUDITORIUM_HALL'`, `'SPORTS_FITNESS'`, `'PARKING'`, `'GATE_RECEPTION'`, `'RESTROOM'`, `'ADMIN_SERVICE'`)
- `latitude` (DECIMAL(10,8)), `longitude` (DECIMAL(11,8))
- `opening_hours` (VARCHAR(100))
- `is_accessible` (BOOLEAN)

#### 8. `staff`
Institutional faculty and administrative roster (339 profiles loaded from official April 2026 RVCE roster).
- `staff_id` (INT, PK, Auto-Increment)
- `employee_code` (VARCHAR(40), UNIQUE) — Official 4-digit RVCE ID (e.g., `'5611'`, `'1042'`)
- `display_name` (VARCHAR(150)) — Full official title & name
- `dept_id` (INT, FK -> `departments.dept_id`, RESTRICT)
- `office_room_id` (INT, FK -> `rooms.room_id`, SET NULL)
- `qualification` (VARCHAR(100)) — e.g., `'Ph.D'`, `'M.Tech'`, `'M.Sc'`
- `designation` (VARCHAR(120)) — e.g., `'Professor'`, `'Associate Professor'`, `'Assistant Professor'`
- `cadre_rank` (TINYINT) — `1: Principal, 2: Professor, 3: Assoc. Prof, 4: Asst. Prof (Sel. Grade), 5: Asst. Prof (Sr. Scale), 6: Asst. Prof`
- `program_name` (VARCHAR(120)) — e.g., `'UG - Computer Science & Engineering'`
- `leadership_role` (VARCHAR(100), Nullable) — e.g., `'HOD'`, `'Dean (Student Affairs)'`
- `staff_type` (ENUM: `'FACULTY'`, `'TECHNICAL_STAFF'`, `'ADMINISTRATIVE'`, `'SECURITY'`)
- `date_of_joining` (DATE)
- `professor_designated_date` (DATE, Nullable)
- `years_at_rvce` (INT, Nullable)
- `association_nature` (ENUM: `'REGULAR'`, `'CONTRACT'`, `'ADJUNCT'`)
- `employment_mode` (ENUM: `'FULL_TIME'`, `'PART_TIME'`)
- `deputation_remarks` (VARCHAR(255), Nullable) — Lien / Deputation notes
- `public_email` (VARCHAR(150))
- `official_profile_url` (VARCHAR(500))
- `verification_status` (ENUM)

#### 9. `faculty_availability`
Dynamic, time-expiring presence state for faculty.
- `availability_id` (BIGINT, PK, Auto-Increment)
- `staff_id` (INT, FK -> `staff.staff_id`, CASCADE)
- `availability_state` (ENUM: `'AVAILABLE'`, `'IN_MEETING'`, `'IN_LECTURE'`, `'ON_LEAVE'`, `'OUT_OF_OFFICE'`, `'UNKNOWN'`)
- `public_note` (VARCHAR(255))
- `valid_from` (TIMESTAMP)
- `valid_until` (TIMESTAMP, Nullable)
- `updated_by_user_id` (INT, FK -> `users.user_id`, SET NULL)

#### 10. `roles`
Role-based access control dictionary.
- `role_id` (INT, PK, Auto-Increment)
- `role_code` (VARCHAR(40), UNIQUE) — `'SYSTEM_ADMIN'`, `'DEPT_ADMIN'`, `'FACULTY_STAFF'`, `'SECURITY_RECEPTION'`, `'PUBLIC_VISITOR'`
- `role_name` (VARCHAR(80))
- `description` (TEXT)

#### 11. `users`
System user credentials and identity authentication.
- `user_id` (INT, PK, Auto-Increment)
- `username` (VARCHAR(60), UNIQUE)
- `email` (VARCHAR(150), UNIQUE)
- `password_hash` (VARCHAR(255)) — Salted bcrypt/argon2 hash
- `linked_staff_id` (INT, UNIQUE, FK -> `staff.staff_id`, SET NULL)
- `auth_provider` (ENUM: `'LOCAL'`, `'INSTITUTIONAL_SSO'`)
- `is_active` (BOOLEAN)
- `last_login_at` (TIMESTAMP)

#### 12. `user_roles`
Many-to-Many junction enforcing composite key RBAC.
- `user_id` (INT, FK -> `users.user_id`, CASCADE)
- `role_id` (INT, FK -> `roles.role_id`, RESTRICT)
- **Primary Key**: `(user_id, role_id)`

#### 13. `visitors`
Demographic profile of campus guests (normalized to prevent data redundancy across repeat visits).
- `visitor_id` (INT, PK, Auto-Increment)
- `full_name` (VARCHAR(150))
- `contact_phone` (VARCHAR(25), INDEXED)
- `contact_email` (VARCHAR(150))
- `organization` (VARCHAR(150))
- `created_at` (TIMESTAMP)

#### 14. `visitor_logs`
Individual visit authorization instances, gate logs, and approvals.
- `visit_id` (INT, PK, Auto-Increment)
- `visit_pass_code` (VARCHAR(50), UNIQUE) — e.g., `'RVCE-20261104-1042'`
- `visitor_id` (INT, FK -> `visitors.visitor_id`, RESTRICT)
- `campus_id` (INT, FK -> `campuses.campus_id`, RESTRICT)
- `destination_building_id` (INT, FK -> `buildings.building_id`, SET NULL)
- `destination_room_id` (INT, FK -> `rooms.room_id`, SET NULL)
- `host_staff_id` (INT, FK -> `staff.staff_id`, SET NULL)
- `purpose` (VARCHAR(255))
- `gate_name` (VARCHAR(80)) — e.g., `'Gate 1 (Mysuru Road Entrance)'`
- `approval_status` (ENUM: `'NOT_REQUIRED'`, `'PENDING'`, `'APPROVED'`, `'REJECTED'`)
- `visit_status` (ENUM: `'REGISTERED'`, `'CHECKED_IN'`, `'CHECKED_OUT'`, `'CANCELLED'`)
- `scheduled_at` (TIMESTAMP)
- `check_in_at` (TIMESTAMP, Nullable)
- `check_out_at` (TIMESTAMP, Nullable, CHECK `check_out_at >= check_in_at`)
- `registered_by_user_id` (INT, FK -> `users.user_id`, SET NULL)

#### 15. `change_audit_log`
Immutable administrative audit ledger storing JSON before/after snapshots.
- `log_id` (BIGINT, PK, Auto-Increment)
- `user_id` (INT, FK -> `users.user_id`, SET NULL)
- `actor_username` (VARCHAR(60))
- `action_type` (ENUM: `'INSERT'`, `'UPDATE'`, `'DELETE'`)
- `table_name` (VARCHAR(60), INDEXED)
- `record_id` (BIGINT, INDEXED)
- `old_value` (JSON, Nullable)
- `new_value` (JSON, Nullable)
- `changed_at` (TIMESTAMP, INDEXED)

---

### 3.3 Relational Views (`02_views.sql`)
1. **`vw_public_building_directory`**: Aggregates total mapped floors, approved plans, and public rooms per building.
2. **`vw_public_room_directory`**: Resolves the complete 4-tier hierarchy (`Campus → Building → Floor → Room`) with department codes.
3. **`vw_public_faculty_directory`**: Dynamic view joining `staff`, `departments`, `rooms`, and `faculty_availability`. Automatically evaluates if `valid_until < CURRENT_TIMESTAMP` to revert expired statuses back to `'AVAILABLE'` or `'UNKNOWN'`.
4. **`vw_department_directory`**: Computes department-level statistics: total faculty, Ph.D holders count, full professor count, assigned spaces, and resolved HOD name.
5. **`vw_security_visitor_board`**: Live operations board for security gates displaying active passes, duration inside using `TIMESTAMPDIFF(MINUTE, check_in_at, NOW())`, and destination building name.
6. **`vw_daily_visitor_analytics`**: Aggregated daily visitor throughput, peak gates, and host approval ratios.

### 3.4 Relational Triggers (`03_triggers.sql`)
- **`trg_floor_plans_before_insert` & `trg_floor_plans_before_update`**: Blocks setting `is_active_public = TRUE` if `approval_status != 'APPROVED'` by throwing a custom MySQL exception `SIGNAL SQLSTATE '45000'`.
- **`trg_visitor_logs_before_update`**: Enforces strict lifecycle state machines (e.g., cannot check-in a cancelled or rejected pass; automatically sets `check_in_at` on check-in and `check_out_at` on check-out).
- **`trg_buildings_after_update`**, **`trg_rooms_after_update`**, **`trg_staff_after_update`**, **`trg_visitor_logs_after_update`**: Automatically serialize the old and new row states as JSON and write to `change_audit_log`.

### 3.5 Stored Procedures (`04_procedures.sql`)
- **`sp_register_visitor_pass`**: Fully transactional visitor creation. Checks if visitor phone already exists; if not, registers visitor; generates unique sequential code `RVCE-YYYYMMDD-XXXX`; writes `visitor_logs` with `ROLLBACK` on error.
- **`sp_record_gate_action`**: Atomically executes pass transitions: `CHECK_IN`, `CHECK_OUT`, `APPROVE_HOST`, `REJECT_HOST`, `CANCEL`.
- **`sp_activate_floor_plan`**: Row-locked (`SELECT ... FOR UPDATE`) promotion of a newly approved floor plan revision while deactivating prior revisions.
- **`sp_expire_faculty_statuses`**: Scheduled cron-style procedure resetting expired availability states.
- **`sp_campus_operations_summary`**: High-speed multi-resultset dashboard KPI generator for campus administration.

---

## 4. Document & Geospatial Store — MongoDB 9.0

Database Name: `campusguide_nosql`  
Validation: `$jsonSchema` enforced collections

### 4.1 Collections & Indexing Strategies

#### 1. `geo_geometries`
Stores all outdoor spatial footprints using official RFC 7946 GeoJSON format.
- **Index**: `{"geometry": "2dsphere"}` + `{"entity_type": 1, "mysql_id": 1}`
- **Entities**:
  - `CAMPUS_BOUNDARY`: The complete outer perimeter of RVCE (37 GPS boundary coordinates along Mysore Road, Global Village Road, and Vrishabhavathi canal boundary).
  - `BUILDING_FOOTPRINT`: 28 distinct polygons matching real buildings from the campus master map (Admin Block, CSE, AIML, ECE, EEE, Civil, Mechanical, Libraries, Food Courts, Hostels, etc.).

#### 2. `campus_pathways`
Graph network representing the campus walkway and road infrastructure.
- **Index**: `{"pathway_geometry": "2dsphere"}` + `{"pathway_type": 1}`
- **Path Types**:
  - `PEDESTRIAN`: Pure walking pathways (red solid lines on the campus map), stairs, and internal quadrangles.
  - `VEHICULAR`: Double-lane campus ring roads and service access roads.
  - `DUAL`: Combined pedestrian and vehicle accessible roads.

#### 3. `floor_plan_overlays`
Non-geographic, normalized vector overlays for indoor room layouts.
- **Coordinate Space**: `NORMALIZED_1000` grid (relative bounding box `x, y, w, h` from `0` to `1000`).
- **Linking**: Maps `room_id` from MySQL to vector polygons on the canvas for SVG/Canvas rendering.

#### 4. `search_telemetry`
High-throughput query telemetry log tracking what visitors search for on campus.
- **Fields**: `query_text`, `normalized_query`, `matched_count`, `duration_ms`, `user_agent`, `created_at`.
- **Index**: `{"created_at": -1}`, `{"normalized_query": 1}`

---

## 5. Offline-First Resilience & Fallback Data Architecture

On physical mobile phones or in dead zones with no Wi-Fi/cellular connection, traditional apps fail with "Network Error" or "Failed to Fetch". RVCE Campus Guide implements an **Offline-First Resilience Architecture**:

```
                                  [API Request from UI]
                                            |
                                            v
                                  Try Network Fetch (5s)
                                      /           \
                           (Success) /             \ (Failure / Timeout)
                                    v               v
                           Return Live Data   Log Info & Switch to Bundled Offline Cache
                                    |               |
                                    |               +---> FALLBACK_MAP_CONFIG (29 Geometries)
                                    |               +---> FALLBACK_BUILDINGS (28 Buildings)
                                    |               +---> FALLBACK_DEPARTMENTS (20 Depts)
                                    |               +---> FALLBACK_FACULTY (339 Profiles)
                                    |               +---> FALLBACK_FACILITIES (12 Amenities)
                                    |               +---> Offline Haversine Routing Engine
                                    v               v
                          [UI Updates Seamlessly with ZERO Crashes]
```

### Key Technical Properties
1. **Zero-Fail Fallback**: Every public endpoint in [`api.ts`](file:///c:/Users/mohit/RVCE/5th%20sem/DBMS/DBMS%20LAB%20EL/frontend/src/services/api.ts) (`getMapConfig`, `getBuildings`, `getBuildingDetail`, `getDepartments`, `getFaculty`, `getFacilities`, `search`, `getCampusRoute`) automatically intercepts fetch errors and delivers the verified bundled dataset.
2. **Offline Search Engine**: Client-side fulltext token matching across buildings, departments, faculty names, employee codes, and facilities.
3. **Offline Direct Pathway Generator**: If the server routing engine cannot be reached, the client calculates geodesic Haversine distance, estimates walking/driving duration, and plots an unobstructed route directly on the Leaflet map.
4. **Lightweight Footprint**: The entire offline dataset of 339 faculty, 28 buildings, and 29 GeoJSON geometries adds only ~188 KB (gzipped) to the JavaScript bundle.

---

## 6. Backend REST API Reference (0 to 100 Endpoints)

Base URL: `http://localhost:8000/api/v1` (or tunnel URL)  
Interactive Documentation: `/api/docs` (Swagger UI) & `/api/redoc`

### 6.1 Public & Geospatial Navigation Endpoints

#### `GET /health`
Returns health check and connectivity diagnostic for MySQL and MongoDB.
```json
{
  "healthy": true,
  "app_name": "RVCE Campus Navigation & Visitor Management Portal",
  "mysql": { "connected": true, "detail": "MySQL 8.0 connection verified" },
  "mongodb": { "connected": true, "detail": "MongoDB ping successful" }
}
```

#### `GET /map/config`
Fetches map initialisation parameters, tile layer settings, campus center coordinates, and all 29 GeoJSON boundary and building footprint polygons.

#### `GET /navigation/route`
Calculates campus navigation paths.
- **Query Parameters**:
  - `from_lat` (float), `from_lng` (float)
  - `to_lat` (float), `to_lng` (float)
  - `mode` (`WALKING` | `VEHICLE`)
  - `from_label` (string, optional)
  - `to_label` (string, optional)
- **Response**: Full route response including distance in meters, duration in seconds, turn-by-turn navigation instructions, maneuver types (`DEPART`, `CONTINUE`, `TURN_LEFT`, `ARRIVE`), and multi-segment coordinate arrays.

#### `GET /buildings`
Returns list of all active campus buildings. Supports filtering by `building_type` and query `q`.

#### `GET /buildings/{building_id}`
Returns building profile, list of mapped floors, linked facilities, and GeoJSON footprint geometry.

#### `GET /floors/{floor_id}/floor-plan`
Returns floor plan metadata, image URL, canvas dimensions, and vector room overlays for indoor wayfinding.

#### `GET /rooms/{room_id}`
Returns room specifications and list of faculty members currently assigned to cabins in that room.

#### `GET /departments`
Returns all 20 academic and administrative departments with faculty counts and primary building locations.

#### `GET /faculty`
Returns faculty directory. Supports filtering by `dept_id`, `cadre`, `qualification`, and search query `q`.

#### `GET /facilities`
Returns campus amenities (Food courts, ATMs, Clinics, Parking, Libraries) with opening hours and accessibility flags.

#### `GET /search`
Global campus search across buildings, rooms, facilities, and faculty. Automatically logs telemetry into MongoDB.

---

### 6.2 Visitor Management & Gate Operations

#### `POST /visits/pre-register`
Public visitor self-registration endpoint.
- **Request Body**:
  ```json
  {
    "full_name": "Dr. Ananya Sharma",
    "contact_phone": "+91 98450 12345",
    "contact_email": "ananya.sharma@example.com",
    "organization": "Indian Institute of Science",
    "destination_building_id": 3,
    "host_staff_id": 1,
    "purpose": "Invited Technical Keynote on Distributed AI",
    "gate_name": "Main Mysuru Road Gate"
  }
  ```
- **Response**: 
  ```json
  {
    "visit_id": 104,
    "visit_pass_code": "RVCE-20261104-104",
    "visitor_name": "Dr. Ananya Sharma",
    "approval_status": "APPROVED",
    "visit_status": "REGISTERED"
  }
  ```

#### `GET /visits`
Lists visit records. Security and staff can filter by `visit_status` (`REGISTERED`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`) or search query `q`.

#### `POST /visits/{visit_id}/action`
Applies gate lifecycle action (`CHECK_IN`, `CHECK_OUT`, `APPROVE_HOST`, `REJECT_HOST`, `CANCEL`).
```json
{
  "action": "CHECK_IN",
  "gate_name": "Main Mysuru Road Gate"
}
```

---

### 6.3 Authentication & Faculty Status

#### `POST /auth/login`
Authenticates users with username/password, returning a signed JWT Bearer token and user profile.

#### `GET /auth/me`
Returns current authenticated user identity, linked staff profile, and assigned roles.

#### `PUT /auth/availability`
Updates real-time faculty availability.
```json
{
  "availability_state": "IN_LECTURE",
  "public_note": "Handling 5th Sem Distributed Systems Lab in CS Lab 9",
  "valid_minutes": 120
}
```

---

### 6.4 Institutional Administration (`/admin/*`)
Requires `SYSTEM_ADMIN` role:
- `POST /admin/buildings` — Create or update building entities
- `POST /admin/floors` — Add floor configurations
- `POST /admin/rooms` — Provision room numbers and capacities
- `POST /admin/staff` — Onboard new staff members
- `POST /admin/facilities` — Register campus points of interest
- `GET /admin/users` & `POST /admin/users` — User management and role mapping
- `GET /admin/reports/summary` — Multi-day KPI report (total visits, active inside, pending approvals, top searches)
- `GET /admin/audit-logs` — Immutable audit trail with before/after JSON diffs

---

## 7. Frontend Architecture & UI/UX Design System

The frontend is an enterprise Single Page Application (SPA) designed to reflect the official RVCE brand aesthetic:
- **Primary Color**: RVCE Deep Institutional Navy (`#27447E`)
- **Hover/Dark Accent**: `#1E3666`
- **Background**: `#F5F7FA`
- **Card Surfaces**: Clean `#FFFFFF` with 1px border `#E2E8F0` and subtle elevation
- **Typography**: Inter / system font stack with strict readability hierarchy

### Application Views & Routing

```
/ (HomePage)
 ├── Institutional Header & Identity Emblem
 ├── Unified Instant Campus Search Bar
 ├── Quick Action Cards (Interactive Map, Faculty Directory, Visitor Pass, Facilities)
 └── Operational Status Indicators

/map (CampusMapPage)
 ├── Leaflet GIS Map Canvas (Full screen or constrained)
 ├── Building Polygon Overlays with Hover Tooltips
 ├── Route Direction Drawer (From -> To selector, Walk/Vehicle toggle)
 └── Building Detail Modal (mapped floors, rooms, facilities)

/buildings (BuildingIndoorPage)
 ├── Building Selector & Metadata Cards
 ├── Floor Tab Switcher (Ground Floor, 1st Floor, etc.)
 └── Interactive Room Grid / SVG Floor Plan Canvas

/directory (DirectoryPage)
 ├── 339 Faculty Profiles with Live Availability Badges
 ├── Filter by Department (20 departments)
 ├── Filter by Designation / Cadre (Professor, Assoc. Prof, Asst. Prof)
 └── One-Click "Locate Office on Map" Button

/facilities (FacilitiesPage)
 ├── Categorized Amenities (Cafeterias, Bank/ATMs, Clinics, Parking, Libraries)
 ├── Opening Hours & Wheelchair Accessibility Badges
 └── Navigation Trigger to Amenities

/visitor-registration (VisitorRegistrationPage)
 ├── Guest Self-Registration Form
 ├── Printable / Downloadable Digital Pass Card
 └── Security Pass Code Verification

/login (StaffLoginPage)
 └── Secure JWT Login Form for Faculty & Security

/portal (StaffPortalPage)
 ├── Faculty Availability Quick-Toggle (In Office, In Class, In Meeting, On Leave)
 ├── Visitor Security Check-in / Check-out Desk
 └── Administrative Management & Audit Logs
```

---

## 8. Mobile Architecture — Android & Capacitor

The project contains a fully configured native Android application located at `frontend/android`.

### 8.1 Capacitor Bridge Configuration (`frontend/capacitor.config.ts`)
- **Application ID**: `edu.rvce.campusguide`
- **Application Name**: `RVCE Campus Guide`
- **Web Directory**: `dist`
- **Android Scheme**: `https`
- **Cleartext Traffic**: Enabled (`cleartext: true`) to support local development IP endpoints

### 8.2 Native Android Manifest & Permissions
Located at `frontend/android/app/src/main/AndroidManifest.xml`:
- `android.permission.INTERNET` — For fetching real-time updates and tunnel traffic
- `android.permission.ACCESS_FINE_LOCATION` — For GPS campus positioning
- `android.permission.ACCESS_COARSE_LOCATION` — For approximate network positioning
- `android:usesCleartextTraffic="true"` — Ensures seamless connectivity to local LAN IP backends

### 8.3 Gradle & SDK Configuration
- **Platform**: Android SDK 36 (Android 16 API target)
- **Compile SDK**: `36` | **Target SDK**: `36` | **Min SDK**: `24` (Android 7.0+)
- **Build Tool**: Gradle 8.14.3
- **JDK Runtime**: Java 21 JBR (`C:\Program Files\Android\Android Studio\jbr`)

### 8.4 Mobile-First UI/UX Features
1. **Native Bottom Navigation Bar** ([`MobileBottomNav.tsx`](file:///c:/Users/mohit/RVCE/5th%20sem/DBMS/DBMS%20LAB%20EL/frontend/src/components/MobileBottomNav.tsx)): Provides instant thumb navigation across 5 core views (`Home`, `Map`, `Faculty`, `Buildings`, `Pass`).
2. **Real-Time Connectivity Badge**: Green animated pulse when connected to live backend; amber badge when serving from offline cache.
3. **One-Tap Server Switcher** ([`ServerSettingsModal.tsx`](file:///c:/Users/mohit/RVCE/5th%20sem/DBMS/DBMS%20LAB%20EL/frontend/src/components/ServerSettingsModal.tsx)):
   - Tap the status pill in the bottom nav or top header to open.
   - Quick presets:
     - Cloudflare Public Tunnel (`https://rvce-campus.trycloudflare.com/api/v1`)
     - Local Wi-Fi Direct IP (`http://192.168.1.7:8000/api/v1`)
   - **Test Connection** button sends a ping and displays roundtrip response time (e.g., `Connected successfully (24ms)`).

---

## 9. User Manual: Visitor & Public Workflows

### Scenario 1: Navigating to a Department or Building
1. Open the app on your mobile phone or browser (`/map`).
2. On the campus map, tap any building polygon or marker (e.g., *Department of Computer Science & Engineering*).
3. Tap **"Directions Here"**.
4. Select your starting point (e.g., *Main Mysuru Road Gate* or *Current GPS Position*).
5. Choose your travel mode:
   - **Walking**: Follows pedestrian walkways, shaded corridors, and central quadrangles.
   - **Vehicle**: Follows the paved campus ring road and points to designated parking bays.
6. Follow the highlighted navigation path and step-by-step instructions.

### Scenario 2: Finding a Faculty Member
1. Navigate to the **Faculty Directory** (`/directory`).
2. Enter the teacher's name (e.g., `Dr. Andhe Dharani`) or employee code in the search bar.
3. Filter by department (e.g., *Master of Computer Applications*) if needed.
4. View the professor's designation, department, and **Real-Time Availability** badge:
   - 🟢 **Available / In Office**: Faculty is on campus and ready for consultation.
   - 🟡 **In Lecture / In Meeting**: Currently busy with class or meeting until the specified time.
   - 🔴 **On Leave**: Currently on approved institutional leave or deputation.
5. Tap **"Locate Office"** to open the map directly centered on the faculty member's building.

### Scenario 3: Pre-Registering a Visitor Pass
1. Open **Visitor Services** (`/visitor-registration`).
2. Enter your Full Name, Phone Number, Email, and Organization.
3. Select the building and faculty/office you wish to visit.
4. State your purpose of visit (e.g., *Campus Interview*, *Project Evaluation*, *Admission Enquiry*).
5. Tap **"Generate Digital Pass"**.
6. A digital pass card with a unique code (e.g., `RVCE-20261104-1042`) is generated. Take a screenshot or save the pass code to present at the gate.

---

## 10. User Manual: Security Gate & Reception Desk

### Checking in a Visitor
1. Open the portal and log in with your security reception credentials (`/login`).
2. Navigate to the **Visitor Management** tab on the Staff Portal (`/portal`).
3. Enter the visitor's pass code (e.g., `RVCE-20261104-1042`) or search by phone number.
4. The system displays:
   - Visitor Name and Photo ID verification details
   - Destination building and host faculty member
   - Host approval status (Pre-approved or Pending)
5. Tap **"Confirm Check-In"**. The pass status updates to `CHECKED_IN`, and the entry timestamp is recorded.

### Checking out a Visitor
1. When the visitor departs through the gate, search their name or pass code.
2. Tap **"Confirm Check-Out"**.
3. The system records `check_out_at`, calculates total duration inside campus, and releases the pass.

---

## 11. User Manual: Faculty & Staff Portal

### Managing Your Availability Status
1. Log in to the portal (`/login`) using your institutional username and password.
2. Navigate to **My Availability** on the dashboard.
3. Select your current status:
   - **Available**: In cabin, open for student questions and visitors.
   - **In Lecture**: Conducting class. (Set timer: 30m, 60m, 90m, or 120m).
   - **In Meeting**: Attending department/college committee meeting.
   - **Out of Office / On Leave**: Not on campus today.
4. Optional: Add a brief note (e.g., *"Available after 3:30 PM in Lab 10"*).
5. Tap **"Update Status"**. Your badge across the public directory immediately reflects this change and automatically reverts once the timer expires.

---

## 12. User Manual: Institutional Administration

Accessible exclusively to users with the `SYSTEM_ADMIN` role:

### 1. Building & Space Management
- Add new campus buildings with geographic center latitude/longitude, total floor count, and accessibility attributes.
- Define rooms within floors, specifying room type (`CLASSROOM`, `LABORATORY`, `FACULTY_CABIN`, etc.) and seating capacities.

### 2. Operational KPIs & Visitor Analytics
- View total daily visitors, active guests currently inside campus, and peak entrance gates.
- Monitor average duration of visits by destination department.
- Identify top search queries and unresolved searches to improve campus signage.

### 3. Immutable Change Audit Log
- Navigate to **Audit Logs** (`/portal -> Audit Logs`).
- View chronological ledger of all administrative record alterations (Insert, Update, Delete) with timestamps, actor usernames, and JSON before/after snapshots.

---

## 13. Operations, Deployment & Troubleshooting Guide

### 13.1 Quick Launch Scripts (Windows)
The root directory includes pre-configured automation batch scripts:
- **`start-portal.bat`**: Double-click to verify MySQL and MongoDB services, start the FastAPI backend on `0.0.0.0:8000`, start the React frontend on `127.0.0.1:5173`, and open the portal in your default browser.
- **`stop-portal.bat`**: Gracefully terminates running background portal processes.
- **`start-tunnel.bat`**: Launches an instant Cloudflare HTTPS public tunnel pointing to your local backend so physical Android phones can connect over cellular data.

### 13.2 Installing the Mobile App on Android
1. Locate the file [`RVCE_Campus_Guide_v1.0.apk`](file:///c:/Users/mohit/RVCE/5th%20sem/DBMS/DBMS%20LAB%20EL/RVCE_Campus_Guide_v1.0.apk) in the project root directory.
2. Transfer it to your Android device via USB cable, WhatsApp, Google Drive, or local file sharing.
3. Tap the `.apk` file on your phone.
4. If prompted, allow *"Install from Unknown Sources"* for your file manager.
5. Tap **Install** and open **RVCE Campus Guide**.
6. The app opens immediately in **Offline Mode** with full campus maps and directory loaded.

### 13.3 Rebuilding the APK from Source
To compile a fresh Android APK after making frontend modifications:
```powershell
# 1. Build optimized web distribution
cd frontend
npm run build

# 2. Synchronize web assets to native Android project
npx cap sync android

# 3. Compile Debug APK with Gradle wrapper
cd android
.\gradlew.bat assembleDebug

# 4. Copy updated APK to project root
Copy-Item "app\build\outputs\apk\debug\app-debug.apk" -Destination "..\..\RVCE_Campus_Guide_v1.0.apk" -Force
```

### 13.4 Running Backend Automated Tests
```powershell
# Execute the complete pytest test suite
.\backend\.venv\Scripts\pytest -v
```

### 13.5 Common Troubleshooting Scenarios

| Issue | Root Cause | Solution |
|---|---|---|
| Phone shows **Offline Cache** badge | Laptop backend is stopped or phone is on another network | Double-click `start-tunnel.bat`, copy the `trycloudflare.com` URL, and paste it into the app's Server Settings modal. |
| MySQL error `Access denied for user 'root'@'localhost'` | MySQL service stopped or password mismatch | Verify MySQL80 is running with `sc query MySQL80` and ensure `.env` matches your MySQL root credentials. |
| Vite dev server port 5173 in use | Previous node process did not exit | Run `stop-portal.bat` or run `netstat -ano \| findstr :5173` and terminate the PID with `taskkill /F /PID <PID>`. |
| Android Gradle build error: `Unsupported class file major version 69` | Default system Java version is JDK 25 | Gradle properties have been pre-locked to JDK 21 at `C:\Program Files\Android\Android Studio\jbr` in `frontend/android/gradle.properties`. |
