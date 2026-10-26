package com.lumina.tv.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

enum class PlaylistSource {
    /** A playlist anyone with the link can see (public or unlisted): fetched without signing in. */
    PUBLIC,

    /** One of the signed-in person's own playlists, including private ones: fetched with their account. */
    ACCOUNT,
}

/**
 * A playlist being kept in step with a folder on the stick.
 *
 * `excludedIds` is what must NOT be downloaded even though the playlist lists it: songs that were
 * already there when the playlist was added with "only new ones from now", and songs the person
 * deleted from the library on purpose. Everything else the playlist lists and the library lacks is
 * wanted — which is why a download that failed is simply tried again at the next sync, with nothing
 * extra to remember.
 */
data class SyncedPlaylist(
    val id: String,
    val title: String,
    val source: PlaylistSource,
    val mode: MediaKind,
    val lastSyncMs: Long,
    val itemCount: Int,
    val excludedIds: Set<String>,
    val lastError: String?,
    /** The first item's picture, shown on the Home and Playlists cards. Null until the first sync. */
    val thumbnailUrl: String? = null,
    /**
     * Whether the songs are also copied onto the stick. Adding a playlist only *saves* it (cover, name, description and
     * song list, played from the internet); downloading is a separate choice. Playlists saved before this existed were
     * all download-synced, so a missing value reads as true.
     */
    val download: Boolean = true,
    /** The playlist's own description ("bio"), when its owner wrote one. */
    val description: String? = null,
)

/**
 * The song list of each saved playlist, one small JSON file per playlist. A playlist opens from this at once, and a
 * 433-song list is not fetched from the internet every time it is looked at. Tolerant: a missing or damaged file just
 * means "not cached", never an error.
 */
class PlaylistTracksCache(private val dir: File) {
    private fun fileFor(id: String) = File(dir, id.replace(Regex("[^A-Za-z0-9_-]"), "_") + ".json")

    suspend fun write(id: String, tracks: List<Track>) = withContext(Dispatchers.IO) {
        runCatching {
            dir.mkdirs()
            val array = JSONArray()
            for (t in tracks) {
                array.put(
                    JSONObject().put("url", t.url).put("title", t.title).put("artist", t.artist).put("duration", t.durationSec)
                        .put("thumb", t.thumbnailUrl ?: JSONObject.NULL).put("kind", t.kind.name),
                )
            }
            val target = fileFor(id)
            val tmp = File(dir, target.name + ".tmp")
            tmp.writeText(array.toString())
            if (!tmp.renameTo(target)) { target.delete(); tmp.renameTo(target) }
        }
        Unit
    }

    suspend fun read(id: String): List<Track> = withContext(Dispatchers.IO) {
        runCatching {
            val array = JSONArray(fileFor(id).readText())
            (0 until array.length()).mapNotNull { i ->
                runCatching {
                    val o = array.getJSONObject(i)
                    Track(
                        o.getString("url"), o.optString("title"), o.optString("artist"), o.optLong("duration", 0),
                        if (o.isNull("thumb")) null else o.optString("thumb").ifBlank { null }, MediaKind.valueOf(o.optString("kind", "AUDIO")),
                    )
                }.getOrNull()
            }
        }.getOrDefault(emptyList())
    }

    suspend fun delete(id: String) = withContext(Dispatchers.IO) { runCatching { fileFor(id).delete() }; Unit }
}

/** The playlist list, kept in one small JSON file next to the library index. Written atomically. */
class PlaylistStore(private val file: File) {
    private val mutex = Mutex()
    private val state = MutableStateFlow<List<SyncedPlaylist>>(emptyList())
    val playlists: StateFlow<List<SyncedPlaylist>> = state.asStateFlow()

    suspend fun load() = withContext(Dispatchers.IO) {
        mutex.withLock { state.value = runCatching { parse(file.readText()) }.getOrDefault(emptyList()) }
    }

    suspend fun upsert(playlist: SyncedPlaylist) = withContext(Dispatchers.IO) {
        mutex.withLock {
            val next = state.value.filter { it.id != playlist.id } + playlist
            state.value = next
            persist(next)
        }
    }

    suspend fun update(id: String, change: (SyncedPlaylist) -> SyncedPlaylist) = withContext(Dispatchers.IO) {
        mutex.withLock {
            val next = state.value.map { if (it.id == id) change(it) else it }
            state.value = next
            persist(next)
        }
    }

    suspend fun remove(id: String) = withContext(Dispatchers.IO) {
        mutex.withLock {
            val next = state.value.filter { it.id != id }
            state.value = next
            persist(next)
        }
    }

    /** The person deleted a song: stop every playlist from fetching it back. */
    suspend fun excludeEverywhere(videoId: String) = withContext(Dispatchers.IO) {
        mutex.withLock {
            val next = state.value.map { it.copy(excludedIds = it.excludedIds + videoId) }
            state.value = next
            persist(next)
        }
    }

    private fun persist(list: List<SyncedPlaylist>) {
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(serialize(list))
        if (!tmp.renameTo(file)) {
            file.delete()
            tmp.renameTo(file)
        }
    }

    companion object {
        private const val VERSION = 1

        fun serialize(list: List<SyncedPlaylist>): String {
            val arr = JSONArray()
            for (p in list) {
                arr.put(
                    JSONObject()
                        .put("id", p.id).put("title", p.title).put("source", p.source.name).put("mode", p.mode.name)
                        .put("lastSyncMs", p.lastSyncMs).put("itemCount", p.itemCount)
                        .put("excludedIds", JSONArray(p.excludedIds.toList()))
                        .put("lastError", p.lastError ?: JSONObject.NULL)
                        .put("thumbnailUrl", p.thumbnailUrl ?: JSONObject.NULL)
                        .put("download", p.download)
                        .put("description", p.description ?: JSONObject.NULL),
                )
            }
            return JSONObject().put("version", VERSION).put("playlists", arr).toString()
        }

        /** Tolerant: an unreadable entry is skipped, the rest survive. */
        fun parse(text: String): List<SyncedPlaylist> {
            val arr = JSONObject(text).optJSONArray("playlists") ?: return emptyList()
            return (0 until arr.length()).mapNotNull { i ->
                runCatching {
                    val o = arr.getJSONObject(i)
                    val excluded = o.optJSONArray("excludedIds")
                    SyncedPlaylist(
                        id = o.getString("id"),
                        title = o.optString("title", "Playlist"),
                        source = PlaylistSource.valueOf(o.getString("source")),
                        mode = MediaKind.valueOf(o.getString("mode")),
                        lastSyncMs = o.optLong("lastSyncMs", 0),
                        itemCount = o.optInt("itemCount", 0),
                        excludedIds = if (excluded == null) emptySet() else (0 until excluded.length()).map { excluded.getString(it) }.toSet(),
                        lastError = if (o.isNull("lastError")) null else o.optString("lastError"),
                        thumbnailUrl = if (o.isNull("thumbnailUrl")) null else o.optString("thumbnailUrl").ifBlank { null },
                        download = o.optBoolean("download", true),
                        description = if (o.isNull("description")) null else o.optString("description").ifBlank { null },
                    )
                }.getOrNull()
            }
        }
    }
}
