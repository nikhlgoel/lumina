# Changes made to the Fire TV Stick (AFTMA08C15) on 2026-10-22

Backed-up APKs sit in this folder. Everything below can be undone.

| Change | Package | Undo |
|---|---|---|
| Uninstalled LocalSend | org.localsend.localsend_app | `adb install org.localsend.localsend_app_base.apk` (settings/data were not kept) |
| Uninstalled VLC | org.videolan.vlc | `adb install org.videolan.vlc_base.apk` |
| Uninstalled Pixel Music | com.unshoo.pixelmusic | `adb install com.unshoo.pixelmusic_base.apk` |
| Disabled Prime Video (system app, identified by launching it) | com.amazon.firebat | `adb shell pm enable com.amazon.firebat` |
| Disabled Amazon Luna (system app, identified by launching it) | com.amazon.spiderpork | `adb shell pm enable com.amazon.spiderpork` |

Not found on the stick: JioHotstar (no package matched "hotstar", "jio", or "star").
Left alone as asked: NetMirror, Brave, Steam Link.
Left alone deliberately: Amazon metrics/telemetry system services (`com.amazon.device.metrics`,
`com.amazon.client.metrics.api`, `com.amazon.wirelessmetrics.service`, `com.amazon.device.telemetry.emitter`).
They are part of Fire OS; disabling them is a risk to updates and the launcher, and the gain is small.

## Second round (same day, at the user's request)

| Change | Package | Undo |
|---|---|---|
| Uninstalled Downloader | com.esaba.downloader | `adb install com.esaba.downloader_base.apk` |
| Uninstalled "TV File Manager" (AnExplorer) | dev.dworks.apps.anexplorer | `adb install dev.dworks.apps.anexplorer_base.apk` |
| Removed YouTube for user 0 (kept data) | com.amazon.firetv.youtube | `adb shell cmd package install-existing com.amazon.firetv.youtube` |

JioHotstar and MX Player are NOT installed packages. They are promoted tiles injected by the Fire TV
launcher, so they cannot be uninstalled; hide them from the Fire TV home settings instead.

## Third round

| Change | Package | Undo |
|---|---|---|
| Disabled Amazon Kids (FreeTime) | com.amazon.tahoe | `adb shell pm enable com.amazon.tahoe` |
| Disabled Amazon Photos | com.amazon.bueller.photos | `adb shell pm enable com.amazon.bueller.photos` |
| Disabled Amazon MX Player TV (miniTV) | com.amazon.minitv.android.app | `adb shell pm enable com.amazon.minitv.android.app` |
| Removed Amazon Music for user 0 | com.amazon.bueller.music | `adb shell cmd package install-existing com.amazon.bueller.music` |
