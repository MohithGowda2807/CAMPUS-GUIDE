# RVCE Campus Navigator — Android Build, Installation & Deployment Guide

## 1. Build Prerequisites (Windows Host)

1. **Java Development Kit (JDK 17 or 21)**:
   - Use Android Studio's bundled JetBrains Runtime (`JDK 21`):
     ```powershell
     $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
     ```
   - *Note*: Avoid JDK 25+ as Gradle 9.x / Kotlin 2.2 requires JDK 17–21.
2. **Android SDK & NDK**:
   - `$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"`
   - Required components installed: `platforms;android-36`, `platforms;android-37`, `build-tools;37.0.0`, `ndk;27.1.12297006`, `cmake;3.22.1`, `platform-tools`.
3. **Node.js & Dependencies**:
   - Inside `mobile/`: `npm install`

---

## 2. Windows `MAX_PATH` C++ Engineering Note

React Native 0.88 New Architecture compiles native C++ JSI targets (`react-native-worklets`, `react-native-reanimated`, `react-native-screens`, `react-native-svg`, `@maplibre/maplibre-react-native`). When the project lives inside a deep Windows directory with spaces, Ninja's default `.cxx` object file paths exceed the 260-character Win32 limit.

This repository solves this automatically in Gradle—no manual directory relocation is required:
- [`mobile/android/build.gradle`](file:///c:/Users/mohit/RVCE/5th%20sem/DBMS/DBMS%20LAB%20EL/mobile/android/build.gradle) sets `buildStagingDirectory = file("C:/rvce_cxx/${subproject.name}")` and `-DCMAKE_OBJECT_PATH_MAX=220` for all CMake library modules.
- [`mobile/android/app/build.gradle`](file:///c:/Users/mohit/RVCE/5th%20sem/DBMS/DBMS%20LAB%20EL/mobile/android/app/build.gradle) sets `buildStagingDirectory = file("C:/cx/a")` and `-DCMAKE_OBJECT_PATH_MAX=220` so CMake MD5-hashes long autolinked codegen paths cleanly below 225 characters.

---

## 3. Building the Standalone Installable Android APK (Local Gradle)

> **Why `assembleRelease` instead of `assembleDebug`?**
> In Expo / React Native, `assembleDebug` omits the JavaScript bundle and requires a live Metro dev server. `assembleRelease` runs `expo export:embed`, compiles ahead-of-time **Hermes bytecode** directly into the APK, and packs native `.so` libraries for both **`arm64-v8a`** (physical Android phones) and **`x86_64`** (Android Studio emulators).

Run from PowerShell:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
Set-Location "c:\Users\mohit\RVCE\5th sem\DBMS\DBMS LAB EL\mobile\android"
.\gradlew.bat assembleRelease
```

### Verified Binary Metadata (`aapt2 dump badging`)
- **Gradle Output**: `mobile/android/app/build/outputs/apk/release/app-release.apk`
- **Canonical Deliverable**: `artifacts/android/rvce-campus-navigator.apk`
- **Application Name**: `RVCE Campus Navigator`
- **Package Identifier**: `edu.rvce.campusguide`
- **Version**: `2.0.0` (`versionCode: 2`)
- **SDK Levels**: `minSdkVersion: 24` (Android 7.0+) | `targetSdkVersion: 36` | `compileSdkVersion: 37`
- **Bundled Native ABIs**: `arm64-v8a` (64-bit physical Android phones) + `x86_64` (Android Studio emulators)
- **JavaScript Runtime**: Bundled ahead-of-time Hermes bytecode (zero Metro dev server required)
- **File Size**: `90.84 MB` (`95,256,202 bytes` universal dual-ABI APK bundling 1,948 Hermes JS modules + 51 vector/image assets + full offline RVCE GIS & 339-faculty dataset; ~45 MB per single ABI when split via Play Store AAB)
- **SHA-256 Checksum**: `CD2371C855D89C761FC352D361AC405A2452729CB151DDD8A8321D5B8EE43BF3`

---

## 4. Building via Expo Application Services (EAS Cloud Build)

[`mobile/eas.json`](file:///c:/Users/mohit/RVCE/5th%20sem/DBMS/DBMS%20LAB%20EL/mobile/eas.json) is pre-configured with three profiles:
- **`development`**: Development client APK (`developmentClient: true`).
- **`preview`**: Direct-install standalone `.apk` (`"android": { "buildType": "apk" }`).
- **`production`**: Google Play Store `.aab` (`"android": { "buildType": "app-bundle" }`).

To trigger a cloud APK or Play Store AAB build when logged into an Expo account:
```powershell
Set-Location "c:\Users\mohit\RVCE\5th sem\DBMS\DBMS LAB EL\mobile"
npx eas-cli build --platform android --profile preview      # Generates .apk
npx eas-cli build --platform android --profile production   # Generates .aab for Play Store
```

> **Production Signing Keystore**: Local preview/evaluation builds use `debug.keystore` for frictionless sideloading during testing. Before publishing to Google Play, generate a private upload keystore (`keytool -genkeypair -v -storetype PKCS12 -keystore rvce-upload.keystore -alias rvce-key -keyalg RSA -keysize 2048 -validity 10000`) and keep it outside Git (`.gitignore` already excludes `*.jks` and `*.keystore` secrets).

---

## 5. Installing & Connecting on Physical Android Phones vs Emulator

### A. Android Studio Emulator (`rvce_pixel6`)
1. Launch the emulator:
   ```powershell
   & "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -avd rvce_pixel6
   ```
2. Install the APK:
   ```powershell
   & "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r "artifacts\android\rvce-campus-navigator.apk"
   ```
3. **Backend Connection**: Automatic! The app probes `http://10.0.2.2:8000/api/v1` on startup and connects immediately to FastAPI running on `127.0.0.1:8000`.

### B. Physical Android Phone via USB Debugging (Fastest & Zero Wi-Fi Firewall Issues)
1. Enable **Developer Options → USB Debugging** on your Android phone and connect via USB cable.
2. Verify device authorization and forward port `8000`:
   ```powershell
   & "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices
   & "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" reverse tcp:8000 tcp:8000
   & "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r "artifacts\android\rvce-campus-navigator.apk"
   ```
3. **Backend Connection**: Automatic! With `adb reverse`, the phone's `http://127.0.0.1:8000/api/v1` probe tunnels over USB straight to your PC's FastAPI server.

### C. Physical Android Phone Over Wi-Fi LAN or Anywhere Over Internet
- **Same Wi-Fi / Hotspot**: Start FastAPI bound to all interfaces (`uvicorn app.main:app --host 0.0.0.0 --port 8000`) and ensure your PC's LAN IP matches the Server Settings URL (e.g., `http://192.168.1.7:8000/api/v1`).
- **Anywhere on Mobile Data (4G/5G) Until RVCE Domain Hosting Is Assigned**: Run `start-tunnel.bat` in the project root to open a free HTTPS Cloudflare Quick Tunnel (`https://<name>.trycloudflare.com`), then paste `https://<name>.trycloudflare.com/api/v1` into **Server Settings** inside the app (tap the top-right status pill on the Home screen).
- **Zero-Network / Offline Mode**: Even with zero backend connection, the APK remains 100% functional for campus map browsing, 28 building details, 339 faculty profiles, 12 amenities, schematic floor plans, and on-device Dijkstra road/walkway routing.
