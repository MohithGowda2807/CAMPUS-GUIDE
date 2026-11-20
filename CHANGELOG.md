# Changelog — RVCE Campus Navigator

All notable engineering, architecture, UI/UX, GIS, and Android release changes are documented in this file.

## [2.1.0] — 2026-11-05 (Physical Android Map & From/To Navigation Fix — `versionCode: 3`)

### Added
- **Full `From (A)` & `To (B)` Campus Navigation Planner (`mobile/app/(tabs)/map.tsx`)**:
  - One-tap **`Directions`** button next to the top search bar, **`Route A → B`** chip on Map & Home tabs, and **`From Here`** / **`Directions`** actions on every building/facility card.
  - Tappable **`From (A)`** and **`To (B)`** selector rows opening a full-screen searchable picker across **My Live GPS**, **Tap Spot on Map**, **Main Mysuru Road Entrance Gate (`GATE-MAIN`)**, all **12 verified campus amenities**, and all **28 RVCE buildings & departments**.
  - Interactive **`Tap on Map`** mode (`ORIGIN` or `DESTINATION`) supporting building footprints, pins, or arbitrary campus road/walkway coordinates.
  - Instant **`Walking` / `Vehicle`** mode toggle, **`Swap (⇅)`** endpoints button, collapsible bottom route summary sheet, expandable **Turn-by-Turn** steps, and **`+` / `-`** map zoom buttons.

### Fixed
- **MapLibre v11 Fabric Touch & Android Surface Compositing (`NativeCampusMap.tsx`)**:
  - Switched `<Map>` to `androidView="texture"` (`TextureView`) to eliminate Android `GLSurfaceView` Z-order touch/overlay glitches on physical phones (`BUG-14`).
  - Unwrapped `e.nativeEvent.features` and `e.nativeEvent.lngLat` so all 28 RVCE building footprints and map coordinate taps register reliably.
  - Wrapped building and facility `<Marker>` children in padded `<TouchableOpacity>` targets with `280ms` press deduplication, and moved route `A`/`B` endpoint indicators to non-blocking GPU `CircleLayer`s (`pointerEvents="none"`).
  - Upgraded active route framing to `cameraRef.current.fitBounds(...)` with top/bottom card padding.

---

## [2.0.0] — 2026-11-04 (Native Android Release — `versionCode: 2`)

### Added
- **Genuine Native Android Application (`mobile/`)**: Built from the ground up on **Expo SDK 58 + React Native 0.88.1 + TypeScript 6.0 + Expo Router** (`edu.rvce.campusguide`), replacing the Capacitor WebView wrapper while keeping the web app (`frontend/`) and FastAPI backend (`backend/`) intact.
- **Native Hardware-Accelerated Campus Map (`NativeCampusMap.tsx`)**: Powered by `@maplibre/maplibre-react-native` 11.5, preserving the exact verified OpenStreetMap raster tiles, `[12.92355, 77.49985]` campus center, 1 campus perimeter polygon, 28 surveyed RVCE building footprints, 12 color-coded facility POIs, and multi-modal route casing (`DRIVE` double-line blue/white roads + `WALK` crimson dashed footpaths).
- **Interactive Native Indoor Floor Plan Explorer (`IndoorFloorModal.tsx`)**: Complete `Building → Floor → SVG Floor Plan → Room` flow built with `react-native-svg`, supporting floor switching, interactive room selection, zoom controls, faculty occupant lookup, searchable room index, and transparent `SAMPLE_DEV` governance badges.
- **On-Device Parity-Verified Dijkstra Router (`mobile/src/services/campusRouter.ts`)**: Exact TypeScript port of `backend/app/services/routing.py` over the 479-edge / 415-node campus pathway graph (`64/64` parity unit tests), eliminating straight-line-over-buildings offline fallbacks.
- **Custom Origin, Travel Mode & Turn-by-Turn Navigation (`map.tsx`)**: Added `Set Start` on any building/facility or GPS, live `Walk` / `Drive` route recalculation, Origin/Destination `Swap`, and expandable Turn-by-Turn step list with camera node focusing.
- **Approved Public Faculty Profile Sheet (`directory.tsx`)**: Added faculty detail modal showing verified designation, qualification, leadership role, department, employee ID, opt-in availability state, and one-tap building locator across all 339 RVCE faculty records.
- **Role-Aware Staff & Security Gate Portal (`profile.tsx`)**: Added `expo-secure-store` JWT persistence, faculty office availability broadcasting (`AVAILABLE`, `BUSY_SCHEDULED`, `UNAVAILABLE`, `UNKNOWN`), Security Gate Visitor Log with one-tap `Check In` / `Check Out`, and 30-day institutional KPI summary strip.
- **Smart Backend Auto-Discovery (`api.ts`)**: Automatic startup health probing across `10.0.2.2:8000` (Emulator), `127.0.0.1:8000` (USB `adb reverse`), and `192.168.1.7:8000` (Wi-Fi LAN) with instant fallback to verified bundled campus datasets.
- **Automated Mobile QA & Build Infrastructure**:
  - 73 mobile Vitest unit & parity tests (`campusRouter.test.ts` + `mobileDomain.test.ts`).
  - 5 Maestro E2E user journey specifications (`mobile/.maestro/01..05_*.yaml`).
  - `mobile/eas.json` (`development`, `preview` APK, `production` AAB) and Windows `MAX_PATH`-safe CMake staging (`C:/rvce_cxx`) producing standalone multi-ABI (`arm64-v8a` + `x86_64`) Release APKs.

### Fixed
- Resolved Windows 260-character `MAX_PATH` Ninja C++ build failures across `react-native-worklets`, `react-native-reanimated`, and `:app` codegen (`BUG-01`).
- Resolved mobile `"Failed to fetch"` / offline lockouts caused by `127.0.0.1` vs LAN IP mismatch and Android cleartext HTTP policy (`BUG-02`).
- Fixed straight-line offline route regression (`BUG-04`), staff availability enum mismatches (`BUG-05`), overlapping floating map controls (`BUG-06`), facility category marker colors (`BUG-09`), and purple non-brand card styling (`BUG-10`).

---

## [1.0.0] — 2026-11-02 (Initial Web Portal & Dual-DBMS Foundation)
- Delivered React + Vite + Leaflet web application (`frontend/`), Python FastAPI REST backend (`backend/`), MySQL 8.0 normalized 3NF relational schema (15 tables, views, triggers, stored procedures), and MongoDB 9.0 geospatial collections (`building_geometries`, `campus_pathways`, `floor_map_overlays`, `search_logs`).
