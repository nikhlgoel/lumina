package com.lumina.tv.data

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.pm.PackageInfoCompat
import com.lumina.tv.core.UpdateLogic
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.security.MessageDigest

/**
 * Keeps the app up to date from this project's GitHub releases, without getting in the way.
 *
 * Checking and downloading happen in the background, off the main thread, and the finished file waits
 * in the cache. Nothing is installed until the person agrees: Android asks for its own confirmation on
 * a TV (an app that is not the system cannot update itself silently), and that is the "restart to
 * apply" moment. An update downloaded in a previous run is offered again the next time the app opens.
 *
 * What stops a bad file reaching the installer, in order: it must come from this repository's release
 * downloads over HTTPS (UpdateLogic), match the advertised size and SHA-256 when GitHub gives one, and
 * be an APK for *this* package with a higher version code. Android then refuses it unless it is signed
 * with the same key as the installed app, which is the check that cannot be faked.
 */
class Updater(
    private val context: Context,
    private val http: OkHttpClient,
    private val prefs: SharedPreferences,
    private val currentVersion: String,
    private val now: () -> Long = System::currentTimeMillis,
) {
    sealed interface State {
        data object Idle : State
        data object Checking : State
        data class UpToDate(val checkedAtMs: Long) : State
        data class Downloading(val version: String, val fraction: Float) : State
        data class Ready(val version: String, val notes: String) : State
        data class Failed(val message: String) : State
    }

    enum class InstallStart { Started, NeedsPermission, NotReady }

    private val _state = MutableStateFlow<State>(State.Idle)
    val state: StateFlow<State> = _state.asStateFlow()

    private val lock = Mutex()
    private val dir get() = File(context.cacheDir, "updates")

    /** Pick up an update that an earlier run already downloaded, so it can be offered again on opening the app. */
    fun restoreStaged() {
        val version = prefs.getString(KEY_STAGED_VERSION, null) ?: return
        val file = stagedFile(version)
        if (file.isFile && UpdateLogic.compare(version, currentVersion) > 0 && isThisApp(file, version)) {
            _state.value = State.Ready(version, prefs.getString(KEY_STAGED_NOTES, "").orEmpty())
        } else {
            clearStaged()
        }
    }

    /** The reason the last install attempt failed, if it did; shown once. */
    fun takeInstallError(): String? = prefs.getString(KEY_INSTALL_ERROR, null)?.also { prefs.edit().remove(KEY_INSTALL_ERROR).apply() }

    suspend fun check(force: Boolean) = lock.withLock {
        if (_state.value is State.Ready) return@withLock
        if (!force && !UpdateLogic.isDue(prefs.getLong(KEY_LAST_CHECK, 0), now())) return@withLock
        _state.value = State.Checking
        try {
            val candidate = withContext(Dispatchers.IO) { fetchCandidate() }
            prefs.edit().putLong(KEY_LAST_CHECK, now()).apply()
            if (candidate == null) {
                _state.value = State.UpToDate(now())
                return@withLock
            }
            withContext(Dispatchers.IO) { download(candidate) }
            _state.value = State.Ready(candidate.version, candidate.notes)
        } catch (e: IOException) {
            // Offline, or GitHub being slow: quiet, and tried again at the next scheduled check.
            _state.value = if (force) State.Failed(e.message ?: "Couldn't reach GitHub.") else State.Idle
        }
    }

    private fun fetchCandidate(): UpdateLogic.Candidate? {
        val request = Request.Builder()
            .url("https://api.github.com/repos/${UpdateLogic.REPO}/releases?per_page=15")
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "Lumina-TV/$currentVersion")
            .build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IOException("GitHub answered ${response.code}.")
            return UpdateLogic.pick(response.body?.string().orEmpty(), currentVersion)
        }
    }

    private fun download(candidate: UpdateLogic.Candidate) {
        val target = stagedFile(candidate.version)
        if (target.isFile && isThisApp(target, candidate.version)) {
            stage(candidate)
            return
        }
        dir.mkdirs()
        // Three times the size: the download, plus room for the installer's own copy.
        if (dir.usableSpace < candidate.sizeBytes * 3) throw IOException("Not enough free space for the update.")
        dir.listFiles()?.forEach { it.delete() }

        val part = File(dir, target.name + ".part")
        val digest = MessageDigest.getInstance("SHA-256")
        val request = Request.Builder().url(candidate.apkUrl).header("User-Agent", "Lumina-TV/$currentVersion").build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IOException("The download answered ${response.code}.")
            val body = response.body ?: throw IOException("The download was empty.")
            var done = 0L
            part.outputStream().use { out ->
                body.byteStream().use { input ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        if (done + n > UpdateLogic.MAX_APK_BYTES) throw IOException("The download is larger than expected.")
                        out.write(buffer, 0, n)
                        digest.update(buffer, 0, n)
                        done += n
                        _state.value = State.Downloading(candidate.version, (done.toFloat() / candidate.sizeBytes).coerceIn(0f, 1f))
                    }
                }
            }
            if (done != candidate.sizeBytes) throw IOException("The download was incomplete.")
        }
        val actual = digest.digest().joinToString("") { "%02x".format(it) }
        if (candidate.sha256 != null && candidate.sha256 != actual) {
            part.delete()
            throw IOException("The download did not match its checksum, so it was discarded.")
        }
        if (!part.renameTo(target)) throw IOException("Couldn't save the update.")
        if (!isThisApp(target, candidate.version)) {
            target.delete()
            throw IOException("The file is not an update for Lumina, so it was discarded.")
        }
        stage(candidate)
    }

    private fun stage(candidate: UpdateLogic.Candidate) {
        prefs.edit().putString(KEY_STAGED_VERSION, candidate.version).putString(KEY_STAGED_NOTES, candidate.notes).apply()
    }

    private fun clearStaged() {
        prefs.edit().remove(KEY_STAGED_VERSION).remove(KEY_STAGED_NOTES).apply()
        dir.listFiles()?.forEach { it.delete() }
    }

    private fun stagedFile(version: String) = File(dir, "lumina-tv-$version.apk")

    /** True when the file is an APK for this very package, newer than what is installed. */
    private fun isThisApp(file: File, version: String): Boolean {
        val info = context.packageManager.getPackageArchiveInfo(file.path, 0) ?: return false
        val installed = context.packageManager.getPackageInfo(context.packageName, 0)
        return info.packageName == context.packageName &&
            PackageInfoCompat.getLongVersionCode(info) > PackageInfoCompat.getLongVersionCode(installed) &&
            UpdateLogic.compare(version, currentVersion) > 0
    }

    fun canInstall(): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()

    /**
     * Hands the downloaded file to Android's installer. Android shows its own "Update this app?" screen,
     * and restarts the app when done. Without the "install unknown apps" permission for Lumina it opens
     * that settings page instead, once, and the person comes back and tries again.
     */
    fun install(): InstallStart {
        val ready = _state.value as? State.Ready ?: return InstallStart.NotReady
        val file = stagedFile(ready.version)
        if (!file.isFile) return InstallStart.NotReady
        if (!canInstall()) {
            val settings = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                context.startActivity(settings)
            } catch (e: Exception) {
                prefs.edit().putString(KEY_INSTALL_ERROR, "Allow Lumina to install apps: Settings → My Fire TV → Developer options → Install unknown apps.").apply()
            }
            return InstallStart.NeedsPermission
        }
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply { setAppPackageName(context.packageName) }
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            file.inputStream().use { input -> session.openWrite("lumina-tv.apk", 0, file.length()).use { out -> input.copyTo(out); session.fsync(out) } }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
            val callback = PendingIntent.getBroadcast(context, id, Intent(context, InstallResultReceiver::class.java).setAction(InstallResultReceiver.ACTION), flags)
            session.commit(callback.intentSender)
        }
        return InstallStart.Started
    }

    companion object {
        const val PREFS = "updater"
        const val KEY_INSTALL_ERROR = "install_error"
        private const val KEY_LAST_CHECK = "last_check"
        private const val KEY_STAGED_VERSION = "staged_version"
        private const val KEY_STAGED_NOTES = "staged_notes"
    }
}

/** Receives the installer's verdict: shows Android's confirmation screen, and records a failure so the app can say why. */
class InstallResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
                confirm?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)?.let(context::startActivity)
            }
            PackageInstaller.STATUS_SUCCESS -> Unit // the app is replaced and restarted by the system
            else -> {
                val why = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE).orEmpty()
                context.getSharedPreferences(Updater.PREFS, Context.MODE_PRIVATE).edit()
                    .putString(Updater.KEY_INSTALL_ERROR, "The update didn't install ($status). $why".trim()).apply()
            }
        }
    }

    companion object {
        const val ACTION = "com.lumina.tv.INSTALL_RESULT"
    }
}
