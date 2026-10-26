package com.lumina.tv.data

import com.lumina.tv.core.Discovery
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * The albums, artists and playlists on Home's discovery rows, and the chart of top artists.
 *
 * They follow the artists the person actually listens to (saved, liked and played songs), with no account: YouTube has no
 * public API for a person's own recommendations, so each shelf is what YouTube Music's search offers for those artists. With
 * nothing to go on yet, popular picks stand in, and a shelf that cannot be built stays empty (a row is a nicety, never an error).
 *
 * Kept in memory only, and rebuilt at most every three hours or when the artists change: each shelf is a few searches.
 */
class Discover(
    private val repo: StreamRepo,
    private val http: OkHttpClient,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val albumsState = MutableStateFlow<List<StreamRepo.AlbumHit>?>(null)
    val albums: StateFlow<List<StreamRepo.AlbumHit>?> = albumsState.asStateFlow()
    private val playlistsState = MutableStateFlow<List<StreamRepo.ListHit>?>(null)
    val playlists: StateFlow<List<StreamRepo.ListHit>?> = playlistsState.asStateFlow()
    private val artistsState = MutableStateFlow<List<StreamRepo.ArtistHit>?>(null)
    val artists: StateFlow<List<StreamRepo.ArtistHit>?> = artistsState.asStateFlow()
    private val chartState = MutableStateFlow<List<Discovery.TopArtist>?>(null)
    val topArtists: StateFlow<List<Discovery.TopArtist>?> = chartState.asStateFlow()

    private val lock = Mutex()
    private var builtAt = 0L
    private var builtFor = ""
    private var chartAt = 0L

    /**
     * [seeds] are the person's most-listened artists; [candidates] are artists of recommended songs, from which the ones they
     * do not know yet become "artists you might like".
     */
    suspend fun refresh(seeds: List<String>, candidates: List<String>) = lock.withLock {
        val key = seeds.take(SEEDS).joinToString("|") + "#" + candidates.size.coerceAtMost(1)
        if (key == builtFor && builtAt != 0L && now() - builtAt < TTL_MS) return@withLock
        try {
            coroutineScope {
                val top = seeds.take(SEEDS)
                val albumQueries = top.map { "$it album" }.ifEmpty { listOf("top albums", "new album releases") }
                val playlistQueries = top.take(2).map { "$it playlist" }.ifEmpty { listOf("top hits playlist", "chill music playlist") }
                val newNames = Discovery.newArtists(candidates, seeds, ARTISTS)

                val albumJobs = albumQueries.map { q -> async { runCatching { repo.searchAlbums(q, 6) }.getOrDefault(emptyList()) } }
                val listJobs = playlistQueries.map { q -> async { runCatching { repo.searchPlaylists(q, 6) }.getOrDefault(emptyList()) } }
                val artistJobs = newNames.map { n -> async { runCatching { repo.searchArtists(n, 1).firstOrNull() }.getOrNull() } }

                val a = albumJobs.flatMap { it.await() }.distinctBy { it.playlistId }.take(18)
                val p = listJobs.flatMap { it.await() }.distinctBy { it.playlistId }.take(12)
                val r = artistJobs.mapNotNull { it.await() }.distinctBy { it.name.lowercase() }
                // A shelf that came back empty keeps what it had: offline must not blank a row that was already filled.
                if (a.isNotEmpty() || albumsState.value == null) albumsState.value = a
                if (p.isNotEmpty() || playlistsState.value == null) playlistsState.value = p
                if (r.isNotEmpty() || artistsState.value == null) artistsState.value = r
            }
            builtFor = key
            builtAt = now()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (albumsState.value == null) albumsState.value = emptyList()
            if (playlistsState.value == null) playlistsState.value = emptyList()
            if (artistsState.value == null) artistsState.value = emptyList()
        }
    }

    /** This week's most popular artists, from Deezer's public chart. Refreshed at most every three hours. */
    suspend fun loadTopArtists() {
        if (chartState.value != null && now() - chartAt < TTL_MS) return
        try {
            val body = withContext(Dispatchers.IO) {
                http.newCall(Request.Builder().url(Discovery.DEEZER_TOP_ARTISTS).build()).execute().use { if (it.isSuccessful) it.body?.string().orEmpty() else "" }
            }
            val list = Discovery.parseDeezerArtists(body)
            if (list.isNotEmpty()) { chartState.value = list; chartAt = now() } else if (chartState.value == null) chartState.value = emptyList()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (chartState.value == null) chartState.value = emptyList()
        }
    }

    private companion object {
        const val SEEDS = 3
        const val ARTISTS = 8
        const val TTL_MS = 3L * 60 * 60 * 1000
    }
}
