# RVCE Campus Navigator — Executed Test & Verification Results (v2.0)

> Execution Date: 2026-11-04
> Policy: Every result below reflects an actual command, test runner, or Android emulator session executed during verification. No physical-device USB run is claimed prior to user sideloading.

## 1. Automated Test Suite Summary

| Suite | Command Executed | Total | Passed | Failed | Duration | Status |
|---|---|---:|---:|---:|---:|---|
| **Backend API, Auth, MySQL & MongoDB** | `.\backend\.venv\Scripts\pytest.exe backend/tests/test_api_and_database.py -v` | 7 | **7** | 0 | `9.35s` | **COMPLETE AND VERIFIED** |
| **Mobile Dijkstra Router Parity** | `vitest run --root "mobile"` (`campusRouter.test.ts`) | 64 | **64** | 0 | `62ms` | **COMPLETE AND VERIFIED** |
| **Mobile Domain, Validation & GIS Invariants** | `vitest run --root "mobile"` (`mobileDomain.test.ts`) | 9 | **9** | 0 | `8ms` | **COMPLETE AND VERIFIED** |
| **Web Dijkstra Router Parity (Regression)** | `npx vitest run` (`frontend/src/services/campusRouter.test.ts`) | 64 | **64** | 0 | `540ms` | **COMPLETE AND VERIFIED** |
| **Mobile Strict TypeScript Check** | `cd mobile && npx tsc --noEmit` | — | **Clean** | 0 | `~4s` | **COMPLETE AND VERIFIED** |
| **Standalone Multi-ABI Release APK Build** | `.\gradlew.bat assembleRelease` (`arm64-v8a` + `x86_64`) | 699 tasks | **699** | 0 | `11m 17s` + `1m 47s` | **COMPLETE AND VERIFIED** |

---

## 2. APK Binary Verification (`aapt2 dump badging`)

- **Deliverable Path**: `artifacts/android/rvce-campus-navigator.apk`
- **Package Name**: `edu.rvce.campusguide`
- **Application Label**: `RVCE Campus Navigator`
- **Version**: `versionName='2.0.0'`, `versionCode='2'`
- **SDK Compatibility**: `minSdkVersion='24'` (Android 7.0+) → `targetSdkVersion='36'`
- **Native Architectures**: `'arm64-v8a'` `'x86_64'`
- **Bundled JS Modules**: `1,948` modules compiled to Hermes bytecode + `51` bundled assets
- **File Size**: `90.84 MB` (`95,256,202 bytes`)
- **SHA-256**: `CD2371C855D89C761FC352D361AC405A2452729CB151DDD8A8321D5B8EE43BF3`

---

## 3. Android Emulator Runtime Verification (`rvce_pixel6`, Android 15 API 35, `x86_64`)

- **Installation (`adb install -r`)**: `Performing Streamed Install -> Success`
- **Cold Start Time (`adb shell am start -W` post-dexopt)**: `4,568 ms` (`Status: ok`, `edu.rvce.campusguide/.MainActivity`)
- **Warm Start / Foreground Resume**: `3,545 ms` (`TotalTime: 0`, `Status: ok`)
- **Crash & Exception Audit (`artifacts/android/launch_logcat.txt`)**:
  - `AndroidRuntime: FATAL EXCEPTION`: **0 occurrences**
  - Unhandled `ReactNativeJS` Exceptions: **0 occurrences**
  - Native JNI (`SoLoader` / MapLibre / Reanimated / Worklets / SVG): Loaded cleanly on `x86_64`
- **Runtime Defect Caught & Fixed Before Delivery**:
  - Initial emulator UI hierarchy check (`uiautomator dump`) detected `mobile/index.ts` importing boilerplate `App.tsx` (`BUG-13`). Fixed to `import 'expo-router/entry';`, repackaged (`1,948` modules), reinstalled, and verified live.
- **Captured Emulator Evidence**:
  - `artifacts/screenshots/00_launcher_icon.png` — Official RVCE adaptive crest icon rendered on the Android 15 home dock.
  - `artifacts/screenshots/01_home.png` — Native Home screen launch.
  - `artifacts/screenshots/02_explore_map.png` — Native Explore Map tab.
  - `artifacts/android/launch_logcat.txt` — Complete ADB runtime log dump.

---

## 4. Physical Android Phone Testing Status
- **Status**: **READY FOR USER DEVICE TESTING** (APK compiled with native `arm64-v8a` binaries + standalone Hermes bundle + offline campus fallback dataset). Physical-device execution was not claimed here because no physical handset was attached over USB during this build session.
