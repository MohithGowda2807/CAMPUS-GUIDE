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
| **Web Frontend** | React, TypeScript, Vite, Tailwind CSS, Leaflet, Lucide | Institutional RVCE interface, outdoor GIS map, indoor SVG floor-plan viewer, responsive staff portal |
| **Backend API** | Python 3.11+, FastAPI, SQLAlchemy Core, Motor, PyJWT, bcrypt | Authentication, RBAC enforcement, input validation, hybrid database orchestration |
| **Primary RDBMS** | MySQL 8.0+ (`campusguide`) | Authoritative 3NF relational records, foreign-key integrity, views, triggers, and transactional stored procedures |
| **Geospatial & Document Store** | MongoDB 7.0+ / 9.0+ (`campusguide_nosql`) | `2dsphere` GeoJSON campus/building geometries, local-coordinate indoor floor-plan overlays, and search telemetry aggregations |

Detailed schema, stored procedures, triggers, views, and document validators are documented in [docs/architecture-and-database.md](docs/architecture-and-database.md).

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
git clone <REPOSITORY_URL>
cd rvce-campus-navigator
cp .env.example .env
```
Edit `.env` and set your local `MYSQL_USER`, `MYSQL_PASSWORD`, and a strong `JWT_SECRET_KEY`.

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
Run in two terminals from the repository root:

```bash
# Terminal 1 — FastAPI Backend (http://127.0.0.1:8000)
backend\.venv\Scripts\uvicorn backend.app.main:app --reload --port 8000

# Terminal 2 — React Frontend (http://localhost:5173)
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` in your browser. Interactive OpenAPI documentation is served at `http://127.0.0.1:8000/docs`.

---

## Data Governance & Map Attribution Policy

- **Sample Data Separation:** Development records carry `verification_status = 'SAMPLE_DEV'` and display a visible **Sample Data** indicator until verified by the respective RVCE departments and Estate Office.
- **OpenStreetMap Compliance:** Standard OSM tiles are used strictly in accordance with the OSMF Tile Usage Policy with visible `© OpenStreetMap contributors` attribution and configurable tile endpoints (`MAP_TILE_URL`) for production hosting.
- **Privacy & Security:** Visitor logs and internal fields are protected by backend role-based access control and never exposed via public directory endpoints.
