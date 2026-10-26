package com.lumina.tv.data

import com.lumina.tv.core.StreamPicker
import com.lumina.tv.core.SubtitleOption

enum class MediaKind { AUDIO, VIDEO }

/** One search result or queue entry, before any stream has been resolved. */
data class Track(
    /** The page URL (not a stream URL): stable, and what resolving starts from. */
    val url: String,
    val title: String,
    val artist: String,
    val durationSec: Long,
    val thumbnailUrl: String?,
    val kind: MediaKind,
) {
    /** A stable id: the video id for a YouTube URL, else a hash. Used to recognise "already downloaded". */
    val id: String get() = idFromUrl(url)

    companion object {
        fun idFromUrl(url: String): String {
            val v = Regex("[?&]v=([\\w-]{6,})").find(url)?.groupValues?.get(1)
            return v ?: Integer.toHexString(url.hashCode())
        }
    }
}

data class SearchResults(val query: String, val songs: List<Track>, val videos: List<Track>)

/**
 * Everything needed to play or download one item. Stream URLs expire within hours, so this is built
 * when the person presses Play or Download and is never stored.
 */
data class ResolvedMedia(
    val track: Track,
    val audio: List<StreamPicker.AudioOption>,
    val video: List<StreamPicker.VideoOption>,
    val hlsUrl: String?,
    val subtitles: List<SubtitleOption>,
    val isLive: Boolean,
)

/** One saved file in the library. */
data class LibraryItem(
    val id: String,
    val kind: MediaKind,
    val title: String,
    val artist: String,
    val durationSec: Long,
    val path: String,
    val thumbPath: String?,
    val sourceUrl: String,
    val sizeBytes: Long,
    val addedAt: Long,
)
