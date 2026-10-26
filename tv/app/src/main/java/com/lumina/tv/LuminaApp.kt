package com.lumina.tv

import android.app.Application
import android.content.ComponentName
import android.content.Context
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.lumina.tv.core.MemoryPlan
import com.lumina.tv.data.AccountPlaylistFetcher
import com.lumina.tv.data.AccountPlaylistsRepo
import org.schabi.newpipe.extractor.localization.ContentCountry
import com.lumina.tv.data.AppSettings
import com.lumina.tv.data.GoogleAuth
import com.lumina.tv.data.LibraryStore
import com.lumina.tv.data.MediaKind
import com.lumina.tv.data.NewPipeDownloader
import com.lumina.tv.data.PhoneSetupServer
import com.lumina.tv.data.PlaylistStore
import com.lumina.tv.data.PlaylistSync
import com.lumina.tv.data.PlaylistTracksCache
import com.lumina.tv.data.PublicPlaylistFetcher
import com.lumina.tv.data.LyricsRepo
import com.lumina.tv.data.Recommendations
import com.lumina.tv.data.Taste
import com.lumina.tv.data.Storage
import com.lumina.tv.data.StreamRepo
import com.lumina.tv.data.SyncWorker
import com.lumina.tv.data.UpdateWorker
import com.lumina.tv.data.Updater
import com.lumina.tv.data.YouTubeApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import com.lumina.tv.download.DownloadManager
import com.lumina.tv.player.PlaybackController
import com.lumina.tv.player.PlaybackService
import com.lumina.tv.player.PlayerHolder
import okhttp3.OkHttpClient
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.localization.Localization
import java.io.File
import java.util.concurrent.TimeUnit

class LuminaApp : Application(), coil.ImageLoaderFactory {
    lateinit var graph: Graph
        private set

    /** Memory caps for this device (see [MemoryPlan]): a 1 GB stick holds less in memory, and loads again what it dropped. */
    val memoryPlan: MemoryPlan by lazy {
        val am = getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
        val info = android.app.ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
        MemoryPlan.forDevice((info.totalMem / (1024 * 1024)).toInt(), am.memoryClass, am.isLowRamDevice)
    }

    /**
     * The one picture loader every screen shares, so there is one picture cache and one connection pool (a loader made on
     * the spot, as the colour finder used to, brings its own of each). Pictures are decoded at the size they are shown, at full
     * quality; only how many stay in memory depends on the device. Covers from YouTube's servers change rarely and their
     * cache headers are short, so the disk copy is kept regardless.
     */
    override fun newImageLoader(): coil.ImageLoader = coil.ImageLoader.Builder(this)
        .callFactory { graph.http }
        .memoryCache { coil.memory.MemoryCache.Builder(this).maxSizePercent(memoryPlan.imageCachePercent).build() }
        .diskCache { coil.disk.DiskCache.Builder().directory(File(cacheDir, "images")).maxSizeBytes(96L * 1024 * 1024).build() }
        .respectCacheHeaders(false)
        .build()

    /** The system is short of memory: pictures are the one thing that can be given back at no cost (they load again). */
    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        if (level >= TRIM_MEMORY_RUNNING_LOW) coil.Coil.imageLoader(this).memoryCache?.clear()
    }

    override fun onCreate() {
        super.onCreate()
        graph = Graph(this)
        // Connecting a controller is what starts the media service and lets it show its notification
        // and answer the remote's media keys. The reference is kept so it is not released.
        val token = SessionToken(this, ComponentName(this, PlaybackService::class.java))
        graph.controllerFuture = MediaController.Builder(this, token).buildAsync()

        // Playlists: load them, then sync what is due a little after start-up (not during it, so the first
        // screen is never waiting on the network), and make sure the background schedule exists.
        graph.appScope.launch {
            graph.library.load()
            graph.playlistStore.load()
            delay(STARTUP_SYNC_DELAY_MS)
            runCatching { graph.playlists.syncAll() }
        }
        // Let the extractor learn YouTube's player script now, in the background and at low priority, so the first thing
        // played in a session does not pay for it.
        graph.appScope.launch {
            delay(WARM_UP_DELAY_MS)
            graph.repo.warmUp()
        }
        SyncWorker.schedule(this)

        // Updates: an earlier download is offered again at once (that is "next time I open the app"); a new
        // check waits until the app has settled, and runs on its own thread, so start-up never waits on it.
        graph.appScope.launch {
            graph.updater.restoreStaged()
            delay(UPDATE_CHECK_DELAY_MS)
            runCatching { graph.updater.check(force = false) }
        }
        UpdateWorker.schedule(this)
    }

    private companion object {
        const val WARM_UP_DELAY_MS = 6_000L
        const val STARTUP_SYNC_DELAY_MS = 20_000L
        const val UPDATE_CHECK_DELAY_MS = 45_000L
    }
}

/**
 * The app's long-lived objects, created once. A plain holder rather than a dependency-injection
 * framework: there are a handful of them, and every dependency is visible in one place.
 */
class Graph(app: Application) {
    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    val settings = AppSettings(app)
    val storage = Storage(app, settings)
    val library = LibraryStore(File(app.filesDir, "library.json"))
    val repo: StreamRepo
    val downloads: DownloadManager
    val player: PlaybackController

    val google = GoogleAuth(http, app.getSharedPreferences("google", Context.MODE_PRIVATE))
    val youtube = YouTubeApi(http, google)
    val playlistStore = PlaylistStore(File(app.filesDir, "playlists.json"))
    val playlists: PlaylistSync
    val phoneSetup: PhoneSetupServer
    val recommendations: Recommendations
    val discover: com.lumina.tv.data.Discover
    val taste = Taste(app.getSharedPreferences(Taste.PREFS, Context.MODE_PRIVATE))
    val history = com.lumina.tv.data.History(app.getSharedPreferences(com.lumina.tv.data.History.PREFS, Context.MODE_PRIVATE))
    val accountPlaylists = AccountPlaylistsRepo(youtube, app.getSharedPreferences("playlist_kinds", Context.MODE_PRIVATE)) { google.signedIn }
    // Every lyrics lookup is written to <external files>/lyrics-matches.log (`adb pull` reads it, release build included), so a
    // wrong match can be diagnosed from the log instead of from a photograph of the screen.
    val lyrics = LyricsRepo(
        http, com.lumina.tv.data.LyricsTranslator(http, File(app.cacheDir, "lyrics-translation")),
        com.lumina.tv.data.LyricsLog(File(app.getExternalFilesDir(null) ?: app.filesDir, "lyrics-matches.log")),
    )
    val updater = Updater(app, http, app.getSharedPreferences(Updater.PREFS, Context.MODE_PRIVATE), BuildConfig.VERSION_NAME)

    /** For work that must outlive a screen: loading at start-up, syncing, adding a playlist. */
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    var controllerFuture: Any? = null

    init {
        // Order matters: the extractor must be initialised before any search, and the player holder
        // before anything that touches the player.
        NewPipe.init(NewPipeDownloader(http), Localization("en", settings.contentCountry), ContentCountry(settings.contentCountry))
        PlayerHolder.init(app, http)
        repo = StreamRepo()
        recommendations = Recommendations(repo, blocks = taste::blocks)
        discover = com.lumina.tv.data.Discover(repo, http)
        downloads = DownloadManager(app, repo, storage, library, settings, http)
        player = PlaybackController(app, repo, settings)
        playlists = PlaylistSync(playlistStore, library, downloads, PublicPlaylistFetcher(), AccountPlaylistFetcher(youtube), settings, cache = PlaylistTracksCache(File(app.filesDir, "playlist-tracks")))

        phoneSetup = PhoneSetupServer(
            object : PhoneSetupServer.Actions {
                override suspend fun addPlaylist(link: String, alsoDownload: Boolean): String =
                    when (val r = playlists.addFromLink(link, MediaKind.AUDIO, alsoDownload, storage.activeRoot().freeBytes)) {
                        is PlaylistSync.AddOutcome.Added -> r.message
                        is PlaylistSync.AddOutcome.Refused -> r.message
                    }

                override fun saveGoogle(clientId: String, clientSecret: String): String {
                    val id = clientId.trim()
                    val secret = clientSecret.trim()
                    // A real one always ends this way; catching a pasted-wrong-thing here saves a confusing failure later.
                    if (!id.endsWith(".apps.googleusercontent.com")) return "That doesn't look like a Client ID. It ends with .apps.googleusercontent.com."
                    if (secret.length < 10) return "That secret looks too short. Copy the whole thing."
                    google.credentials = GoogleAuth.Credentials(id, secret)
                    return "Saved. On the TV, open Playlists and choose Sign in with YouTube."
                }

                override fun googleConfigured(): Boolean = google.credentials != null
            },
        )
    }
}
