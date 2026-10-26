package com.lumina.tv.core

/**
 * Choosing which stream to play or download.
 *
 * Pure so the rules can be tested against the shapes real sites return. The extractor library's own
 * types are mapped onto these in `data/StreamRepo`; nothing here knows about it.
 */
object StreamPicker {
    enum class AudioFormat { OPUS, M4A, OTHER }
    enum class VideoCodec { H264, VP9, AV1, OTHER }

    /**
     * [trackId], [label], [language] and [original] describe which audio TRACK this stream belongs to: a video can
     * carry several languages (the original and dubbed ones), each as its own set of streams.
     */
    data class AudioOption(
        val url: String,
        val format: AudioFormat,
        val bitrateKbps: Int,
        val ext: String,
        val trackId: String? = null,
        val label: String? = null,
        val language: String? = null,
        val original: Boolean = false,
    )

    /** One language of a video's sound, as the audio menu lists it, with the best stream of that language. */
    data class AudioTrack(val id: String?, val label: String, val language: String?, val original: Boolean, val best: AudioOption)

    private val betterAudio = compareBy<AudioOption> { it.bitrateKbps }.thenBy { if (it.format == AudioFormat.OPUS) 1 else 0 }

    /**
     * The audio tracks to offer, the original language first. A video with one track gives one entry, so the menu can
     * be hidden when there is nothing to choose.
     */
    fun audioTracks(options: List<AudioOption>, maxKbps: Int = Int.MAX_VALUE): List<AudioTrack> =
        options.filter { it.url.isNotBlank() }
            .groupBy { it.trackId.orEmpty() }
            .map { (id, group) ->
                val best = withinLimit(group, maxKbps).maxWith(betterAudio)
                AudioTrack(id.ifEmpty { null }, best.label?.takeIf { it.isNotBlank() } ?: if (best.original) "Original" else "Audio", best.language, best.original, best)
            }
            .sortedWith(compareByDescending<AudioTrack> { it.original }.thenBy { it.label.lowercase() })

    /** The track to start with: the original language, never a dub picked just because it has a higher bitrate. */
    fun defaultAudioTrack(tracks: List<AudioTrack>): AudioTrack? = tracks.firstOrNull { it.original } ?: tracks.firstOrNull()

    data class VideoOption(
        val url: String,
        val width: Int,
        val height: Int,
        val fps: Int,
        val codec: VideoCodec,
        /** True for a progressive stream that already carries sound; false for video-only (needs an audio stream). */
        val hasAudio: Boolean,
        val ext: String,
    )

    /**
     * The best audio stream: the highest bitrate, and at equal bitrate Opus, which sounds better than
     * AAC at the same rate. No transcoding is ever involved, so what is picked is what is saved —
     * the same "original audio, untouched" rule as the PC app's default.
     */
    fun bestAudio(options: List<AudioOption>, maxKbps: Int = Int.MAX_VALUE): AudioOption? {
        val usable = options.filter { it.url.isNotBlank() }
        // When a video has several languages, "best" is the best of the ORIGINAL one (see defaultAudioTrack).
        val pool = usable.filter { it.original }.ifEmpty { usable }
        return withinLimit(pool, maxKbps).maxWithOrNull(betterAudio)
    }

    /**
     * The streams at or under [maxKbps]. When none is that small the smallest there is, never nothing: a setting that
     * limits the quality must not stop a song from playing.
     */
    private fun withinLimit(options: List<AudioOption>, maxKbps: Int): List<AudioOption> {
        if (maxKbps == Int.MAX_VALUE || options.isEmpty()) return options
        val fitting = options.filter { it.bitrateKbps <= maxKbps }
        return fitting.ifEmpty { listOf(options.minBy { it.bitrateKbps }) }
    }

    /** How good the streamed sound should be: the person's choice of quality against data and memory. */
    enum class AudioQuality(val label: String, val detail: String, val maxKbps: Int) {
        BEST("Best", "The highest quality YouTube has, usually Opus at about 160 kbps.", Int.MAX_VALUE),
        BALANCED("Balanced", "Up to about 128 kbps. Sounds very close to Best and uses less data.", 128),
        SAVER("Data saver", "Up to about 64 kbps. Noticeably thinner, for a slow or metered connection.", 64),
    }

    /**
     * The video to play at or under `maxHeight`: prefers H.264 (every TV decodes it in hardware, and it
     * can be muxed into an MP4), then VP9. AV1 is left out unless nothing else exists — it needs a newer
     * decoder than many sticks have, and a stream that will not decode is worse than a lower resolution.
     * Higher resolution wins, then higher frame rate.
     */
    fun bestVideo(options: List<VideoOption>, maxHeight: Int, needsAudioStream: Boolean = false): VideoOption? {
        val usable = options.filter { it.url.isNotBlank() && it.height <= maxHeight && (!needsAudioStream || !it.hasAudio) }
        val safe = usable.filter { it.codec != VideoCodec.AV1 }.ifEmpty { usable }
        return safe.maxWithOrNull(
            compareBy<VideoOption> { it.height }
                .thenBy { codecRank(it.codec) }
                .thenBy { it.fps },
        )
    }

    private fun codecRank(codec: VideoCodec) = when (codec) {
        VideoCodec.H264 -> 3
        VideoCodec.VP9 -> 2
        VideoCodec.OTHER -> 1
        VideoCodec.AV1 -> 0
    }

    /** One entry per resolution for a quality menu, tallest first, e.g. `1080p`, `720p60`. */
    fun qualityLabels(options: List<VideoOption>): List<String> =
        options.filter { it.height > 0 }
            .groupBy { it.height to (if (it.fps > 30) it.fps else 0) }
            .keys
            .sortedWith(compareByDescending<Pair<Int, Int>> { it.first }.thenByDescending { it.second })
            .map { (h, f) -> if (f > 0) "${h}p$f" else "${h}p" }
}
