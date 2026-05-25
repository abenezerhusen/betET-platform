# Build an Android APK (Telebirr Pay agent app)

The CI/agent sandbox here does not include the Flutter SDK, so **you build the APK on your PC** where Flutter + Android SDK are installed.

## Prerequisites

- [Flutter](https://docs.flutter.dev/get-started/install) **3.22+** (stable), `flutter doctor` clean for Android toolchain  
- Android SDK + JDK **17** (Android Studio installs both)  
- Backend reachable from the phone (same Wi‑Fi + firewall rule, or HTTPS tunnel)

## One-time: `local.properties`

After cloning, create:

`M-info-app/android/local.properties`

```properties
sdk.dir=C:\\Users\\YOUR_USER\\AppData\\Local\\Android\\Sdk
flutter.sdk=C:\\path\\to\\flutter
```

Paths must match **your** machine (`sdk.dir` is from Android Studio → SDK Manager).

## Install deps & build release APK

From repo root:

```powershell
cd M-info-app
flutter pub get
flutter build apk --release
```

Output APK:

`M-info-app/build/app/outputs/flutter-apk/app-release.apk`

Copy that file to the phone (USB, Drive, etc.), open it, allow **Install unknown apps** for your file manager, install.

Debug APK (larger, faster iteration):

```powershell
flutter build apk --debug
```

Output: `build/app/outputs/flutter-apk/app-debug.apk`

## Connect a **physical** Android phone to your dev backend

1. Run the backend on your PC (`backend`: `npm run dev`). Note the port (often **4000** — check your `.env`).
2. On Windows, allow inbound TCP on that port for **Private** networks (Defender Firewall).
3. Find your PC LAN IP (e.g. `192.168.1.42`).  
   **Do not use `http://10.0.2.2`** on a real phone — that is **Android emulator → host loopback only**.
4. On first login in the app, set **Backend URL** to `http://YOUR_PC_IP:PORT` (no trailing slash). The manifest enables **cleartext HTTP** for this dev workflow only.
5. Use Telebirr agent credentials created via the admin flow / backend for `/api/agent/auth/login`.

HTTPS or production builds should remove cleartext usage and rely on TLS.

## Quick script

From repo root:

```powershell
.\M-info-app\scripts\build-android-apk.ps1
```

Fails fast if `flutter` is not on `PATH`.
