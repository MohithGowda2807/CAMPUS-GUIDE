# RVCE Campus Navigator — Android Architecture Specification (v2.0)

## 1. Executive Summary & Architecture Decision

Per product direction and the Phase 1 repository audit ([PROJECT_AUDIT.md](file:///c:/Users/mohit/RVCE/5th%20sem/DBMS/DBMS%20LAB%20EL/docs/PROJECT_AUDIT.md)), **RVCE Campus Navigator** (`edu.rvce.campusguide`, v2.0.0) is engineered as a **genuine native Android application** built with **Expo SDK 58 (React Native 0.88.1), TypeScript 6.0, Expo Router, and `@maplibre/maplibre-react-native` 11.5**.

The earlier Capacitor WebView wrapper (`frontend/android`) was superseded because WebView-hosted DOM maps cannot satisfy the native gesture responsiveness, bottom-sheet fluidity, hardware-accelerated map rendering, and non-WebView rule (#20) of the specification.

### Preserved Backend, Database & Verified GIS Baseline
Zero destructive rewrites were performed against the backend or verified map assets:
- **Backend**: Python FastAPI (`backend/app/*`) with 4 routers (`public`, `auth_routes`, `visitors`, `admin`) and JWT role-based access control (`require_roles`).
- **Dual-Database Core**: MySQL 8.0.45 (15 normalized 3NF tables, views, triggers, stored procedures) + MongoDB 9.0.2 (`2dsphere` geospatial building footprints, campus pathway network, schematic indoor floor overlays, search telemetry).
- **Verified Campus Map Baseline**:
  - Exact OpenStreetMap raster tile layer (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`) with visible `© OpenStreetMap` attribution.
  - Exact master campus center (`lat: 12.92355, lng: 77.49985, zoom: 16.8`).
  - All 29 verified GeoJSON polygons (1 campus boundary + 28 surveyed RVCE building footprints).
  - All 12 verified campus amenities (`CAFETERIA_FOOD`, `MEDICAL_FIRST_AID`, `GATE_RECEPTION`, `BANK_ATM`, `LIBRARY`, `PARKING`, `AUDITORIUM_HALL`, `ADMIN_SERVICE`).
  - Identical 479-edge / 415-node OSM campus routing network (`routingNetwork.ts`) and parity-verified Dijkstra router (`campusRouter.ts`, 64/64 tests matching `backend/app/services/routing.py`).
  - Complete 339-profile official April 2026 faculty roster across 20 departments.

---

## 2. Technology Stack & Component Mapping

| Tier / Capability | Technology Selected | Version | Architectural Justification |
|---|---|---|---|
| **Framework & Runtime** | Expo SDK + React Native (Hermes) | `~58.0.23` / `0.88.1` | Ahead-of-time Hermes bytecode compilation, New Architecture (Fabric + TurboModules), native Android view hierarchy |
| **Navigation** | `expo-router` + `react-native-screens` | `~58.0.30` / `~4.30.1` | Typed file-based tab & modal routing with native fragment transitions and Android hardware back-button support |
| **Outdoor GIS Engine** | `@maplibre/maplibre-react-native` | `^11.5.1` | Hardware-accelerated C++/OpenGL map engine supporting OSM raster tiles, GeoJSON `ShapeSource` polygons, double-cased `LineLayer` routes, and `PointAnnotation` markers |
| **Indoor Floor Plans** | `react-native-svg` | `15.16.0` | Native vector rendering of MongoDB schematic indoor floor plans (`IndoorFloorModal.tsx`) with interactive tappable room polygons, zoom controls, and searchable room index |
| **Animations & Gestures** | `react-native-reanimated` + `react-native-gesture-handler` | `4.7.1` / `~3.3.0` | Native UI-thread animations and conflict-free touch gesture handling |
| **Secure & Local Storage** | `expo-secure-store` + `@react-native-async-storage/async-storage` | `~58.0.2` / `2.2.0` | Android Keystore-encrypted storage for staff JWT tokens; non-sensitive endpoint preference storage |
| **Location Services** | `expo-location` | `~58.0.20` | Runtime on-demand GPS permission (`requestForegroundPermissionsAsync`) invoked strictly when the user taps My Location |
| **Icons & Splash** | `@expo/vector-icons` + `expo-splash-screen` | `^15.0.2` / `~58.0.13` | Authentic RVCE crest adaptive launcher icon and institutional `#27447E` splash screen |

---

## 3. Directory Layout (`mobile/`)

```text
mobile/
├── app/                                    # Expo Router File-Based Navigation
│   ├── _layout.tsx                         # Root layout (SafeAreaProvider, AuthProvider, CampusDataProvider)
│   ├── (tabs)/                             # Primary 5-Tab Bottom Navigation Bar
│   │   ├── _layout.tsx                     # Institutional bottom tab bar configuration
│   │   ├── index.tsx                       # Home Screen (Spacious search-first campus hub)
│   │   ├── map.tsx                         # Explore Screen (MapLibre GIS, Dijkstra routing, bottom sheets)
│   │   ├── directory.tsx                   # Faculty Directory (339 profiles, filters, public profile modal)
│   │   ├── services.tsx                    # Campus Facilities & Visitor Pass Pre-Registration
│   │   └── profile.tsx                     # Role-Aware Staff Portal (Auth, Availability, Gate Check-In/Out, KPIs)
│   └── modal/
│       └── server-settings.tsx             # Live Backend Switcher & Latency Health Probe Modal
├── src/
│   ├── components/                         # Reusable Design System & GIS Components
│   │   ├── NativeCampusMap.tsx             # MapLibre OSM + GeoJSON polygons + Dijkstra route polylines
│   │   ├── IndoorFloorModal.tsx            # Building -> Floor -> SVG Indoor Plan -> Room Explorer
│   │   ├── BuildingCard.tsx                # Institutional building card
│   │   ├── FacultyCard.tsx                 # Faculty directory card with office & status badges
│   │   ├── SearchBar.tsx                   # Elevated search input with instant clear & press modes
│   │   └── StatusPill.tsx                  # Semantic availability & connectivity pills
│   ├── context/
│   │   ├── AuthContext.tsx                 # Keystore-backed JWT session & role restoration
│   │   └── CampusDataContext.tsx           # Synchronized campus entities, selection & route state
│   ├── services/
│   │   ├── api.ts                          # Typed REST client + Smart Endpoint Auto-Discovery + Offline fallback
│   │   ├── campusRouter.ts                 # On-device Dijkstra router (exact port of backend routing.py)
│   │   └── campusRouter.test.ts            # 64 parity & regression unit tests
│   ├── data/
│   │   ├── fallbackData.ts                 # Verified 28 buildings, 29 polygons, 12 amenities, 20 depts, 339 faculty
│   │   └── routingNetwork.ts               # 479 edges, 415 nodes campus road/walkway graph
│   ├── theme/
│   │   ├── colors.ts                       # RVCE Navy (#27447E) & semantic color tokens
│   │   └── spacing.ts                      # 4pt/8pt spacing & border-radius scale
│   └── types/
│       └── campus.ts                       # Strict TypeScript domain interfaces matching FastAPI schemas
├── .maestro/                               # End-to-End Mobile User Journey Flows (Journeys A–E)
├── assets/                                 # Authorised RVCE Crest Icons & Splash Assets
├── android/                                # Native Gradle project (CMake short-path staging, multi-ABI)
├── app.json                                # Expo manifest (edu.rvce.campusguide, v2.0.0)
└── eas.json                                # EAS Build profiles (development, preview APK, production AAB)
```

---

## 4. Map Migration & Native Rendering Architecture

### 4.1 Exact Baseline Reproduction
`NativeCampusMap.tsx` reproduces the verified web Leaflet map natively inside MapLibre OpenGL:
1. **Raster Style JSON**: Uses MapLibre Style Spec v8 pointing to `https://tile.openstreetmap.org/{z}/{x}/{y}.png` (`tileSize: 256`).
2. **Campus Perimeter**: 37-coordinate polygon rendered via `ShapeSource` + `FillLayer` (`#27447E`, opacity `0.04`) + dashed `LineLayer` (`#1E3A8A`, width `2.5`).
3. **28 Surveyed Building Polygons**: Rendered via `ShapeSource` with dynamic feature properties separating unselected footprints (`#27447E` fill at `0.14` opacity, `1.5px` stroke) from the active selected building (`#1D4ED8` fill at `0.34` opacity, `3px` stroke).
4. **Building Code & Facility Markers**: Native `PointAnnotation` badges for building codes (`ADMIN`, `CSE`, `LIB`, etc.) and color-coded facility dots (`#EA580C` Food, `#DC2626` Medical, `#15803D` Gate, `#0284C7` Bank/ATM, `#27447E` Library).
5. **Multi-Modal Dijkstra Route Layers**:
   - **`DRIVE` (Shared Vehicle + Pedestrian Roads)**: Double-line rendering with `8.5px` white outer casing, `5px` `#2563EB` royal blue inner road line, and `1.5px` white center divider.
   - **`WALK` (Pedestrian Campus Walkways)**: `7.5px` white halo beneath a `4px` `#DC2626` crimson dashed pathway line (`[2.2, 1.6]`).
   - **`ACCESS_CONNECTOR`**: Dotted `#475569` building-entrance connector (`[1.2, 1.5]`).
   - **Endpoints**: Green `A` origin pin and Red `B` destination pin, with automatic camera `fitBounds` framing the full route.

### 4.2 Separation of Outdoor GIS and Indoor Schematic Coordinates
- Outdoor navigation operates strictly in WGS84 (`[lng, lat]`) on MapLibre.
- Indoor exploration (`IndoorFloorModal.tsx`) operates in normalized local SVG plan coordinates (`0..1000 × 0..620` viewBox) fetched from `/api/v1/buildings/{id}/floors/{floor_id}/plan`, clearly displaying a governance notice whenever a floor plan is a schematic sample (`SAMPLE_DEV`) rather than an architecturally surveyed CAD plan.

---

## 5. Native Build Engineering (Windows `MAX_PATH` & Multi-ABI Standalone APK)
- **CMake Path Mitigation**: React Native 0.88 New Architecture compiles C++ JSI bridges (`react-native-worklets`, `react-native-reanimated`, `react-native-screens`, `react-native-svg`). On Windows, deep workspace paths exceed the 260-character Win32 limit inside Ninja object directories. `mobile/android/build.gradle` and `mobile/android/app/build.gradle` configure short staging roots (`C:/cx/a` and `C:/rvce_cxx/${subproject.name}`) alongside `-DCMAKE_OBJECT_PATH_MAX=220` so CMake MD5-hashes deep codegen paths while keeping every object and dependency path safely under 225 characters.
- **Universal Multi-ABI Standalone Packaging**: Configured with `reactNativeArchitectures=arm64-v8a,x86_64` and `assembleRelease` Hermes bytecode bundling so a single `.apk` installs and runs standalone (without Metro) on both `x86_64` Android Studio emulators and `arm64-v8a` physical Android phones.
