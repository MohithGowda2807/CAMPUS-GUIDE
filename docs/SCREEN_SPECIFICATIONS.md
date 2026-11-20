# RVCE Campus Navigator — Screen & Interaction Specifications (v2.0)

## 1. Information Architecture

The mobile application uses **Expo Router** with a clean 5-tab institutional bottom navigation bar and dedicated modal sheets:

```text
app/
├── (tabs)/
│   ├── index.tsx      -> 1. Home      (Search-first campus discovery, live status pill, quick services, landmarks)
│   ├── map.tsx        -> 2. Explore   (Full-bleed MapLibre campus map, category filters, Dijkstra routing, sheets)
│   ├── directory.tsx  -> 3. Faculty   (339 verified faculty records, 20-dept filter chips, public profile modal)
│   ├── services.tsx   -> 4. Services  (12 verified campus facilities + Visitor Pass pre-registration)
│   └── profile.tsx    -> 5. Account   (Staff JWT sign-in, availability broadcast, gate check-in/out, 30d KPIs)
└── modal/
    └── server-settings.tsx            (Smart endpoint auto-discovery, custom URL/Cloudflare tunnel, latency ping)
```

---

## 2. Detailed Screen Specifications

### 2.1 Home Screen (`mobile/app/(tabs)/index.tsx`)
- **Header**: Official circular RVCE crest (`assets/icon.png`), application title **RVCE Campus Navigator**, subtitle *R. V. College of Engineering®*, and interactive **Server Online / Offline Cache** pill linking to Server Settings.
- **Hero Search Bar**: Elevated white search trigger (`"Search 28 buildings, 339 faculty, labs..."`) transitioning directly to the Explore Map search experience.
- **Hero Campus Map Card**: Deep RVCE Navy (`#27447E`) interactive banner highlighting Walking Pathways and Vehicle Roads with one-tap `Explore` action.
- **Campus Quick Services (2×2 Grid)**:
  - **Faculty** (`339 Profiles` → Directory tab)
  - **Food & Health** (`Canteens & Clinic` → Services tab)
  - **Visitor Pass** (`Gate Pre-Entry` → Services tab pre-selected to `VISITOR_PASS`)
  - **Staff Portal** (`Status & Admin` → Account tab)
- **Key Campus Landmarks**: Verified building cards (Administrative Block, CSE, Library, etc.) that fly the map directly to the selected building. Zero fake popularity counts.

### 2.2 Explore Map Screen (`mobile/app/(tabs)/map.tsx` + `NativeCampusMap.tsx`)
- **Full-Bleed MapLibre Canvas**: Occupies 100% of the screen behind floating controls.
- **Top Floating Search & Filter Header**:
  - Instant search input with debounced server + local fallback search across buildings, rooms, departments, facilities, and faculty.
  - Grouped results with entity type badges (`BUILDING`, `DEPARTMENT`, `FACILITY`, `ROOM`, `FACULTY`) and clean empty-result feedback.
  - Horizontal category filter chips: `All Campus`, `Departments`, `Labs & R&D`, `Cafeterias`, `Libraries`, `Hostels`, `Medical & Gate`.
- **Right-Margin Floating Action Buttons** (`top: 152dp`, clear of top search bar):
  - **Reset Campus View**: Restores camera to `[12.92355, 77.49985]`, zoom `16.8`, pitch `0°`.
  - **My Location (GPS)**: Requests `expo-location` permission only on tap; plots live blue GPS marker and offers GPS as route origin.
  - **Travel Mode Quick Switch**: Toggles between Pedestrian (`WALKING`) and Vehicle (`VEHICLE`) modes with haptic feedback.
- **Destination Bottom Sheet**:
  - Displays verified building/facility name, code badge, category, accessibility indicator, floor count, operating hours, and description.
  - Actions:
    1. **`Directions`** — Computes multi-leg Dijkstra route along campus roads/walkways from current origin (`Main Gate`, `GPS`, or custom `Set Start` building).
    2. **`Floors & Rooms`** (for buildings) — Opens `IndoorFloorModal` for `Building → Floor → SVG Floor Plan → Room`.
    3. **`Set Start`** — Sets this building/facility as custom navigation origin (`A`).
- **Active Navigation Bottom Card**:
  - Live **`Walk` / `Drive`** segmented mode switcher (recalculates route immediately).
  - **`Swap`** origin/destination button and **`Clear`** route action.
  - Total distance (`m`), estimated duration (`min`), staircase warning pill when applicable, and expandable **Turn-by-Turn** step list (tapping any step focuses the map camera on that maneuver node).

### 2.3 Indoor Floor Plan Explorer (`mobile/src/components/IndoorFloorModal.tsx`)
- **Hierarchy**: `Building → Floor Selector Chips → Interactive SVG Floor Plan → Room Details`.
- **Governance Banner**: Clearly distinguishes schematic development floor plans (`SAMPLE_DEV`) from architecturally verified surveys—never claiming indoor turn-by-turn routing.
- **Interactive Vector Plan**: Rendered natively via `react-native-svg` with color-coded room polygons (Laboratories, Classrooms, HOD/Faculty Cabins, Seminar Halls, Washrooms/Stairs/Lifts), zoom controls (`-`, `100%`, `+`, `Reset`), and tap-to-inspect room highlighting.
- **Searchable Room Index**: Accessible list below the plan allowing users to filter rooms by code, name, or type and view assigned faculty occupants (`/api/v1/rooms/{room_id}`).

### 2.4 Faculty Directory (`mobile/app/(tabs)/directory.tsx`)
- **Search & Department Chips**: Instant filtering across 339 official faculty records and 20 department filter chips (`All (339)`, `CSE`, `ECE`, `ISE`, `AIML`, `ME`, etc.).
- **Virtualised FlatList**: Configured with `initialNumToRender={14}`, `maxToRenderPerBatch={12}`, and `windowSize={7}` for smooth 60 FPS scrolling.
- **Approved Public Profile Modal**: Tapping a faculty card opens a bottom sheet displaying only approved public records: full name, designation, qualification, leadership role, department, employee ID, verified availability status (`Available`, `Busy / Scheduled`, `Unavailable`, or `Not Updated` — never inferred from timetables), public note, and `View Department Building on Map`.

### 2.5 Campus Services & Visitor Registration (`mobile/app/(tabs)/services.tsx`)
- **Facilities Tab**: Category filter chips (`All`, `Food & Canteens`, `Medical`, `Bank & ATM`, `Library & Halls`, `Gates & Parking`) over the 12 verified campus amenities; tapping any card highlights and flies to its pin on the Explore Map.
- **Visitor Pass Tab**: Keyboard-aware registration form (`Full Name *`, `Mobile Number *` 10-digit validation, quick `Purpose of Visit *` chips, optional `Host Faculty` and `Destination Building` chip selector). Prevents duplicate submission while in flight and renders the sequential digital pass receipt (`RVCE-YYYYMMDD-XXXX`).

### 2.6 Staff & Admin Portal (`mobile/app/(tabs)/profile.tsx`)
- **Unauthenticated View**: Institutional staff sign-in form (`POST /api/v1/auth/login` → JWT saved in `expo-secure-store`), invalid-credential error banner, 1-tap DBMS Lab evaluation chips (`HOD (CSE)`, `Faculty (CSE)`, `Security Gate`, `SysAdmin`), and emergency campus desk contacts.
- **Authenticated Role-Aware View**:
  - **Staff Identity Card**: Full name, department, and role pills (`FACULTY_STAFF`, `DEPT_COORDINATOR`, `SECURITY_RECEPTION`, `FACILITY_ADMIN`, `SYSTEM_ADMIN`).
  - **30-Day Institutional Activity Strip** (Admin/Security roles): Live metrics from `/api/v1/admin/reports/summary`.
  - **Office Availability Broadcast** (Faculty roles): Broadcasts `AVAILABLE`, `BUSY_SCHEDULED`, `UNAVAILABLE`, or `UNKNOWN` with expiry timer (`30m`, `1h`, `3h`, `6h`) and optional public note.
  - **Gate Visitor Log** (Security/Admin roles): Lists recent visitor passes with one-tap **`Check In`** and **`Check Out`** actions wired to MySQL stored procedures (`sp_check_in_visit`, `sp_check_out_visit`).
