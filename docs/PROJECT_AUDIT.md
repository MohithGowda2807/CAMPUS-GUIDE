# RVCE Campus Navigator — Project Audit (Phase 1)

> Scope: audit and architecture decision **only**. No redesign has been executed.
> Date: 2026-11-04. Every statement below was observed in the repository, the running services, or a command run during this audit. Items not yet verified are labelled as such.

## 1. What exists today

| Layer | Finding (observed) |
|---|---|
| Web frontend | React 19.3, Vite 8.3, TypeScript, Tailwind 4, React Router 7, Leaflet 1.9. 23 source files. |
| "Mobile app" | **Capacitor 8.6 Android shell that loads the built website in a WebView** (`frontend/android`, appId `edu.rvce.campusguide`). It is not a native UI. Under the design rules (#20) this must not be presented as a native application. |
| Backend | FastAPI, 4 routers (`public`, `auth_routes`, `visitors`, `admin`), JWT auth with role checks (`require_roles`). |
| Databases | MySQL 8.0.45 (15 tables, views, triggers, procedures) and MongoDB 9.0.2 (geometries, pathways, overlays, telemetry). Both healthy at audit time (`/api/v1/health`). |
| Routing | Server-side Dijkstra over an OSM-derived network (`backend/app/services/routing.py`, 479 edges / 415 nodes). Works: live request gate→CSE walking returned 203.0 m, 3 legs. |
| Tests | Backend: 7 pytest tests (pass). Frontend: **none existed** before this audit. |
| Device tooling | adb and emulator binaries present. **No AVD and no system image installed. No physical device attached.** So no on-device runtime evidence exists yet. |

## 2. Data truth (what is verified vs placeholder)

| Data | State | Consequence for the app |
|---|---|---|
| 28 building footprints + campus boundary | Verified (OSM-derived geometry) | Safe to show on the map. |
| 479-edge pathway network | Verified (OSM-derived) | Safe for outdoor routing. |
| 339 faculty / 20 departments | From the official April 2026 roster | Safe. Only 20 of 339 have an office room linked; 0 have a public email. |
| Faculty availability | All `UNKNOWN` (no authorised update source yet) | Must display "Not updated". Never infer. |
| Floors and rooms | Seeded placeholders (e.g. CSE: 3 floors, 1 room total) | **Not verified.** Must be labelled or hidden. |
| Floor plans | **0 approved plans across all 28 buildings** | Indoor navigation cannot be claimed. The indoor screen can only be an honest empty/"coming soon" state until RVCE supplies plans. |

## 3. Module audit

| Module | Current status | Problems | Required action | Priority |
|---|---|---|---|---|
| Android application | Builds and installs (debug APK, 5.4 MB). WebView wrapper. | Not native. Default Capacitor launcher icon/splash. App name is "RVCE Campus Guide", spec says "RVCE Campus Navigator". Debug-signed only. `usesCleartextTraffic=true`. No runtime test evidence. | Decide architecture (section 5). Real icon/splash. Release build profile. | P0 |
| UI/UX | Good on desktop web. Mobile is the desktop layout plus a bottom bar. | Not yet visually inspected on a device in this phase. Home page and header carry many controls; spec wants spacious, search-first. | Design system first, then screens. | P0 |
| Navigation (routing) | Server routing correct. **Offline path was broken (see BUG-01), now fixed.** | Offline fallback drew a straight line over buildings. | Fixed; parity-tested (section 6). | P0 (done) |
| Campus map | Leaflet in WebView. | 1283-line `CampusMapPage`. Standard OSM tile server used directly: its policy restricts heavy/bulk app use and requires attribution. No offline tiles. | Map provider decision (section 5). | P0 |
| Indoor maps | Viewer exists (`IndoorFloorPlanViewer`). | No approved plans anywhere; floors/rooms are placeholders. | Honest empty state; wait for RVCE plans. | P1 |
| Search | Works against API; offline client search added. | No debounce audit done yet. Offline index is substring-only. | Debounce + grouped results in redesign. | P1 |
| Faculty directory | 339 records. | Availability all unknown. Large list not virtualised (not yet measured). | Show "Not updated"; virtualise. | P1 |
| Visitor management | Pre-register + staff check-in/out wired to stored procedures. | No frontend double-submit test yet. Visitor data must never be cached on device. | Idempotent submit; test. | P1 |
| Authentication | JWT, role guards in backend (admin/visit endpoints require roles — confirmed in code). | **Token stored in `localStorage` and `sessionStorage`** (not secure storage). Default JWT secret placeholder in `settings.py` fallback. | Secure storage in native build; fail startup if the default secret is used in non-dev. | P0 |
| Backend integration | Typed client in `api.ts`. | CORS regex `^https?://.*` **with credentials** allows any origin (added by me last session; tokens are bearer so exposure is limited, but it is too broad). 4 s timeout × many sequential calls when the server is unreachable. | Restrict origins; probe server once and short-circuit. | P0 |
| Database | Schema, views, triggers, procedures present. | None blocking. Floor/room rows are placeholders. | Data work, not code. | P2 |
| Testing | Backend 7 pass. Frontend router now 64 pass. | No component, integration, E2E or accessibility tests. | Build per `TEST_PLAN` in later phases. | P0 |
| APK generation | Debug APK builds locally with Gradle (JDK 21, SDK 36). | No release signing, no AAB, not install-tested. | Release profile + install on emulator/device. | P0 |

## 4. Defects found (bug register)

| ID | Severity | Defect | Root cause | Status | Verification |
|---|---|---|---|---|---|
| BUG-01 | High | In the APK, routes were a plain line over buildings instead of following roads/walkways (the website was fine). | The APK's backend URL is unreachable from a phone, so `getCampusRoute` hit its catch-block, which I had written to return a 2-point straight line. The real router only existed on the server. | **Fixed** | Ported the exact algorithm to `frontend/src/services/campusRouter.ts` over the same network (`routingNetwork.ts`). 64/64 parity tests against real backend output (20 route cases: distance, duration, legs, every polyline node, every instruction). |
| BUG-02 | Medium | Offline `getBuildingDetail` invented a "Ground Floor" with a made-up id. | My earlier fallback code. | **Fixed** (returns no floors offline) | Code review; `tsc` clean. |
| BUG-03 | Medium | HTTP errors from a reachable server (e.g. 404) flipped the UI to "Offline". | `request()` caught all errors. | **Fixed** (`ApiHttpError` keeps state ONLINE and is not masked by fallbacks for routing) | Code review; not yet covered by an automated test. |
| BUG-04 | Medium | "Cloudflare Public Tunnel" preset points to `rvce-campus.trycloudflare.com`, a URL that does not exist. | Placeholder I presented as a real preset. | **Open** | Remove preset; show the real URL printed by `start-tunnel.bat`. |
| BUG-05 | Medium | Hardcoded LAN IP `192.168.1.7` as the native default. | Dev convenience. | **Open** | Needs environment-based config. |
| BUG-06 | Medium | CORS too permissive (see above). | Regex added to unblock the APK. | **Open** | |
| BUG-07 | Medium | Auth token in web storage. | Web-first design. | **Open** | |
| BUG-08 | Low | TypeScript `strict` is **not enabled** in `tsconfig.app.json`; oxlint reports 9 warnings (`set-state-in-effect` in `CampusMapPage`, etc.). | Template defaults. | **Open** | `npm run lint`: 0 errors, 9 warnings. |
| BUG-09 | Low | Single 993 kB JS chunk (203 kB gzip); 386 kB offline dataset embedded in it. | No code-splitting. | **Open** | Vite build output. |
| BUG-10 | Low | Default Capacitor icon/splash; wrong app name. | Not yet branded. | **Open** | Inspected `mipmap-*`. |

Not yet audited (will be done on a device/emulator, not assumed): crashes, blank screens, keyboard overlap, status-bar handling, rotation, permission dialogs, scroll/map frame rate, memory.

## 5. Architecture decision (needs your approval)

The brief asks for a genuine native Android app, a premium map experience and evidence-based testing. The current app is a web page in a WebView, so polishing it cannot meet rules #20 and the map-quality bar.

### Option A — Keep Capacitor + React, polish
- Pros: fastest; keeps the working web map; low regression risk.
- Cons: still a WebView. Leaflet touch performance is bounded by the WebView. Does not satisfy "genuine native app".

### Option B — Expo (React Native) + TypeScript + MapLibre React Native  **(recommended)**
- Pros: native screens, native gestures, a native vector map with smooth pinch/pan, real splash/icon, secure token storage (`expo-secure-store`), matches the brief's stated direction for a React/TS project.
- Reuse (no duplicated business logic): API client, types, and `campusRouter.ts` + `routingNetwork.ts` are pure TypeScript and move unchanged into a shared package. Backend and DB are untouched.
- Cost: every screen is rebuilt (~8 pages); the map is re-implemented in MapLibre. The existing website stays as is.
- Build: `expo prebuild` + local Gradle works with the SDK/JDK 21 already installed, so no paid cloud is required. EAS Build is optional (needs an Expo account).
- Risks: MapLibre needs a dev build (not Expo Go); larger effort; must be done in phases with regression checks.

### Map tiles (decision needed for Option B)
The public `tile.openstreetmap.org` server is not meant to be the production backend of an app. Choices: (1) **self-hosted PMTiles/vector tiles cut from OpenStreetMap data for the campus area** (free, offline-capable, licence-clean, needs a one-time tile build), or (2) a hosted provider free tier with an API key. I recommend (1).

### Hosting
Unchanged for now: `start-tunnel.bat` for demos; institutional domain later. The app reads the API URL from configuration, not from a hardcoded address.

## 6. What was changed during this audit (and evidence)

Only the routing defect and two small honesty fixes were changed, because the route bug was a reported regression. No redesign was started.

| Change | Evidence |
|---|---|
| `frontend/src/services/campusRouter.ts` (TypeScript port of `routing.py`) | `npm test` → **64 passed / 64**, 0 failed (`campusRouter.test.ts`). |
| `frontend/src/data/routingNetwork.ts` (479 edges, 415 nodes, 46 KB) | Generated from `database/seed_data/rvce_campus_routing_network.json`. |
| Offline route fallback now calls the router; no straight-line fabrication | `tsc -b` clean; production build OK. |
| Fixture of real backend responses (`__fixtures__/backendRoutes.json`) | Produced by running the real Python `compute_campus_route` for 10 building pairs × walking/vehicle. |

Commands run in this phase: `npm run lint` (0 errors, 9 warnings), `npm audit --omit=dev` (0 vulnerabilities), `npm test` (64/64), `npm run build` (OK), `gradlew assembleDebug` (BUILD SUCCESSFUL), backend `pytest` (7/7 earlier this session).

## 7. Status labels

| Item | Label |
|---|---|
| Offline road-following routing | IMPLEMENTED BUT NOT FULLY VERIFIED (logic verified by 64 tests; **not yet seen running on a device**) |
| Native Android app | NOT IMPLEMENTED (current app is a WebView shell) |
| Design system, premium UI | NOT IMPLEMENTED |
| Indoor navigation | BLOCKED (no approved floor plans exist) |
| Faculty availability | BLOCKED (no authorised data source) |
| Emulator / device test evidence | BLOCKED (no AVD, no device) |
| Release/AAB build | NOT IMPLEMENTED |

## 8. Decisions needed before Phase 2

1. Approve **Option B** (Expo + React Native + MapLibre), or choose A.
2. Tile source: self-hosted campus vector tiles (recommended) or a hosted provider key.
3. Test target: I can install an Android emulator system image (~1–1.5 GB download) for logs/screenshots, or you can connect your phone with USB debugging. Either gives real evidence; without one I will not claim device testing.
4. Confirm the product name "RVCE Campus Navigator" and the authorised logo asset to use for icon/splash (`frontend/public/assets/rvce-logo.png` and `rvce-crest.png` exist).
