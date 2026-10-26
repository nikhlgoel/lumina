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

/**
 * The list of saved files, kept in one small JSON file. A database would be overkill for the few
 * hundred items a stick can hold, and a plain file can be read by a person when something is wrong.
 *
 * The index is a cache of what is on disk, never the truth: a file that has gone (a drive was
 * unplugged, someone deleted it in a file manager) is dropped on load rather than shown as playable.
 */
class LibraryStore(private val indexFile: File) {
    private val mutex = Mutex()
    private val state = MutableStateFlow<List<LibraryItem>>(emptyList())
    val items: StateFlow<List<LibraryItem>> = state.asStateFlow()

    suspend fun load() = withContext(Dispatchers.IO) {
        mutex.withLock {
            val parsed = runCatching { parse(indexFile.readText()) }.getOrDefault(emptyList())
            val present = parsed.filter { File(it.path).isFile }
            state.value = present.sortedByDescending { it.addedAt }
            if (present.size != parsed.size) persist(present)
        }
    }

    suspend fun add(item: LibraryItem) = withContext(Dispatchers.IO) {
        mutex.withLock {
            // Saving the same video twice replaces the entry rather than listing it twice.
            val next = (state.value.filter { it.id != item.id && it.path != item.path } + item).sortedByDescending { it.addedAt }
            state.value = next
            persist(next)
        }
    }

    suspend fun remove(id: String, deleteFiles: Boolean = true) = withContext(Dispatchers.IO) {
        mutex.withLock {
            val gone = state.value.firstOrNull { it.id == id } ?: return@withLock
            if (deleteFiles) {
                File(gone.path).delete()
                gone.thumbPath?.let { File(it).delete() }
            }
            val next = state.value.filter { it.id != id }
            state.value = next
            persist(next)
        }
    }

    /**
     * Pick up media that was put in the media folders by hand — copied from a PC, say — and is not
     * in the index. Titles come from the "Artist - Title" file name the PC app also writes.
     * Returns how many were added.
     */
    suspend fun adoptUntracked(dirs: List<File>): Int = withContext(Dispatchers.IO) {
        mutex.withLock {
            val known = state.value.map { it.path }.toSet()
            val found = dirs.flatMap { dir -> dir.listFiles().orEmpty().filter { it.isFile && it.path !in known && isMedia(it) } }
            if (found.isEmpty()) return@withLock 0
            val added = found.map { file ->
                val stem = file.nameWithoutExtension
                val kind = if (file.extension.lowercase() in VIDEO_EXT) MediaKind.VIDEO else MediaKind.AUDIO
                val parts = stem.split(" - ", limit = 2)
                val artist = if (kind == MediaKind.AUDIO && parts.size == 2) parts[0] else ""
                val title = if (artist.isNotEmpty()) parts[1] else stem
                LibraryItem(
                    id = "file-" + Integer.toHexString(file.path.hashCode()), kind = kind, title = title, artist = artist,
                    durationSec = 0, path = file.path, thumbPath = null, sourceUrl = "", sizeBytes = file.length(),
                    addedAt = file.lastModified(),
                )
            }
            val next = (state.value + added).sortedByDescending { it.addedAt }
            state.value = next
            persist(next)
            added.size
        }
    }

    private fun isMedia(file: File) = file.extension.lowercase().let { it in AUDIO_EXT || it in VIDEO_EXT } && !file.name.endsWith(".part")

    /** Written to a temporary file and renamed, so a power cut mid-write cannot leave a half-index. */
    private fun persist(list: List<LibraryItem>) {
        val tmp = File(indexFile.parentFile, indexFile.name + ".tmp")
        tmp.writeText(serialize(list))
        if (!tmp.renameTo(indexFile)) {
            indexFile.delete()
            tmp.renameTo(indexFile)
        }
    }

    companion object {
        private const val VERSION = 1
        val AUDIO_EXT = setOf("opus", "m4a", "mp3", "aac", "flac", "ogg", "wav", "webm", "oga")
        val VIDEO_EXT = setOf("mp4", "mkv", "mov", "m4v", "avi")

        fun serialize(list: List<LibraryItem>): String {
            val arr = JSONArray()
            for (i in list) {
                arr.put(
                    JSONObject()
                        .put("id", i.id).put("kind", i.kind.name).put("title", i.title).put("artist", i.artist)
                        .put("durationSec", i.durationSec).put("path", i.path).put("thumbPath", i.thumbPath ?: JSONObject.NULL)
                        .put("sourceUrl", i.sourceUrl).put("sizeBytes", i.sizeBytes).put("addedAt", i.addedAt),
                )
            }
            return JSONObject().put("version", VERSION).put("items", arr).toString()
        }

        /** Tolerant on purpose: one malformed entry is skipped, it does not lose the whole library. */
        fun parse(text: String): List<LibraryItem> {
            val arr = JSONObject(text).optJSONArray("items") ?: return emptyList()
            return (0 until arr.length()).mapNotNull { index ->
                runCatching {
                    val o = arr.getJSONObject(index)
                    LibraryItem(
                        id = o.getString("id"),
                        kind = MediaKind.valueOf(o.getString("kind")),
                        title = o.getString("title"),
                        artist = o.optString("artist", ""),
                        durationSec = o.optLong("durationSec", 0),
                        path = o.getString("path"),
                        thumbPath = if (o.isNull("thumbPath")) null else o.optString("thumbPath"),
                        sourceUrl = o.optString("sourceUrl", ""),
                        sizeBytes = o.optLong("sizeBytes", 0),
                        addedAt = o.optLong("addedAt", 0),
                    )
                }.getOrNull()
            }
        }
    }
}
