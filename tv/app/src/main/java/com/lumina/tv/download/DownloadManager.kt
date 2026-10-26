package com.lumina.tv.download

import android.content.Context
import android.os.StatFs
import android.util.Log
import com.lumina.tv.core.ArtworkUrl
import com.lumina.tv.core.Formatting
import com.lumina.tv.core.StreamPicker
import com.lumina.tv.data.AppSettings
import com.lumina.tv.data.LibraryItem
import com.lumina.tv.data.LibraryStore
import com.lumina.tv.data.MediaKind
import com.lumina.tv.data.NewPipeDownloader
import com.lumina.tv.data.ResolvedMedia
import com.lumina.tv.data.Storage
import com.lumina.tv.data.StreamRepo
import com.lumina.tv.data.Track
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import okhttp3.OkHttpClient
import okhttp3.Request
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException
import java.io.File
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.ConcurrentHashMap

/**
 * The download queue. Two items download at once: on this hardware more only makes each slower, and
 * measuring the PC app showed extra connections buy no speed on a line that is already the limit.
 *
 * What a download does, in order: resolve the page into streams, pick the best one (never
 * re-encoding), check the drive has room, fetch it in resumable chunks, file it under the PC app's
 * naming, grab the thumbnail, add it to the library.
 */
class DownloadManager(
    private val context: Context,
    private val repo: StreamRepo,
    private val storage: Storage,
    private val library: LibraryStore,
    private val settings: AppSettings,
    private val http: OkHttpClient,
) {
    enum class State { QUEUED, RESOLVING, DOWNLOADING, PROCESSING, DONE, FAILED, CANCELLED }
    enum class Outcome { QUEUED, ALREADY_DOWNLOADED, ALREADY_QUEUED }

    data class DownloadJob(
        val key: String,
        val track: Track,
        val kind: MediaKind,
        val state: State = State.QUEUED,
        val downloaded: Long = 0,
        val total: Long = 0,
        val speedBps: Long = 0,
        val message: String? = null,
    ) {
        val active: Boolean get() = state == State.QUEUED || state == State.RESOLVING || state == State.DOWNLOADING || state == State.PROCESSING
        val fraction: Float get() = if (total > 0) (downloaded.toFloat() / total).coerceIn(0f, 1f) else 0f
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val gate = Semaphore(MAX_PARALLEL)
    private val state = MutableStateFlow<List<DownloadJob>>(emptyList())
    val jobs: StateFlow<List<DownloadJob>> = state.asStateFlow()

    private val running = ConcurrentHashMap<String, Job>()

    /** The unfinished `.part` files of each job, so a cancel can clean up and a failure can leave them for a resume. */
    private val partials = ConcurrentHashMap<String, List<File>>()
    private val downloader = ChunkedDownloader(http, NewPipeDownloader.USER_AGENT)

    /** Add something to download. Saying "already have it" beats quietly downloading it twice. */
    fun enqueue(track: Track, kind: MediaKind = track.kind): Outcome {
        val key = "${track.id}:${kind.name}"
        if (library.items.value.any { Track.idFromUrl(it.sourceUrl) == track.id && it.kind == kind }) return Outcome.ALREADY_DOWNLOADED
        if (state.value.firstOrNull { it.key == key }?.active == true) return Outcome.ALREADY_QUEUED
        state.update { list -> list.filter { it.key != key } + DownloadJob(key, track, kind) }
        launch(key)
        return Outcome.QUEUED
    }

    fun cancel(key: String) {
        running[key]?.cancel()
        partials.remove(key)?.forEach { it.delete() }
        update(key) { if (it.active) it.copy(state = State.CANCELLED, speedBps = 0, message = null) else it }
    }

    fun retry(key: String) {
        val job = state.value.firstOrNull { it.key == key } ?: return
        if (job.active) return
        update(key) { it.copy(state = State.QUEUED, message = null, downloaded = 0, total = 0, speedBps = 0) }
        launch(key)
    }

    fun clearFinished() = state.update { list -> list.filter { it.active } }

    private fun launch(key: String) {
        DownloadService.start(context)
        val job = scope.launch { process(key) }
        running[key] = job
        job.invokeOnCompletion { running.remove(key, job) }
    }

    private suspend fun process(key: String) = gate.withPermit {
        val job = state.value.firstOrNull { it.key == key } ?: return@withPermit
        if (job.state == State.CANCELLED) return@withPermit
        try {
            update(key) { it.copy(state = State.RESOLVING, message = null, downloaded = 0, total = 0) }
            var saved: LibraryItem? = null
            var attempt = 0
            while (saved == null) {
                try {
                    val media = repo.resolve(job.track, fresh = true)
                    if (media.isLive) throw UserMessage("A live stream can't be saved.")
                    saved = if (job.kind == MediaKind.AUDIO) saveAudio(key, media) else saveVideo(key, media)
                } catch (e: UrlExpiredException) {
                    // The link died between being resolved and being fetched: resolve again, once.
                    if (++attempt >= 2) throw e
                }
            }
            library.add(saved)
            partials.remove(key)
            update(key) { it.copy(state = State.DONE, downloaded = maxOf(it.total, it.downloaded), speedBps = 0, message = null) }
        } catch (e: CancellationException) {
            update(key) { if (it.state == State.DONE) it else it.copy(state = State.CANCELLED, speedBps = 0) }
            throw e
        } catch (e: Throwable) {
            Log.w(TAG, "Download failed: ${job.track.title}", e)
            // Partial files are kept: pressing Retry carries on from where it stopped.
            update(key) { it.copy(state = State.FAILED, speedBps = 0, message = humanize(e)) }
        }
    }

    private suspend fun saveAudio(key: String, media: ResolvedMedia): LibraryItem {
        val audio = StreamPicker.bestAudio(media.audio) ?: throw UserMessage("No audio was found for this item.")
        val root = storage.activeRoot()
        val dest = storage.destinationFor(MediaKind.AUDIO, media.track.title, media.track.artist, audio.ext, root)
        partials[key] = listOf(File(dest.path + ".part"))

        update(key) { it.copy(state = State.DOWNLOADING) }
        val meter = Meter(key, base = 0, totalAll = 0)
        downloader.download(audio.url, dest, onTotalKnown = { ensureSpace(root, it); meter.setTotal(it) }, onProgress = meter::progress)
        return finish(media.track, MediaKind.AUDIO, dest)
    }

    private suspend fun saveVideo(key: String, media: ResolvedMedia): LibraryItem {
        val limit = settings.downloadHeight
        val separate = StreamPicker.bestVideo(media.video, limit, needsAudioStream = true)
        val muxed = StreamPicker.bestVideo(media.video.filter { it.hasAudio }, limit)
        val root = storage.activeRoot()

        // A separate video stream is worth the extra work only when it is actually sharper than what
        // a ready-made file offers, and only when this device's muxer can sew it to a matching sound.
        val plan = if (separate != null && (muxed == null || separate.height > muxed.height)) planMux(separate, media) else null

        if (plan == null) {
            val direct = muxed ?: throw UserMessage("No video at ${limit}p or lower was found. Raise the download quality in Settings.")
            val dest = storage.destinationFor(MediaKind.VIDEO, media.track.title, media.track.artist, direct.ext, root)
            partials[key] = listOf(File(dest.path + ".part"))
            update(key) { it.copy(state = State.DOWNLOADING) }
            val meter = Meter(key, base = 0, totalAll = 0)
            downloader.download(direct.url, dest, onTotalKnown = { ensureSpace(root, it); meter.setTotal(it) }, onProgress = meter::progress)
            return finish(media.track, MediaKind.VIDEO, dest)
        }

        val dest = storage.destinationFor(MediaKind.VIDEO, media.track.title, media.track.artist, plan.container.extension, root)
        val videoTmp = File(dest.path + ".v")
        val audioTmp = File(dest.path + ".a")
        val joined = File(dest.path + ".part")
        partials[key] = listOf(File(videoTmp.path + ".part"), File(audioTmp.path + ".part"), videoTmp, audioTmp, joined)

        try {
            update(key) { it.copy(state = State.DOWNLOADING) }
            val videoLen = downloader.probeLength(plan.video.url).coerceAtLeast(0)
            val audioLen = downloader.probeLength(plan.audio.url).coerceAtLeast(0)
            // Both files and the joined result exist at once, so the drive needs room for about twice the download.
            ensureSpace(root, (videoLen + audioLen) * 2)
            val all = videoLen + audioLen

            val audioMeter = Meter(key, base = 0, totalAll = all)
            downloader.download(plan.audio.url, audioTmp, onTotalKnown = {}, onProgress = audioMeter::progress)
            val videoMeter = Meter(key, base = audioLen, totalAll = all)
            downloader.download(plan.video.url, videoTmp, onTotalKnown = {}, onProgress = videoMeter::progress)

            update(key) { it.copy(state = State.PROCESSING, speedBps = 0, downloaded = it.total) }
            Muxer.mux(videoTmp, audioTmp, joined, plan.container)
            if (dest.exists()) dest.delete()
            if (!joined.renameTo(dest)) throw IOException("Could not finish the video file")
        } finally {
            videoTmp.delete(); audioTmp.delete()
            File(videoTmp.path + ".part").takeIf { dest.exists() }?.delete()
            File(audioTmp.path + ".part").takeIf { dest.exists() }?.delete()
            if (dest.exists()) joined.delete()
        }
        return finish(media.track, MediaKind.VIDEO, dest)
    }

    private class MuxPlan(val video: StreamPicker.VideoOption, val audio: StreamPicker.AudioOption, val container: Muxer.Container)

    private fun planMux(video: StreamPicker.VideoOption, media: ResolvedMedia): MuxPlan? {
        val h264 = video.codec == StreamPicker.VideoCodec.H264
        val vp9 = video.codec == StreamPicker.VideoCodec.VP9
        val aac = media.audio.filter { it.format == StreamPicker.AudioFormat.M4A }
        val opus = media.audio.filter { it.format == StreamPicker.AudioFormat.OPUS }
        val container = Muxer.supports(h264, vp9, aac.isNotEmpty(), opus.isNotEmpty()) ?: return null
        val audio = StreamPicker.bestAudio(if (container == Muxer.Container.MP4) aac else opus) ?: return null
        return MuxPlan(video, audio, container)
    }

    /** Refuse early, with a message that says what to do, rather than fail at 90% on a full drive. */
    private fun ensureSpace(root: Storage.Root, needed: Long) {
        if (needed <= 0) return
        val free = runCatching { StatFs(root.dir.path).availableBytes }.getOrDefault(Long.MAX_VALUE)
        if (free < needed + SPACE_MARGIN) {
            throw UserMessage(
                "Not enough space on ${root.label}: this needs ${Formatting.bytes(needed)} and ${Formatting.bytes(free)} is free. " +
                    "Pick a USB drive in Settings, or delete something from the Library.",
            )
        }
    }

    private suspend fun finish(track: Track, kind: MediaKind, dest: File): LibraryItem {
        // The big version: this file is what the full-screen player shows later, with no network to fetch a better one.
        val thumb = saveThumbnail(ArtworkUrl.large(track.thumbnailUrl), File(dest.parentFile, dest.nameWithoutExtension + ".jpg"))
        return LibraryItem(
            id = "${track.id}-${if (kind == MediaKind.AUDIO) "a" else "v"}",
            kind = kind,
            title = track.title,
            artist = track.artist,
            durationSec = track.durationSec,
            path = dest.path,
            thumbPath = thumb?.path,
            sourceUrl = track.url,
            sizeBytes = dest.length(),
            addedAt = System.currentTimeMillis(),
        )
    }

    /** Best effort: a missing thumbnail must never fail a download that otherwise worked. */
    private fun saveThumbnail(url: String?, into: File): File? {
        if (url.isNullOrBlank()) return null
        return try {
            http.newCall(Request.Builder().url(url).header("User-Agent", NewPipeDownloader.USER_AGENT).build()).execute().use { response ->
                val body = response.body ?: return null
                if (!response.isSuccessful || body.contentLength() > MAX_THUMB) return null
                into.outputStream().use { out -> body.byteStream().copyTo(out) }
                into.takeIf { it.length() > 0 }
            }
        } catch (e: IOException) {
            into.delete()
            null
        }
    }

    private fun humanize(e: Throwable): String = when (e) {
        is UserMessage -> e.message.orEmpty()
        is UnknownHostException, is ConnectException, is SocketTimeoutException -> "No internet connection. Check Wi-Fi, then press Retry."
        is ReCaptchaException -> "YouTube asked for a human check. Try again in a little while."
        is UrlExpiredException -> "The link expired before it could be fetched. Press Retry."
        is IOException -> "The transfer was interrupted (${e.message ?: "network error"}). Press Retry to continue."
        else -> e.message?.takeIf { it.isNotBlank() } ?: "Download failed."
    }

    private fun update(key: String, change: (DownloadJob) -> DownloadJob) =
        state.update { list -> list.map { if (it.key == key) change(it) else it } }

    /**
     * Turns a stream of byte counts into job updates, at most four a second so the screen is not
     * asked to redraw on every 64 KB, and works out speed over the last second or so.
     */
    private inner class Meter(private val key: String, private val base: Long, private var totalAll: Long) {
        private var lastEmit = 0L
        private var lastBytes = base
        private var lastSpeedAt = System.nanoTime()
        private var speed = 0L

        fun setTotal(total: Long) { if (totalAll <= 0) totalAll = total }

        fun progress(done: Long, total: Long) {
            val now = System.nanoTime()
            val elapsedMs = (now - lastEmit) / 1_000_000
            val finished = total > 0 && done >= total
            if (elapsedMs < EMIT_MS && !finished) return
            lastEmit = now
            val bytes = base + done
            val windowNs = now - lastSpeedAt
            if (windowNs >= 1_000_000_000L) {
                speed = ((bytes - lastBytes) * 1_000_000_000L) / windowNs
                lastBytes = bytes
                lastSpeedAt = now
            }
            update(key) { it.copy(downloaded = bytes, total = if (totalAll > 0) totalAll else maxOf(total, 0), speedBps = speed) }
        }
    }

    companion object {
        private const val TAG = "Downloads"
        private const val MAX_PARALLEL = 2
        private const val EMIT_MS = 250L
        private const val SPACE_MARGIN = 50L * 1024 * 1024
        private const val MAX_THUMB = 4L * 1024 * 1024
    }
}
