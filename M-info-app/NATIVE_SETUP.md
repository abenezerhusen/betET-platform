# Telebirr Pay agent app — native setup

The Gradle shell (`android/settings.gradle.kts`, `build.gradle.kts`,
wrappers, launcher resources) is **committed** so you can open
`M-info-app/android` on any machine that has Flutter installed.

You still need **`android/local.properties`** with `sdk.dir` and
`flutter.sdk` — copy `android/local.properties.example` and edit paths.

See **`ANDROID_BUILD.md`** for `flutter build apk` and installing on a phone.

## Optional: regenerate missing Android pieces

If Gradle or Flutter tooling complains about missing generated files, run:

```sh
cd M-info-app

flutter create --platforms=android \
  --org com.ptoproxy \
  --project-name m_info_app \
  .
```

`flutter create` is intended to be non-destructive under `android/app/src/main/`;
still verify `AndroidManifest.xml` after regeneration (SMS permissions,
BootReceiver, cleartext flag for LAN dev).

## Gradle IDs

`android/app/build.gradle.kts` pins **`applicationId` / `namespace`** to
`com.ptoproxy.telebirr_pay_client` (matches Kotlin + manifest). **`compileSdk`**
and **`targetSdk`** follow the Flutter toolchain (`flutter.compileSdkVersion`,
`flutter.targetSdkVersion`).

To run on a device or emulator:

```sh
flutter pub get
flutter run -d <device-id>
```

## Why the Manifest is hand-written

We require declarations the default Flutter manifest doesn't ship:
- `RECEIVE_SMS` / `READ_SMS` for the Telebirr listener
- `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_DATA_SYNC` for Android 14
- `RECEIVE_BOOT_COMPLETED` so the agent re-pings on power-up
- `BootReceiver` and `ServiceAlarmReceiver` declarations
- `<queries>` block for the SMS sender lookup on Android 11+

If a future `flutter create` ever overwrites the manifest, regenerate
the missing pieces from `android/app/src/main/AndroidManifest.xml` in
this repo.

## flutter_background_service vs custom PayService.kt

The product spec mentions `PayService.kt` as the foreground service.
We rely on the `flutter_background_service` plugin's bundled
`id.flutter.flutter_background_service.BackgroundService` instead — it
is the same shape (extends `Service`, calls `startForeground()` within
the 5s window, manages a notification) but is upstream-maintained.
`BootReceiver` and `ServiceAlarmReceiver` reference that class
directly. If you ship a custom `PayService.kt`, swap the references
in BootReceiver/ServiceAlarmReceiver.

## Pairing flow at runtime

1. First launch → `LoginScreen` asks for backend URL + Telebirr number
   + password. AppConfig persists the URL; SecureStore persists the
   token + a small session blob.
2. Auth success → `HomeScreen` starts:
   - `SmsService` (incoming-SMS listener + drain timer)
   - `BackgroundServiceController` (foreground service +
     persistent notification)
   - `HeartbeatService` (60s heartbeat → reachability state)
3. Boot path → `BootReceiver` reads `flutter.cfg.autostart`. The
   operator turns this on from a future Settings screen (currently
   defaults to `false` for safety on fresh installs).
