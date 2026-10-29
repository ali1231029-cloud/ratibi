# Builds the web app, syncs it into the Android project and produces the debug APK.
# Run from a normal terminal (Gradle cannot open its loopback socket inside Claude Code's shell).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
if (-not $env:JAVA_HOME) { $env:JAVA_HOME = 'D:\android stoudio\jbr' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'web build failed' }
npx cap sync android
if ($LASTEXITCODE -ne 0) { throw 'cap sync failed' }
Set-Location (Join-Path $root 'android')
.\gradlew.bat assembleDebug --offline
if ($LASTEXITCODE -ne 0) { throw 'gradle build failed' }
Write-Host "APK: $root\android\app\build\outputs\apk\debug\app-debug.apk"
Write-Host 'BUILD-ANDROID-DONE'
