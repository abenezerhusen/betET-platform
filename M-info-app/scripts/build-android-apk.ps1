$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot\..

if (-not (Get-Command flutter -ErrorAction SilentlyContinue)) {
    Write-Error "Flutter is not on PATH. Install Flutter 3.22+ and ensure 'flutter doctor' passes for Android."
}

flutter pub get
flutter build apk --release

Write-Host ""
Write-Host "APK: build/app/outputs/flutter-apk/app-release.apk"
