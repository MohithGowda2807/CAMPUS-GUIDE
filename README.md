# RVCE Campus Navigation & Visitor Management Portal

Official-grade web platform for **R. V. College of Engineering (RVCE), Bengaluru** providing interactive outdoor campus mapping, multi-floor indoor room wayfinding, departmental & faculty directories, and gate visitor pass management.

---

## Core Capabilities

- **Interactive Outdoor Campus Map:** OpenStreetMap + Leaflet viewer centred on the RVCE Mysuru Road campus (`12.923333, 77.499506`, zoom `18`), displaying GeoJSON building footprints, campus extent, and categorized facility pins with configurable tile providers.
- **Building & Indoor Floor-Plan Navigation:** Hierarchical `Campus → Building → Floor → Room` explorer with local-coordinate vector floor plans, room highlighting, accessibility indicators, and searchable room lists.
- **Faculty & Department Directory:** Searchable directory of academic departments and faculty cabins with source-attributed, time-expiring availability indicators (`Available`, `Busy / Scheduled`, `Unavailable`, `Unknown`).
- **Visitor Pass Registration & Gate Workflow:** Data-minimised visitor pre-registration, printable pass receipts (`RVCE-YYYYMMDD-XXXX`), optional host confirmation, and security desk check-in / check-out tracking.
- **Role-Based Staff & Administration Portal:** Backend-enforced access control across `SECURITY_RECEPTION`, `FACULTY_STAFF`, `DEPT_COORDINATOR`, `FACILITY_ADMIN`, and `SYSTEM_ADMIN` with automated database audit trails.

---

## Technology Architecture

| Layer | Stack | Responsibility |
|---|---|---|
| **Android Native App** | Expo SDK 58 / React Native, MapLibre Native, `expo-secure-store` | Standalone Android APK (`RVCE-Campus-Navigator-v2.2.0.apk`), offline Dijkstra routing, OIDC + `S256` PKCE 13-screen Staff Portal |
| **Web Frontend** | React, TypeScript, Vite, Tailwind CSS, Leaflet, Lucide | Institutional RVCE interface, outdoor GIS map, indoor SVG floor-plan viewer, responsive staff portal |
| **Backend API** | Python 3.11+, FastAPI, SQLAlchemy Core, Motor, PyJWT (`RS256`), `cryptography` (`AES-256-GCM`) | Cognito JWKS token verification, `@rvce.edu.in` allowlist governance, RBAC enforcement, hybrid database orchestration |
| **Primary RDBMS** | MySQL 8.0+ (`campusguide`) | Zero-password 3NF relational records (`cognito_sub` identity mapping), foreign-key integrity, views, triggers, and stored procedures |
| **Geospatial & Document Store** | MongoDB 7.0+ / 9.0+ (`campusguide_nosql`) | `2dsphere` GeoJSON campus/building geometries, 479 routing pathway segments, indoor floor-plan overlays, and search telemetry |

Detailed schema, stored procedures, triggers, views, and document validators are documented in [docs/architecture-and-database.md](docs/architecture-and-database.md).

### Faculty & Staff Authentication Security Documentation (`docs/security/`)
- [AUTHENTICATION_ARCHITECTURE.md](docs/security/AUTHENTICATION_ARCHITECTURE.md)
- [COGNITO_CONFIGURATION.md](docs/security/COGNITO_CONFIGURATION.md)
- [STAFF_REGISTRATION_FLOW.md](docs/security/STAFF_REGISTRATION_FLOW.md)
- [LOGIN_AND_RECOVERY_FLOW.md](docs/security/LOGIN_AND_RECOVERY_FLOW.md)
- [RBAC_MATRIX.md](docs/security/RBAC_MATRIX.md)
- [DATABASE_IDENTITY_MAPPING.md](docs/security/DATABASE_IDENTITY_MAPPING.md)
- [SECURITY_POLICY.md](docs/security/SECURITY_POLICY.md)
- [THREAT_MODEL.md](docs/security/THREAT_MODEL.md)
- [SECURITY_TEST_PLAN.md](docs/security/SECURITY_TEST_PLAN.md)
- [SECURITY_TEST_RESULTS.md](docs/security/SECURITY_TEST_RESULTS.md)
- [DEPLOYMENT_CHECKLIST.md](docs/security/DEPLOYMENT_CHECKLIST.md)

---

## Repository Structure

```text
├── backend/
│   ├── app/
│   │   ├── api/            # Public, Auth, Visitor & Admin FastAPI routers
│   │   ├── auth/           # JWT, bcrypt & RBAC permission dependencies
│   │   ├── config/         # Environment settings & MySQL/MongoDB connection pools
│   │   ├── schemas/        # Pydantic v2 request/response contracts
│   │   └── main.py         # Application entrypoint & error handlers
│   ├── tests/              # Automated backend & database verification suite
│   └── requirements.txt
├── database/
│   ├── mysql/
│   │   ├── 01_schema.sql       # 3NF InnoDB tables, FKs, CHECK & FULLTEXT indexes
│   │   ├── 02_views.sql        # Public directory & gate analytics views
│   │   ├── 03_triggers.sql     # State-transition guards & JSON audit triggers
│   │   └── 04_procedures.sql   # ACID stored procedures for passes & floor plans
│   ├── mongodb/
│   │   └── init_nosql.py       # $jsonSchema validators & 2dsphere indexes
│   └── setup_databases.py      # One-command MySQL + MongoDB provisioning CLI
├── docs/
│   └── architecture-and-database.md
├── frontend/
│   ├── public/assets/      # Official RVCE emblem assets
│   └── src/                # React + TypeScript components, pages & API client
├── .env.example
└── .gitignore
```

---

## Team Onboarding & Local Setup

### Prerequisites
- **Node.js** `20+` and `npm`
- **Python** `3.11+`
- **MySQL Server** `8.0+` running locally on port `3306`
- **MongoDB Community Server** `7.0+` / `9.0+` running locally on port `27017`

### 1. Clone & Configure Environment
```bash
git clone https://github.com/MohithGowda2807/CAMPUS-GUIDE.git
cd CAMPUS-GUIDE
cp .env.example .env
```
Create the dedicated application database user in **MySQL Workbench** (or MySQL CLI):
```sql
CREATE DATABASE IF NOT EXISTS campusguide CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
SET GLOBAL log_bin_trust_function_creators = 1;
CREATE USER IF NOT EXISTS 'rvce_app'@'localhost' IDENTIFIED BY 'RvceDb@2026';
CREATE USER IF NOT EXISTS 'rvce_app'@'127.0.0.1' IDENTIFIED BY 'RvceDb@2026';
GRANT ALL PRIVILEGES ON campusguide.* TO 'rvce_app'@'localhost', 'rvce_app'@'127.0.0.1';
FLUSH PRIVILEGES;
```
Then configure `MYSQL_USER`, `MYSQL_PASSWORD`, `DATA_PROTECTION_KEY_B64`, and your Amazon Cognito User Pool variables (`COGNITO_USER_POOL_ID`, `COGNITO_APP_CLIENT_ID`, `COGNITO_DOMAIN`) inside `.env` (see [docs/security/COGNITO_CONFIGURATION.md](docs/security/COGNITO_CONFIGURATION.md)). For runtime least-privilege access in staging/production, apply `database/mysql/06_least_privilege_db_user.sql`.

### 2. Install Backend Dependencies & Provision Databases
```bash
python -m venv backend/.venv

# Windows PowerShell
backend\.venv\Scripts\pip install -r backend/requirements.txt
backend\.venv\Scripts\python database/setup_databases.py --seed

# Linux / macOS
backend/.venv/bin/pip install -r backend/requirements.txt
backend/.venv/bin/python database/setup_databases.py --seed
```
> Note: `--seed` loads clearly badged `SAMPLE_DEV` development records. Use `--schema-only` in staging/production prior to importing verified RVCE estate records.

### 3. Start Backend & Frontend Servers

**One-Click Launch on Windows:**
Double-click `start-portal.bat` in the repository root (checks `MySQL80` & `MongoDB` services, starts FastAPI on `127.0.0.1:8000` and Vite on `127.0.0.1:5173` without duplicate port conflicts, and opens `http://127.0.0.1:5173` in your browser). Use `stop-portal.bat` anytime to stop both dev servers.

**Manual Terminal Launch:**
```bash
# Terminal 1 — FastAPI Backend (http://127.0.0.1:8000)
backend\.venv\Scripts\uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload

# Terminal 2 — React Frontend (http://127.0.0.1:5173)
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173` in your browser. Interactive OpenAPI documentation is served at `http://127.0.0.1:8000/api/docs`.

---

## Data Governance & Map Attribution Policy

- **Sample Data Separation:** Development records carry `verification_status = 'SAMPLE_DEV'` and display a visible **Sample Data** indicator until verified by the respective RVCE departments and Estate Office.
- **OpenStreetMap Compliance:** Standard OSM tiles are used strictly in accordance with the OSMF Tile Usage Policy with visible `© OpenStreetMap contributors` attribution and configurable tile endpoints (`MAP_TILE_URL`) for production hosting.
- **Privacy & Security:** Visitor logs and internal fields are protected by backend role-based access control and never exposed via public directory endpoints.
