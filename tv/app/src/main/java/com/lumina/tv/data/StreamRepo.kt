package com.lumina.tv.data

import com.lumina.tv.core.Country
import com.lumina.tv.core.SubtitleOption
import com.lumina.tv.core.SubtitleRules
import com.lumina.tv.core.StreamPicker.AudioFormat
import com.lumina.tv.core.StreamPicker.AudioOption
import com.lumina.tv.core.StreamPicker.VideoCodec
import com.lumina.tv.core.StreamPicker.VideoOption
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import org.schabi.newpipe.extractor.Image
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.channel.ChannelInfoItem
import org.schabi.newpipe.extractor.playlist.PlaylistInfoItem
import org.schabi.newpipe.extractor.search.SearchInfo
import org.schabi.newpipe.extractor.services.youtube.linkHandler.YoutubeSearchQueryHandlerFactory
import org.schabi.newpipe.extractor.stream.AudioTrackType
import org.schabi.newpipe.extractor.stream.DeliveryMethod
import org.schabi.newpipe.extractor.stream.StreamInfo
import org.schabi.newpipe.extractor.stream.StreamInfoItem
import org.schabi.newpipe.extractor.stream.StreamType
import org.schabi.newpipe.extractor.stream.VideoStream
import kotlin.math.abs

/**
 * Search and stream resolution, over the extractor library. The only place that knows its types:
 * everything above this sees `Track` and `ResolvedMedia`.
 */
class StreamRepo {
    private val service get() = ServiceList.YouTube

    /**
     * Songs and videos for a query, searched in parallel and independently, so one source being slow
     * or down never empties the other. Only when both fail does this throw, so the screen can say
     * "no connection" instead of "no results".
     */
    suspend fun search(query: String): SearchResults = coroutineScope {
        val q = query.trim().take(200)
        val songs = async(Dispatchers.IO) { attempt { searchKind(q, YoutubeSearchQueryHandlerFactory.MUSIC_SONGS, MediaKind.AUDIO) } }
        val videos = async(Dispatchers.IO) { attempt { searchKind(q, YoutubeSearchQueryHandlerFactory.VIDEOS, MediaKind.VIDEO) } }
        val s = songs.await()
        val v = videos.await()
        if (s.isFailure && v.isFailure) throw (s.exceptionOrNull() ?: IllegalStateException("Search failed"))

        val songList = s.getOrDefault(emptyList())
        // A track already listed under Songs is not repeated under Videos.
        val songIds = songList.map { it.id }.toSet()
        SearchResults(q, songList, v.getOrDefault(emptyList()).filter { it.id !in songIds })
    }

    /**
     * What YouTube lists next to one item. The honest basis for "recommended for you": it follows what was
     * saved or played, and needs no sign-in (YouTube has no public API for a person's own home feed).
     * Costs a full page fetch per seed, so callers use few seeds, in the background, and cache.
     */
    suspend fun related(seed: Track, limit: Int): List<Track> = withContext(Dispatchers.IO) {
        if (seed.kind == MediaKind.AUDIO) return@withContext songsLike(seed, limit)
        StreamInfo.getInfo(service, seed.url).relatedItems
            .filterIsInstance<StreamInfoItem>()
            .filter { it.streamType != StreamType.LIVE_STREAM && it.streamType != StreamType.AUDIO_LIVE_STREAM }
            .take(limit)
            .map { Track(it.url, it.name, it.uploaderName.orEmpty(), it.duration.coerceAtLeast(0), thumbnail(it.thumbnails), MediaKind.VIDEO) }
    }

    /**
     * More music for a song. YouTube's "related" list beside a song is mostly ordinary videos (reactions, vlogs, mixes), and
     * calling those songs filled Quick picks and Up next with things that are not music. So for a song this asks YouTube
     * Music's song search instead, for the artist and for the artist with the title, and keeps only results that can be a
     * song (see [com.lumina.tv.core.Discovery.looksLikeSong]), never the seed itself.
     */
    private fun songsLike(seed: Track, limit: Int): List<Track> {
        val artist = com.lumina.tv.core.PlaylistLogic.cleanArtist(seed.artist)
        val queries = listOf(artist, "$artist ${seed.title}".trim()).filter { it.isNotBlank() }.distinct().ifEmpty { listOf(seed.title) }
        val found = LinkedHashMap<String, Track>()
        for (q in queries) {
            val hits = runCatching { searchKind(q, YoutubeSearchQueryHandlerFactory.MUSIC_SONGS, MediaKind.AUDIO) }.getOrDefault(emptyList())
            for (t in hits) if (t.id != seed.id && com.lumina.tv.core.Discovery.looksLikeSong(t.durationSec)) found.putIfAbsent(t.id, t)
        }
        return found.values.take(limit).toList()
    }

    /** Albums, artists and playlists found on YouTube Music; each is something a card can open. */
    data class AlbumHit(val title: String, val artist: String, val thumbnail: String?, val playlistId: String)
    data class ArtistHit(val name: String, val thumbnail: String?, val subtitle: String?)
    data class ListHit(val title: String, val owner: String, val thumbnail: String?, val playlistId: String, val count: Long)

    private fun searchItems(query: String, filter: String) = SearchInfo.getInfo(service, service.searchQHFactory.fromQuery(query, listOf(filter), "")).relatedItems

    /** Albums matching [query] (an artist's name finds their albums). Each opens as a playlist of its songs. */
    suspend fun searchAlbums(query: String, limit: Int = 12): List<AlbumHit> = withContext(Dispatchers.IO) {
        searchItems(query, YoutubeSearchQueryHandlerFactory.MUSIC_ALBUMS).filterIsInstance<PlaylistInfoItem>().mapNotNull {
            val id = (com.lumina.tv.core.PlaylistLogic.parse(it.url) as? com.lumina.tv.core.PlaylistLogic.Parsed.Ok)?.id ?: return@mapNotNull null
            AlbumHit(it.name, com.lumina.tv.core.PlaylistLogic.cleanArtist(it.uploaderName), thumbnail(it.thumbnails), id)
        }.take(limit)
    }

    /** Artists matching [query], with their picture, for a round card. */
    suspend fun searchArtists(query: String, limit: Int = 8): List<ArtistHit> = withContext(Dispatchers.IO) {
        searchItems(query, YoutubeSearchQueryHandlerFactory.MUSIC_ARTISTS).filterIsInstance<ChannelInfoItem>()
            .map { ArtistHit(com.lumina.tv.core.PlaylistLogic.cleanArtist(it.name), thumbnail(it.thumbnails), it.description?.takeIf { d -> d.isNotBlank() }) }
            .take(limit)
    }

    /** Playlists on YouTube Music matching [query] (not generated mixes: those change every time and cannot be kept). */
    suspend fun searchPlaylists(query: String, limit: Int = 12): List<ListHit> = withContext(Dispatchers.IO) {
        searchItems(query, YoutubeSearchQueryHandlerFactory.MUSIC_PLAYLISTS).filterIsInstance<PlaylistInfoItem>().mapNotNull {
            val id = (com.lumina.tv.core.PlaylistLogic.parse(it.url) as? com.lumina.tv.core.PlaylistLogic.Parsed.Ok)?.id ?: return@mapNotNull null
            ListHit(it.name, it.uploaderName.orEmpty(), thumbnail(it.thumbnails), id, it.streamCount)
        }.take(limit)
    }

    /** Songs matching [query]: for an artist's page, the artist's name. */
    suspend fun songs(query: String): List<Track> = withContext(Dispatchers.IO) {
        searchKind(query, YoutubeSearchQueryHandlerFactory.MUSIC_SONGS, MediaKind.AUDIO)
    }

    /** Videos matching [query]: a topic on the Videos page ("gaming", "news today") or a starting point with nothing played yet. */
    suspend fun videos(query: String): List<Track> = withContext(Dispatchers.IO) {
        searchKind(query, YoutubeSearchQueryHandlerFactory.VIDEOS, MediaKind.VIDEO)
    }

    /** A starting point for someone with nothing saved yet. */
    suspend fun popularSongs(): List<Track> = withContext(Dispatchers.IO) {
        searchKind("top songs this week", YoutubeSearchQueryHandlerFactory.MUSIC_SONGS, MediaKind.AUDIO)
    }

    /**
     * Songs popular in one country, as several lists (this week's top, new releases, plain hits) searched in
     * parallel, for the Shuffle button to mix. A list that fails is skipped; only when all fail does this throw,
     * so "no connection" can be told apart from "nothing found".
     */
    suspend fun countryHits(country: Country): List<List<Track>> = coroutineScope {
        val queries = listOf("top songs ${country.name} this week", "new ${country.name} songs", "${country.name} hit songs")
        val results = queries.map { q -> async(Dispatchers.IO) { attempt { searchKind(q, YoutubeSearchQueryHandlerFactory.MUSIC_SONGS, MediaKind.AUDIO) } } }.awaitAll()
        val lists = results.mapNotNull { it.getOrNull() }.filter { it.isNotEmpty() }
        if (lists.isEmpty()) throw (results.firstNotNullOfOrNull { it.exceptionOrNull() } ?: java.io.IOException("Nothing found for ${country.name}."))
        lists
    }

    private fun searchKind(query: String, filter: String, kind: MediaKind): List<Track> {
        val handler = service.searchQHFactory.fromQuery(query, listOf(filter), "")
        val info = SearchInfo.getInfo(service, handler)
        return info.relatedItems
            .filterIsInstance<StreamInfoItem>()
            // A live stream has no duration and cannot be saved, so it is not offered as a result.
            .filter { it.streamType != StreamType.LIVE_STREAM && it.streamType != StreamType.AUDIO_LIVE_STREAM }
            .take(RESULT_LIMIT)
            .map { Track(it.url, it.name, it.uploaderName.orEmpty(), it.duration.coerceAtLeast(0), thumbnail(it.thumbnails), kind) }
    }

    /** Resolve one item's page URL into streams. Slow (a page fetch and a script run), so call it once per action. */
    /**
     * Resolved streams are kept for 20 minutes (their links last hours), so pressing Play on something that was
     * just looked at, or pre-resolved while its card was focused ([prewarm]), starts at once instead of waiting
     * for a page fetch and a script run. [fresh] skips the cache: used when a link has gone bad and for downloads.
     */
    suspend fun resolve(track: Track, fresh: Boolean = false, background: Boolean = false): ResolvedMedia {
        if (!fresh) synchronized(cache) { cache[track.url]?.takeIf { System.currentTimeMillis() - it.at < CACHE_TTL_MS } }?.let { return it.media }
        // Asking YouTube's page can stall or fail once and work the next moment. A person waiting gets two attempts of 25 s
        // each (a removed or private video is not retried: asking again changes nothing); a look-ahead gets one quiet try.
        val media = com.lumina.tv.core.retrying(
            attempts = if (background) 1 else 2,
            perAttemptMs = if (background) 40_000 else 25_000,
            retryIf = { it !is org.schabi.newpipe.extractor.exceptions.ContentNotAvailableException },
        ) { resolveFresh(track, if (background) prefetchDispatcher else Dispatchers.IO) }
        synchronized(cache) {
            cache[track.url] = Cached(System.currentTimeMillis(), media)
            while (cache.size > CACHE_MAX) cache.remove(cache.keys.first())
        }
        return media
    }

    /**
     * Done once, a little after the app opens: resolves one short, stable video in the background so the extractor has already
     * fetched and parsed YouTube's player script (the slow part of the first resolve of a session). The first thing a person
     * plays then starts about as fast as the tenth. Errors are ignored; it costs one page fetch.
     */
    suspend fun warmUp() {
        runCatching { prewarm(Track("https://www.youtube.com/watch?v=jNQXAC9IVRw", "", "", 0, null, MediaKind.AUDIO)) }
    }

    /** Fire and forget: warm the cache for something likely to be played next. Errors are ignored; Play will retry properly. */
    suspend fun prewarm(track: Track) {
        val warm = synchronized(cache) { cache[track.url]?.let { System.currentTimeMillis() - it.at < CACHE_TTL_MS } == true }
        if (!warm) runCatching { resolve(track, background = true) }
    }

    /**
     * Looking ahead (resolving the next song, or the one the remote rests on) runs a script and parses a big page: real
     * CPU work on a 4-core stick that is also decoding the song being heard. It runs on one background-priority thread,
     * so it only uses what the music and the screen leave spare. Pressing Play never waits on this: it uses the normal pool.
     */
    private val prefetchDispatcher = java.util.concurrent.Executors.newSingleThreadExecutor { r ->
        Thread({ android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND); r.run() }, "lumina-prefetch")
    }.asCoroutineDispatcher()

    private class Cached(val at: Long, val media: ResolvedMedia)
    private val cache = LinkedHashMap<String, Cached>()

    private suspend fun resolveFresh(track: Track, dispatcher: kotlinx.coroutines.CoroutineDispatcher): ResolvedMedia = withContext(dispatcher) {
        val info = StreamInfo.getInfo(service, track.url)

        val audio = info.audioStreams
            .filter { it.isUrl && it.deliveryMethod == DeliveryMethod.PROGRESSIVE_HTTP }
            .map {
                val suffix = it.format?.suffix.orEmpty()
                val format = when (suffix) {
                    "webm", "opus" -> AudioFormat.OPUS
                    "m4a", "mp4" -> AudioFormat.M4A
                    else -> AudioFormat.OTHER
                }
                AudioOption(
                    it.content, format, it.averageBitrate.coerceAtLeast(0), suffix.ifEmpty { "bin" },
                    trackId = it.audioTrackId,
                    label = it.audioTrackName?.takeIf { n -> n.isNotBlank() } ?: it.audioLocale?.getDisplayLanguage(java.util.Locale.ENGLISH)?.takeIf { n -> n.isNotBlank() },
                    language = it.audioLocale?.toLanguageTag(),
                    original = it.audioTrackType == AudioTrackType.ORIGINAL,
                )
            }

        val video = info.videoStreams.mapNotNull { toVideo(it, hasAudio = true) } +
            info.videoOnlyStreams.mapNotNull { toVideo(it, hasAudio = false) }

        ResolvedMedia(
            // What the search already showed wins over what the page says. A song's search result carries
            // its square album art and a clean artist name; the page offers a wide thumbnail with bars
            // down the sides and "Artist - Topic". The page's values only fill gaps.
            track = track.copy(
                title = track.title.ifBlank { info.name },
                artist = track.artist.ifBlank { info.uploaderName.orEmpty() },
                durationSec = track.durationSec.takeIf { it > 0 } ?: info.duration.coerceAtLeast(0),
                thumbnailUrl = track.thumbnailUrl ?: thumbnail(info.thumbnails),
            ),
            audio = audio,
            video = video,
            hlsUrl = info.hlsUrl?.takeIf { it.isNotBlank() },
            // Every caption track the video has, written ones and auto-generated ones, each labelled as such.
            subtitles = info.subtitles
                .filter { it.isUrl }
                .map { SubtitleOption(it.content, it.languageTag, SubtitleRules.labelFor(it.displayLanguageName, it.languageTag, it.isAutoGenerated), it.format?.mimeType ?: "text/vtt", it.isAutoGenerated) },
            isLive = info.streamType == StreamType.LIVE_STREAM || info.streamType == StreamType.AUDIO_LIVE_STREAM,
        )
    }

    private fun toVideo(s: VideoStream, hasAudio: Boolean): VideoOption? {
        if (!s.isUrl || s.deliveryMethod != DeliveryMethod.PROGRESSIVE_HTTP || s.height <= 0) return null
        val codec = s.codec.orEmpty().lowercase()
        return VideoOption(
            url = s.content,
            width = s.width,
            height = s.height,
            fps = s.fps.coerceAtLeast(0),
            codec = when {
                codec.startsWith("avc") -> VideoCodec.H264
                codec.startsWith("vp9") || codec.startsWith("vp09") -> VideoCodec.VP9
                codec.startsWith("av01") -> VideoCodec.AV1
                else -> VideoCodec.OTHER
            },
            hasAudio = hasAudio,
            ext = s.format?.suffix.orEmpty().ifEmpty { "mp4" },
        )
    }

    /** The thumbnail nearest 360 px tall: big enough for a TV row, small enough to load quickly. */
    private fun thumbnail(images: List<Image>): String? =
        images.filter { it.url.isNotBlank() }.minByOrNull { if (it.height > 0) abs(it.height - 360) else Int.MAX_VALUE / 2 }?.url

    /** Like `runCatching`, but never swallows cancellation: a cancelled search must stop, not "fail". */
    private inline fun <T> attempt(block: () -> T): Result<T> =
        try { Result.success(block()) } catch (e: CancellationException) { throw e } catch (e: Throwable) { Result.failure(e) }

    companion object {
        private const val CACHE_TTL_MS = 20L * 60 * 1000
        private const val CACHE_MAX = 16
        private const val RESULT_LIMIT = 12
    }
}
