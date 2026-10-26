package com.lumina.tv.player

import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.util.Log
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.MergingMediaSource
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.exoplayer.source.SingleSampleMediaSource
import com.lumina.tv.core.PlaybackSpeed
import com.lumina.tv.core.StreamPicker
import com.lumina.tv.core.SubtitleOption
import com.lumina.tv.core.SubtitleRules
import com.lumina.tv.data.AppSettings
import com.lumina.tv.data.LibraryItem
import com.lumina.tv.data.MediaKind
import com.lumina.tv.data.ResolvedMedia
import com.lumina.tv.data.StreamRepo
import com.lumina.tv.data.Track
import com.lumina.tv.download.UserMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException
import java.io.File
import java.net.UnknownHostException

/**
 * What the screens talk to for playback. It owns the decisions the player itself does not make:
 * resolving a search result into a stream, choosing a quality, falling back to a lower one when the
 * device cannot decode what was chosen, and recovering when a stream link expires mid-play.
 */
class PlaybackController(
    private val context: Context,
    private val repo: StreamRepo,
    private val settings: AppSettings,
) {
    data class Quality(val label: String, val option: StreamPicker.VideoOption)

    /** What is playing, for the screens. Position and play state come straight from the player. */
    data class Now(
        val id: String,
        val title: String,
        val artist: String,
        val thumbnail: String?,
        val kind: MediaKind,
        val streaming: Boolean,
        val qualities: List<Quality> = emptyList(),
        val qualityIndex: Int = -1,
        /** The video's sound tracks (languages) by name and which one is playing; one entry means nothing to choose. */
        val audioTracks: List<String> = emptyList(),
        val audioIndex: Int = 0,
        /** The caption tracks on offer, in menu order, and which one is showing (-1 = captions off). */
        val subtitles: List<String> = emptyList(),
        val subtitleIndex: Int = -1,
        /** The page this came from, when streaming — what lets "Download" work from the player. */
        val sourceUrl: String? = null,
    ) {
        val hasSubtitles: Boolean get() = subtitles.isNotEmpty()
    }

    /** Live numbers for the "Stats for nerds" panel. */
    data class Stats(
        val resolution: String,
        val videoCodec: String,
        val videoKbps: Int,
        val frameRate: String,
        val audioCodec: String,
        val audioKbps: Int,
        val sampleRate: Int,
        val droppedFrames: Int,
        val bufferAheadSec: Long,
        val speed: Float,
        val source: String,
    )

    private val scope = MainScope()
    val player: ExoPlayer get() = PlayerHolder.player

    private val nowState = MutableStateFlow<Now?>(null)
    val now: StateFlow<Now?> = nowState.asStateFlow()

    private val loadingState = MutableStateFlow(false)
    val loading: StateFlow<Boolean> = loadingState.asStateFlow()

    private val errorState = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = errorState.asStateFlow()

    private val speedState = MutableStateFlow(1f)
    val speed: StateFlow<Float> = speedState.asStateFlow()

    /** The audio track the person picked for this video (null = the original language); kept across quality changes. */
    private var chosenAudioId: String? = null

    /** The caption track in use, as (language, auto-generated); null = off. Starts from the language last chosen. */
    private var subtitleChoice: Pair<String, Boolean>? = null
    private var subtitleOptions: List<SubtitleOption> = emptyList()

    /** The streamed songs lined up after the one playing (a tapped recommendation plays the rest of its row). */
    data class StreamQueue(val tracks: List<Track>, val index: Int) {
        val hasNext get() = index in 0 until tracks.lastIndex
        val hasPrevious get() = index > 0
    }

    private val queueState = MutableStateFlow(StreamQueue(emptyList(), -1))
    val streamQueue: StateFlow<StreamQueue> = queueState.asStateFlow()

    private var streamJob: Job? = null
    private var resolved: ResolvedMedia? = null
    private var dropped = 0
    private var retriedExpiredLink = false

    init {
        player.addAnalyticsListener(object : AnalyticsListener {
            override fun onDroppedVideoFrames(eventTime: AnalyticsListener.EventTime, droppedFrames: Int, elapsedMs: Long) {
                dropped += droppedFrames
            }
        })
        player.addListener(object : Player.Listener {
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                if (mediaItem == null) return
                // A queue of saved files moves on by itself; keep the screens in step with it. A
                // stream sets its own state when it starts, so it is left alone here.
                if (mediaItem.mediaMetadata.extras?.getBoolean(EXTRA_STREAM) != true) nowState.value = fromLocal(mediaItem)
            }

            override fun onPlaybackStateChanged(state: Int) {
                // A streamed song that finishes hands over to the next one in its queue, as a library queue does by itself.
                if (state == Player.STATE_ENDED && nowState.value?.streaming == true && queueState.value.hasNext) nextStream()
            }

            // The caption tracks only exist as selectable groups once the player has prepared them.
            override fun onTracksChanged(tracks: androidx.media3.common.Tracks) = applySubtitleSelection()

            override fun onPlayerError(error: PlaybackException) {
                Log.w(TAG, "Player error ${error.errorCodeName}", error)
                handlePlayerError(error)
            }
        })
        player.playbackParameters = PlaybackParameters(1f, 1f)
    }

    // ---- Saved files ----------------------------------------------------------------------

    fun playLibrary(items: List<LibraryItem>, startIndex: Int) {
        if (items.isEmpty()) return
        streamJob?.cancel()
        queueState.value = StreamQueue(emptyList(), -1)
        resolved = null
        errorState.value = null
        loadingState.value = false
        val start = startIndex.coerceIn(0, items.lastIndex)
        player.setAudioAttributes(PlayerHolder.attributes(video = items[start].kind == MediaKind.VIDEO), true)
        player.setMediaItems(items.map { it.toMediaItem() }, start, 0)
        player.prepare()
        player.playWhenReady = true
        nowState.value = fromLocal(player.getMediaItemAt(start))
    }

    private fun LibraryItem.toMediaItem(): MediaItem = MediaItem.Builder()
        .setMediaId(id)
        .setUri(Uri.fromFile(File(path)))
        .setMediaMetadata(
            MediaMetadata.Builder()
                .setTitle(title)
                .setArtist(artist.ifBlank { null })
                .setArtworkUri(thumbPath?.let { Uri.fromFile(File(it)) })
                .setExtras(Bundle().apply {
                    putString(EXTRA_KIND, kind.name)
                    putString(EXTRA_THUMB, thumbPath)
                })
                .build(),
        )
        .build()

    private fun fromLocal(item: MediaItem): Now {
        val meta = item.mediaMetadata
        val kind = runCatching { MediaKind.valueOf(meta.extras?.getString(EXTRA_KIND).orEmpty()) }.getOrDefault(MediaKind.AUDIO)
        return Now(
            id = item.mediaId,
            title = meta.title?.toString().orEmpty(),
            artist = meta.artist?.toString().orEmpty(),
            thumbnail = meta.extras?.getString(EXTRA_THUMB)?.let { Uri.fromFile(File(it)).toString() },
            kind = kind,
            streaming = false,
        )
    }

    // ---- Streaming ------------------------------------------------------------------------

    /** Play one result straight from the web, without saving it. */
    fun playStream(track: Track, startPositionMs: Long = 0) {
        queueState.value = StreamQueue(emptyList(), -1)
        startStream(track, startPositionMs)
    }

    /** Play [tracks] from [index] and carry on through the rest: what tapping a card in a row does. */
    fun playStreamQueue(tracks: List<Track>, index: Int) {
        if (tracks.isEmpty()) return
        val i = index.coerceIn(0, tracks.lastIndex)
        queueState.value = StreamQueue(tracks, i)
        startStream(tracks[i], 0)
    }

    fun nextStream() {
        val q = queueState.value
        if (!q.hasNext) return
        queueState.value = q.copy(index = q.index + 1)
        startStream(q.tracks[q.index + 1], 0)
    }

    fun previousStream() {
        val q = queueState.value
        if (!q.hasPrevious) return
        queueState.value = q.copy(index = q.index - 1)
        startStream(q.tracks[q.index - 1], 0)
    }

    /** Jump to an item of the queue (from the queue list). */
    fun playQueueIndex(index: Int) {
        val q = queueState.value
        if (index !in q.tracks.indices) return
        queueState.value = q.copy(index = index)
        startStream(q.tracks[index], 0)
    }

    /** Next, whatever is playing: the stream queue if there is one, else the saved-files queue. */
    fun next() {
        if (queueState.value.hasNext) nextStream() else if (player.hasNextMediaItem()) player.seekToNextMediaItem()
    }

    /** Previous: the start of this song if it has been playing a few seconds, else the song before. */
    fun previous() {
        if (player.currentPosition > 3000) { player.seekTo(0); return }
        if (queueState.value.hasPrevious) previousStream() else if (player.hasPreviousMediaItem()) player.seekToPreviousMediaItem() else player.seekTo(0)
    }

    fun hasNext(): Boolean = queueState.value.hasNext || player.hasNextMediaItem()

    private fun startStream(track: Track, startPositionMs: Long) {
        streamJob?.cancel()
        errorState.value = null
        loadingState.value = true
        retriedExpiredLink = false
        // Show what is about to play at once, so pressing Play never feels like nothing happened.
        nowState.value = Now(track.id, track.title, track.artist, track.thumbnailUrl, track.kind, streaming = true, sourceUrl = track.url)
        player.stop()
        streamJob = scope.launch {
            try {
                val media = repo.resolve(track, fresh = startPositionMs > 0)
                if (media.isLive) throw UserMessage("Live streams can't be played yet.")
                resolved = media
                if (track.kind == MediaKind.AUDIO) startAudio(media, startPositionMs) else startVideo(media, startPositionMs)
                // The next song of a queue is known, so resolve it now: by the time this one ends (or Next is pressed)
                // it starts at once instead of after a multi-second page fetch on a slow CPU.
                queueState.value.tracks.getOrNull(queueState.value.index + 1)?.let { next -> launch { repo.prewarm(next) } }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                Log.w(TAG, "Could not start ${track.title}", e)
                val queue = queueState.value
                if (queue.hasNext) {
                    // One unavailable song must not stop the music: say so briefly and move on.
                    errorState.value = "Skipped “${track.title}”: ${humanize(e)}"
                    nextStream()
                    return@launch
                }
                nowState.value = null
                errorState.value = humanize(e)
            } finally {
                loadingState.value = false
            }
        }
    }

    private fun startAudio(media: ResolvedMedia, startMs: Long) {
        val audio = StreamPicker.bestAudio(media.audio, settings.audioQuality.maxKbps) ?: throw UserMessage("No audio was found for this item.")
        val item = MediaItem.Builder()
            .setMediaId(media.track.id)
            .setUri(audio.url)
            .setMediaMetadata(metadata(media.track, MediaKind.AUDIO))
            .build()
        player.setAudioAttributes(PlayerHolder.attributes(video = false), true)
        player.setMediaItem(item, startMs)
        player.prepare()
        player.playWhenReady = true
        nowState.value = Now(media.track.id, media.track.title, media.track.artist, media.track.thumbnailUrl, MediaKind.AUDIO, streaming = true, sourceUrl = media.track.url)
    }

    private fun startVideo(media: ResolvedMedia, startMs: Long) {
        // A new video starts in its original language, with captions as the person last left them.
        chosenAudioId = null
        subtitleChoice = settings.subtitleLanguage?.let { it to false }
        val qualities = qualitiesOf(media)
        if (qualities.isEmpty()) throw UserMessage("No playable video was found for this item.")
        // The sharpest picture at or under the chosen limit; the lowest if every one is taller.
        val index = qualities.indexOfFirst { it.option.height <= settings.playHeight }.takeIf { it >= 0 } ?: qualities.lastIndex
        playQuality(media, qualities, index, startMs)
    }

    private fun qualitiesOf(media: ResolvedMedia): List<Quality> {
        // The 8K and 4K tiers are offered but never chosen by default; the stick has 2 GB to decode with.
        val groups = media.video.filter { it.height > 0 }.groupBy { it.height to (if (it.fps > 30) it.fps else 0) }
        return groups.map { (key, options) ->
            val best = StreamPicker.bestVideo(options, key.first) ?: options.first()
            Quality(if (key.second > 0) "${key.first}p${key.second}" else "${key.first}p", best)
        }.sortedWith(compareByDescending<Quality> { it.option.height }.thenByDescending { it.option.fps })
    }

    private fun playQuality(media: ResolvedMedia, qualities: List<Quality>, index: Int, startMs: Long) {
        val tracks = StreamPicker.audioTracks(media.audio, settings.audioQuality.maxKbps)
        val defaultTrack = StreamPicker.defaultAudioTrack(tracks)
        val track = tracks.firstOrNull { it.id == chosenAudioId } ?: defaultTrack
        val otherLanguage = track != null && track != defaultTrack

        // A stream that already carries its sound (picture and sound in one) has only its original language. To hear
        // another, use the same picture size, or the next one down, as a picture-only stream plus the chosen sound.
        var useIndex = index
        if (otherLanguage && qualities[index].option.hasAudio) {
            useIndex = qualities.indices.firstOrNull { it >= index && !qualities[it].option.hasAudio }
                ?: qualities.indices.firstOrNull { !qualities[it].option.hasAudio }
                ?: index
        }
        val option = qualities[useIndex].option
        val meta = metadata(media.track, MediaKind.VIDEO)
        val factory = ProgressiveMediaSource.Factory(PlayerHolder.dataSourceFactory)

        val sources = mutableListOf<MediaSource>(
            factory.createMediaSource(MediaItem.Builder().setMediaId(media.track.id).setUri(option.url).setMediaMetadata(meta).build()),
        )
        if (!option.hasAudio) {
            val audio = track?.best ?: StreamPicker.bestAudio(media.audio, settings.audioQuality.maxKbps) ?: throw UserMessage("This video has no sound track available.")
            sources += factory.createMediaSource(MediaItem.fromUri(audio.url))
        }

        // Every caption track is attached; a track only downloads once it is the one showing.
        val ordered = SubtitleRules.order(media.subtitles, settings.subtitleLanguage)
        subtitleOptions = ordered
        ordered.forEachIndexed { i, sub ->
            val config = MediaItem.SubtitleConfiguration.Builder(Uri.parse(sub.url))
                .setId("sub:$i")
                .setMimeType(sub.mimeType)
                .setLanguage(sub.language)
                .setLabel(sub.label)
                .setSelectionFlags(0)
                .build()
            sources += SingleSampleMediaSource.Factory(PlayerHolder.dataSourceFactory).createMediaSource(config, C.TIME_UNSET)
        }
        val subtitleIndex = subtitleChoice?.let { (language, auto) ->
            val exact = ordered.indexOfFirst { SubtitleRules.sameLanguage(it.language, language) && it.autoGenerated == auto }
            if (exact >= 0) exact else ordered.indexOfFirst { SubtitleRules.sameLanguage(it.language, language) }
        } ?: -1

        player.setAudioAttributes(PlayerHolder.attributes(video = true), true)
        player.setMediaSource(if (sources.size == 1) sources[0] else MergingMediaSource(*sources.toTypedArray()), startMs)
        nowState.value = Now(
            media.track.id, media.track.title, media.track.artist, media.track.thumbnailUrl, MediaKind.VIDEO,
            streaming = true, qualities = qualities, qualityIndex = useIndex,
            audioTracks = tracks.map { it.label }, audioIndex = tracks.indexOf(track).coerceAtLeast(0),
            subtitles = ordered.map { it.label }, subtitleIndex = subtitleIndex,
            sourceUrl = media.track.url,
        )
        applySubtitleSelection()
        player.prepare()
        player.playWhenReady = true
    }

    /** Switch resolution without losing your place. */
    fun setQuality(index: Int) {
        val media = resolved ?: return
        val current = nowState.value ?: return
        if (index !in current.qualities.indices || index == current.qualityIndex) return
        val position = player.currentPosition
        playQuality(media, current.qualities, index, position)
    }

    // ---- Controls -------------------------------------------------------------------------

    fun setSpeed(rate: Float) {
        val clamped = PlaybackSpeed.clamp(rate)
        // Pitch stays at 1: faster speech, not chipmunks.
        player.playbackParameters = PlaybackParameters(clamped, 1f)
        speedState.value = clamped
    }

    fun stepSpeed(direction: Int) = setSpeed(PlaybackSpeed.step(speedState.value, direction))

    /** Show caption track [index] of the menu (see [Now.subtitles]), or turn captions off with -1. Remembered for next time. */
    fun setSubtitle(index: Int) {
        val now = nowState.value ?: return
        val picked = subtitleOptions.getOrNull(index)
        subtitleChoice = picked?.let { it.language to it.autoGenerated }
        settings.subtitleLanguage = picked?.language
        nowState.value = now.copy(subtitleIndex = if (picked != null) index else -1)
        applySubtitleSelection()
    }

    /** Switch the video's sound to another language without losing your place. */
    fun setAudioTrack(index: Int) {
        val media = resolved ?: return
        val current = nowState.value ?: return
        val track = StreamPicker.audioTracks(media.audio, settings.audioQuality.maxKbps).getOrNull(index) ?: return
        if (index == current.audioIndex) return
        chosenAudioId = track.id
        playQuality(media, current.qualities, current.qualityIndex, player.currentPosition)
    }

    /** Points the player's caption selection at the chosen track, or switches captions off. */
    private fun applySubtitleSelection() {
        val index = nowState.value?.subtitleIndex ?: -1
        val params = player.trackSelectionParameters.buildUpon().clearOverridesOfType(C.TRACK_TYPE_TEXT)
        if (index < 0) {
            params.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
        } else {
            params.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
            val group = player.currentTracks.groups.firstOrNull { it.type == C.TRACK_TYPE_TEXT && it.length > 0 && it.getTrackFormat(0).id == "sub:$index" }
            if (group != null) params.addOverride(TrackSelectionOverride(group.mediaTrackGroup, 0))
        }
        player.trackSelectionParameters = params.build()
    }

    fun togglePlay() {
        if (player.playbackState == Player.STATE_ENDED) player.seekTo(0)
        if (player.isPlaying || player.playWhenReady && player.playbackState != Player.STATE_ENDED) player.pause() else player.play()
    }

    fun seekBy(ms: Long) {
        val duration = player.duration.takeIf { it != C.TIME_UNSET } ?: Long.MAX_VALUE
        player.seekTo((player.currentPosition + ms).coerceIn(0, duration))
    }

    fun stop() {
        streamJob?.cancel()
        queueState.value = StreamQueue(emptyList(), -1)
        player.stop()
        player.clearMediaItems()
        resolved = null
        nowState.value = null
        loadingState.value = false
    }

    fun clearError() { errorState.value = null }

    fun stats(): Stats {
        val v = player.videoFormat
        val a = player.audioFormat
        val aheadMs = (player.bufferedPosition - player.currentPosition).coerceAtLeast(0)
        return Stats(
            resolution = if (v != null && v.width > 0) "${v.width}×${v.height}" else "—",
            videoCodec = v?.codecs ?: v?.sampleMimeType ?: "—",
            videoKbps = ((v?.bitrate ?: -1).takeIf { it > 0 } ?: 0) / 1000,
            frameRate = v?.frameRate?.takeIf { it > 0 }?.let { "%.0f fps".format(it) } ?: "—",
            audioCodec = a?.codecs ?: a?.sampleMimeType ?: "—",
            audioKbps = ((a?.bitrate ?: -1).takeIf { it > 0 } ?: 0) / 1000,
            sampleRate = a?.sampleRate?.takeIf { it > 0 } ?: 0,
            droppedFrames = dropped,
            bufferAheadSec = aheadMs / 1000,
            speed = speedState.value,
            source = if (nowState.value?.streaming == true) "Streaming" else "Saved file",
        )
    }

    // ---- Failure handling -----------------------------------------------------------------

    private fun handlePlayerError(error: PlaybackException) {
        val now = nowState.value
        val media = resolved

        // The device could not decode this picture (a codec or size it lacks): step down one quality
        // and carry on, which is what a person would do by hand, rather than stopping on an error.
        val decodeProblem = error.errorCode == PlaybackException.ERROR_CODE_DECODER_INIT_FAILED ||
            error.errorCode == PlaybackException.ERROR_CODE_DECODING_FAILED ||
            error.errorCode == PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES ||
            error.errorCode == PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED
        if (decodeProblem && now != null && media != null && now.qualityIndex in 0 until now.qualities.lastIndex) {
            val lower = now.qualityIndex + 1
            errorState.value = "This TV couldn't decode ${now.qualities[now.qualityIndex].label}. Switched to ${now.qualities[lower].label}."
            playQuality(media, now.qualities, lower, player.currentPosition)
            return
        }

        // A stream link that stopped working mid-play (they expire) is resolved afresh, once, and
        // playback resumes at the same second.
        val cause = error.cause
        val expired = cause is HttpDataSource.InvalidResponseCodeException && (cause.responseCode == 403 || cause.responseCode == 410)
        if (expired && now?.streaming == true && !retriedExpiredLink) {
            retriedExpiredLink = true
            val track = Track(
                url = resolved?.track?.url ?: return,
                title = now.title, artist = now.artist, durationSec = 0, thumbnailUrl = now.thumbnail, kind = now.kind,
            )
            startStream(track, player.currentPosition)
            return
        }

        errorState.value = humanize(error)
    }

    private fun humanize(e: Throwable): String = when {
        e is UserMessage -> e.message.orEmpty()
        e is UnknownHostException -> "No internet connection. Check Wi-Fi and try again."
        e is ReCaptchaException -> "YouTube asked for a human check. Try again in a little while."
        e is PlaybackException && e.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED -> "The connection dropped. Check Wi-Fi and try again."
        e is PlaybackException && e.errorCode == PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND -> "That file is gone. It may have been on a drive that was unplugged."
        e is PlaybackException && e.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT -> "The connection timed out. Try again."
        e is PlaybackException -> "Couldn't play this (${e.errorCodeName.removePrefix("ERROR_CODE_").lowercase().replace('_', ' ')})."
        else -> e.message?.takeIf { it.isNotBlank() } ?: "Couldn't play this."
    }

    private fun metadata(track: Track, kind: MediaKind): MediaMetadata = MediaMetadata.Builder()
        .setTitle(track.title)
        .setArtist(track.artist.ifBlank { null })
        .setArtworkUri(track.thumbnailUrl?.let { Uri.parse(it) })
        .setExtras(Bundle().apply {
            putString(EXTRA_KIND, kind.name)
            putBoolean(EXTRA_STREAM, true)
        })
        .build()

    companion object {
        private const val TAG = "Playback"
        private const val EXTRA_KIND = "lumina.kind"
        private const val EXTRA_STREAM = "lumina.stream"
        private const val EXTRA_THUMB = "lumina.thumb"
    }
}
