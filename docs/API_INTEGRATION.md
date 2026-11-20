# RVCE Campus Navigator — API Integration, Auto-Discovery & Offline Resilience (v2.0)

## 1. Smart Backend Auto-Discovery Architecture

To prevent mobile connectivity failures across Android emulators, USB-connected physical phones, local Wi-Fi networks, and public tunnels, [`mobile/src/services/api.ts`](file:///c:/Users/mohit/RVCE/5th%20sem/DBMS/DBMS%20LAB%20EL/mobile/src/services/api.ts) implements deterministic endpoint resolution during `initStorage()`:

1. **Saved User Override**: Checks `AsyncStorage` (`rvce_mobile_api_base`) if the user explicitly saved a URL (e.g., a live Cloudflare Quick Tunnel or college server URL) in the Server Settings modal.
2. **Build Environment Override**: Checks `process.env.EXPO_PUBLIC_API_URL`.
3. **Automatic Localhost / LAN Health Probe**: Probes candidate endpoints (`GET /api/v1/health`, `1300ms` timeout each) and locks onto the first healthy FastAPI instance:
   - `http://10.0.2.2:8000/api/v1` — Android Studio Emulator host loopback to `127.0.0.1:8000`
   - `http://127.0.0.1:8000/api/v1` — Physical Android phone over USB Debugging (`adb reverse tcp:8000 tcp:8000`)
   - `http://192.168.1.7:8000/api/v1` — Physical Android phone over shared Wi-Fi LAN (`uvicorn --host 0.0.0.0`)
4. **Zero-Crash Offline Fallback**: When no server is reachable, public read-only endpoints seamlessly serve verified bundled campus data (`fallbackData.ts` + `campusRouter.ts`) while setting `connectionState = 'OFFLINE_FALLBACK'` (`Offline Cache` badge). State-mutating or protected endpoints (`preRegisterVisitor`, `login`, `updateAvailability`, `recordVisitAction`) never fake success offline—they surface a clear error message.

---

## 2. REST API Contract Mapping (`/api/v1/*`)

| Mobile Method (`campusApi.*`) | HTTP Endpoint | Auth Required | Online Source | Offline Behaviour |
|---|---|---|---|---|
| `checkHealth()` | `GET /health` | Public | FastAPI + MySQL + MongoDB ping | Marks state `OFFLINE_FALLBACK` |
| `getMapConfig()` | `GET /map/config` | Public | MongoDB `building_geometries` | Bundled 29 verified GeoJSON polygons |
| `getBuildings(search)` | `GET /buildings` | Public | MySQL `buildings` + floor counts | Filtered `FALLBACK_BUILDINGS` (28 buildings) |
| `getBuildingDetail(id)` | `GET /buildings/{id}` | Public | MySQL building, departments, floors, facilities | Bundled building + labelled schematic floor index (`SAMPLE_DEV`) |
| `getFloorPlan(bId, fId)` | `GET /buildings/{bId}/floors/{fId}/plan` | Public | MongoDB `floor_map_overlays` + MySQL `rooms` | Clearly badged `is_schematic_sample: true` vector layout |
| `getRoomDetail(roomId)` | `GET /rooms/{roomId}` | Public | MySQL `rooms` + `faculty_Location` | Schematic room metadata |
| `getDepartments()` | `GET /departments` | Public | MySQL `departments` | Bundled 20 official RVCE departments |
| `getFaculty(dept, q)` | `GET /faculty` | Public | MySQL `v_public_faculty_directory` | Bundled 339 official April 2026 faculty profiles |
| `getFacilities(cat)` | `GET /facilities` | Public | MySQL `facilities` | Bundled 12 verified campus amenities |
| `searchCampus(q)` | `GET /search` | Public | Unified MySQL search + MongoDB telemetry | Instant client-side multi-entity search |
| `getRoute(...)` | `GET /navigation/route` | Public | Python Dijkstra (`routing.py`) | Parity-tested TypeScript Dijkstra (`campusRouter.ts`, 479 edges) |
| `preRegisterVisitor(body)` | `POST /visits/pre-register` | Public | MySQL `sp_register_visit_request` | Rejects cleanly with offline notice (never faked) |
| `login(user, pass)` | `POST /auth/login` | Public | MySQL `user_accounts` (`pbkdf2_sha256` + JWT) | Rejects cleanly with error banner |
| `getMe()` | `GET /auth/me` | Bearer JWT | Verified JWT claims + faculty link | Clears expired/401 token |
| `updateAvailability(body)` | `PUT /auth/availability` | `FACULTY_STAFF`+ | MySQL `sp_upsert_faculty_availability` | Requires live server confirmation |
| `listVisits(status)` | `GET /visits` | `SECURITY_RECEPTION` / `ADMIN` | MySQL `visit_requests` + `visitors` | Protected; never cached on device |
| `recordVisitAction(...)` | `POST /visits/{id}/check-event` | `SECURITY_RECEPTION` / `ADMIN` | MySQL `sp_check_in_visit` / `sp_check_out_visit` | Requires live server confirmation |
| `getReportsSummary()` | `GET /admin/reports/summary` | `FACILITY_ADMIN` / `SYSTEM_ADMIN` | MySQL 30-day KPIs + MongoDB top searches | Protected; live server only |

---

## 3. Security & Error Differentiation
- **Encrypted Token Storage**: Staff JWTs are persisted exclusively via `expo-secure-store` (`rvce_staff_jwt_token`), backed by Android Keystore AES encryption.
- **HTTP Error vs Network Error Separation**: `ApiHttpError` distinguishes valid server rejections (`401 Invalid credentials`, `403 Forbidden`, `422 Validation Error`) from network timeouts (`AbortController`), preventing invalid form submissions from falsely flipping the app's connectivity badge to offline.
