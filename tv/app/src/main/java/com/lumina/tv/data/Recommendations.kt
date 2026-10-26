package com.lumina.tv.data

import com.lumina.tv.core.RecommendLogic
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * The "Recommended for you" row on Home.
 *
 * It is not YouTube's own home feed: no public API offers that, signed in or not. It is what YouTube lists
 * next to the few things you most recently saved, which follows your taste without any account. With
 * nothing saved yet it shows popular songs instead, and says so ([Feed.personal] is false), so the row is
 * never pretending to know the person.
 *
 * Kept in memory only and rebuilt at most every 30 minutes: each seed is a full page fetch.
 */
class Recommendations(
    private val repo: StreamRepo,
    /** True for a track the person has said they do not want (or by an artist they muted): it is left out of the row. */
    private val blocks: (Track) -> Boolean = { false },
    private val now: () -> Long = System::currentTimeMillis,
) {
    data class Feed(val tracks: List<Track>, val personal: Boolean)

    private val _feed = MutableStateFlow<Feed?>(null)
    val feed: StateFlow<Feed?> = _feed.asStateFlow()

    /** True once the first attempt has finished, whatever its result: Home shows placeholders until then, so the page never jumps. */
    private val _settled = MutableStateFlow(false)
    val settled: StateFlow<Boolean> = _settled.asStateFlow()

    /**
     * The big tiles at the top of Home: what YouTube lists next to the few things you played, liked or saved most
     * recently. Null until the first attempt finishes; empty when there is nothing to base it on yet.
     */
    private val _videos = MutableStateFlow<List<Track>?>(null)
    val videos: StateFlow<List<Track>?> = _videos.asStateFlow()
    private var videosBuiltAt = 0L
    private var videosSeedKey = ""

    private val lock = Mutex()
    private var builtAt = 0L

    /**
     * [seeds] is newest first: what was played, then what was liked, then what is saved. Rebuilt when those change
     * (a new thing was played) or after the usual half hour; each seed is one page fetch, so only three are used.
     */
    suspend fun refreshVideos(seeds: List<Track>) = lock.withLock {
        val picked = seeds.distinctBy { it.id }.take(VIDEO_SEEDS)
        val key = picked.joinToString("|") { it.id }
        if (picked.isEmpty()) { _videos.value = emptyList(); return@withLock }
        if (key == videosSeedKey && _videos.value != null && !RecommendLogic.isDue(videosBuiltAt, now())) return@withLock
        try {
            val lists = coroutineScope {
                picked.map { s -> async { runCatching { repo.related(s, VIDEO_PER_SEED) }.getOrDefault(emptyList()) } }.map { it.await() }
            }
            val merged = RecommendLogic.merge(lists, { it.id }, picked.map { it.id }.toSet(), limit = VIDEO_LIMIT).filterNot(blocks)
            if (merged.isNotEmpty()) {
                _videos.value = merged
                videosSeedKey = key
                videosBuiltAt = now()
            } else if (_videos.value == null) {
                _videos.value = emptyList()
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (_videos.value == null) _videos.value = emptyList()
        }
    }

    /** [recentFirst] is the library, newest first. Failure leaves the previous row in place. */
    suspend fun refresh(recentFirst: List<LibraryItem>, force: Boolean = false) = lock.withLock {
        if (!force && _feed.value != null && !RecommendLogic.isDue(builtAt, now())) return@withLock
        try {
            val seeds = RecommendLogic.pickSeeds(recentFirst, { it.artist })
            val saved = recentFirst.map { Track.idFromUrl(it.sourceUrl) }.toSet()
            val feed = if (seeds.isEmpty()) {
                Feed(RecommendLogic.merge(listOf(repo.popularSongs()), { it.id }, saved), personal = false)
            } else {
                val lists = coroutineScope {
                    seeds.map { s ->
                        async { runCatching { repo.related(Track(s.sourceUrl, s.title, s.artist, s.durationSec, null, s.kind), PER_SEED) }.getOrDefault(emptyList()) }
                    }.map { it.await() }
                }
                Feed(RecommendLogic.merge(lists, { it.id }, saved), personal = true)
            }
            val kept = feed.copy(tracks = feed.tracks.filterNot(blocks))
            if (kept.tracks.isNotEmpty()) {
                _feed.value = kept
                builtAt = now()
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // Offline or YouTube changed something: keep what is on screen. The row is a nicety, never an error.
        } finally {
            _settled.value = true
        }
    }

    private companion object {
        const val PER_SEED = 12
        const val VIDEO_SEEDS = 3
        const val VIDEO_PER_SEED = 10
        const val VIDEO_LIMIT = 24
    }
}
