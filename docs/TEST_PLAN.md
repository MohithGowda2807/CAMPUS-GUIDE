# RVCE Campus Navigator — Comprehensive Quality Assurance & Test Plan (v2.0)

## 1. Quality Objectives & Evidence Policy

Per `apk_ui_prompt.txt` (Parts 7–10, 14, 17–18), zero unverified test claims are permitted:
1. **Static & Type Safety**: Zero TypeScript compiler errors across both `mobile/` and `frontend/`.
2. **Algorithmic & Domain Unit Verification**: Automated `vitest` suites validating Dijkstra campus pathfinding parity (`64` tests), visitor registration rules, availability governance, and verified dataset invariants (`9` tests).
3. **Backend API & Dual-Database Regression**: Automated `pytest` suite (`7` tests) verifying FastAPI endpoints, JWT authentication, RBAC guards, MySQL 8.0 DDL/procedures, and MongoDB 9.0 `2dsphere` geospatial indexes.
4. **End-to-End Mobile Journeys**: Maestro E2E flows (`mobile/.maestro/01_*.yaml` through `05_*.yaml`) covering Journeys A–E.
5. **On-Device Runtime Verification**: Real APK installation (`adb install -r`), cold-start timing (`adb shell am start -W`), multi-screen visual inspection via `adb exec-out screencap`, multi-viewport layout checks, offline fallback validation, and `adb logcat` crash verification on the Android 15 emulator (`rvce_pixel6`).

---

## 2. Automated Test Architecture

| Layer | Suite Path | Runner | Coverage Scope |
|---|---|---|---|
| **Backend & DB Integration** | `backend/tests/test_api_and_database.py` | `pytest` | Password hashing, JWT roundtrip, RBAC 401/403 enforcement, MySQL 3NF DDL, MongoDB `2dsphere` index, 339 faculty seed, 28 buildings, walking & vehicle routing |
| **Web Router Parity** | `frontend/src/services/campusRouter.test.ts` | `vitest` | 20 real campus origin-destination pairs × walking/vehicle: exact distance, duration, leg sequence, node coordinates (<0.5m), turn instructions |
| **Mobile Router Parity** | `mobile/src/services/campusRouter.test.ts` | `vitest` | Identical 64-assertion parity verification inside `mobile/` against `backend/app/services/routing.py` |
| **Mobile Domain & Validation** | `mobile/src/utils/mobileDomain.test.ts` | `vitest` | Visitor form validation (name, 10-digit phone, optional email, purpose), availability enum governance (`UNKNOWN` default), 28-building / 29-polygon / 339-faculty dataset integrity, category filters |
| **Mobile Type Checking** | `mobile/tsconfig.json` | `tsc --noEmit` | Full React Native, Expo Router, MapLibre, SVG, and API contract static verification |
| **Mobile E2E Flows** | `mobile/.maestro/01..05_*.yaml` | Maestro / ADB UI | Journeys A (Outdoor Map & Routing), B (Indoor Floor Plan), C (Faculty Directory), D (Visitor Pass), E (Staff Auth & RBAC) |

---

## 3. Critical End-to-End User Journeys

### Journey A — Campus Discovery & Road/Walkway Navigation (`01_campus_discovery.yaml`)
1. Launch `edu.rvce.campusguide` and verify `RVCE Campus Navigator` branding and `Server Online` indicator.
2. Open **Explore** tab and confirm OpenStreetMap campus tiles, perimeter boundary, and 28 building footprints render cleanly without control overlap.
3. Search for `"Computer Science"`, select `Department of Computer Science & Engineering`, and verify smooth camera animation + destination bottom sheet (`Directions`, `Floors & Rooms`, `Set Start`).
4. Tap **Directions** and verify multi-leg Dijkstra polyline along verified walkways/roads (never a straight line over buildings), `A`/`B` endpoint pins, travel summary, `Walk`/`Drive` mode toggle, and expandable **Turn-by-Turn** maneuvers.

### Journey B — Indoor Floor Plan & Room Discovery (`02_indoor_discovery.yaml`)
1. Select a campus building on the Explore Map and tap **Floors & Rooms**.
2. Verify `IndoorFloorModal` opens with floor selector chips, honest `Schematic Sample Layout` governance banner (`SAMPLE_DEV`), interactive `react-native-svg` vector room plan, zoom controls (`-`, `100%`, `+`, `Reset`), and searchable room index.
3. Tap a room polygon or room row and verify room code, type, floor context, and assigned faculty details.

### Journey C — Faculty Directory & Approved Public Profile (`03_faculty_discovery.yaml`)
1. Open **Faculty** tab (339 profiles, 20 department filter chips).
2. Filter or search for a verified faculty member (e.g. `Dr. Shanta Ranga Swamy`).
3. Tap the card to open the **Approved Public Profile** sheet; verify designation, department, employee ID, honest availability badge, and **View Department Building on Map** jump action.

### Journey D — Visitor Registration & Validation (`04_visitor_registration.yaml`)
1. Open **Services → Visitor Pass**.
2. Submit an incomplete form and verify inline validation error (`Please enter visitor full name.` / `10-digit mobile number`).
3. Enter valid synthetic test visitor details (`Test Candidate Visitor`, `9845000111`, `Admissions Inquiry`), submit against live FastAPI/MySQL (`sp_register_visit_request`), and verify unique pass code `RVCE-YYYYMMDD-XXXX`.

### Journey E — Authentication, RBAC & Session Lifecycle (`05_authentication.yaml`)
1. Open **Account** tab, test invalid credentials, and verify clear HTTP 401 error feedback without flipping server state to offline.
2. Sign in as `hod.cse` (`FACULTY_STAFF`, `DEPT_COORDINATOR`) and broadcast office availability (`AVAILABLE`, `60m`).
3. Sign in as `security.desk` (`SECURITY_RECEPTION`), inspect the **Gate Visitor Log**, execute visitor `Check In`, and verify status transitions to `CHECKED_IN`.
4. Sign out and verify encrypted JWT removal from `expo-secure-store`.

---

## 4. Device, Viewport & Resilience Matrix
- **Standard 6-inch Class Device**: Pixel 6 Android 15 (`1080 × 2400`, `420 dpi`, `x86_64` AVD `rvce_pixel6`).
- **Compact / Small-Screen Viewport Check**: Simulated `720 × 1520` (`320 dpi`) compact handset display to verify zero text clipping or bottom-bar/sheet collision.
- **Offline / Unreachable Backend Check**: Simulated unreachable backend URL in Server Settings to verify `Offline Cache` amber pill, 100% offline map/building/faculty/Dijkstra operation, and honest rejection of offline visitor/auth mutations.
- **Physical Android Phone Readiness**: Multi-ABI Release APK compiled with `arm64-v8a` + `x86_64` for direct sideloading or USB installation (`adb install -r`).
