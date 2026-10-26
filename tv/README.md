# Lumina TV

The Fire TV / Android TV app for Lumina: search for a song or a video, **play it now or download it to keep**, with
no ads. A native Android app (Kotlin, Jetpack Compose), separate from the PC app in the repository root.

* Design, decisions and **what has and has not been proven**: [`../docs/15_FIRE_TV.md`](../docs/15_FIRE_TV.md) — read this first.
* Licence: **GPL-3.0** ([`LICENSE`](LICENSE)). It links NewPipe Extractor, which is GPL-3.0. The PC app is MIT; they are separate programs.

## Build

Needs JDK 17+ (21 was used), the Android SDK (platform 36, build-tools 35 or 36) and internet for the first build.
Create `local.properties` with `sdk.dir=<path to your Android SDK>` (it is git-ignored), then:

```bash
./gradlew :app:testDebugUnitTest      # the Kotlin unit tests (29)
./gradlew :app:assembleDebug          # app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:assembleRelease        # shrunk (R8); unsigned — sign before installing
```

`./gradlew` downloads Gradle 8.14.6 on first use. The Kotlin tests read `../shared/contract/portable-names.json`, so they
must run with the repository intact.

Regenerate the launcher banner and icons from the brand SVG (rarely needed, the PNGs are committed), from the repo root:

```bash
node tv/tools/make-assets.mjs
```

## Put it on a Fire TV Stick

*From general knowledge of Fire OS menus, not checked against your stick — the names may differ slightly.*

1. On the stick: **Settings → My Fire TV → About**, press Select on the device name 7 times to unlock **Developer options**.
2. **Developer options**: turn on **ADB debugging**, and allow installing apps from unknown sources.
3. Note the stick's IP address (**About → Network**). Then on your PC:

```bash
adb connect <ip>:5555          # accept the prompt that appears on the TV
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Fire OS 8 only installs apps signed with **APK signature scheme v2**. Both the debug and the (locally signed) release builds
are v2-signed; this was checked with `apksigner verify`.

Check the stick before trusting anything about performance: `adb shell getprop ro.product.cpu.abilist` (the stick is
expected to be 32-bit ARM, `armeabi-v7a`; the APK contains it).

## Test on the emulator

Create an Android TV AVD from the `android-30` / `android-tv` x86 system image with 2 GB of RAM, then
`adb install` and run. Notes learned the hard way:

* Start it with `-dns-server 8.8.8.8` if searches fail with "Unable to resolve host".
* `adb shell input keyevent` presses and releases a key about 2 ms apart; if the app is busy the release can be lost
  (a Back press seems ignored). A real remote does not do that.
* The emulator decodes video in software. A 1080p60 stream can stall on it that a real stick would play. Its "Frames
  dropped" figure says nothing about the stick.

## What is where

```
app/src/main/java/com/lumina/tv/
  core/       Pure logic, no Android: file naming, speed steps, stream picking, byte ranges, formatting. Unit tested.
  data/       The extractor wrapper (search, resolve), the library index, storage volumes, settings.
  download/   Resumable chunked download, the on-device muxer, the queue and its foreground service.
  player/     One shared ExoPlayer, the media session service, the controller that decides quality and recovery.
  ui/         Compose screens: home, search, library, downloads, settings, now playing, video.
```
