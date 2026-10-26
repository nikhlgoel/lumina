package com.lumina.tv.data

import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject

/**
 * What has been played in Lumina, newest first: the "Recently played" row on Home, and the seeds for the
 * recommendations. Every song or video that starts playing, streamed or saved, is recorded once (playing it again
 * moves it to the front).
 *
 * Kept on this device, and said plainly: YouTube's own watch history cannot be read by an app. Its API returns an
 * empty list for the history playlist (closed to developers since 2016), so there is nothing to sync with; this is
 * Lumina's own history, and it is the same on any stick only if the files are copied across.
 */
class History(private val prefs: SharedPreferences) {
    private val state = MutableStateFlow(read())
    val items: StateFlow<List<Track>> = state.asStateFlow()

    /** Put [track] at the front, dropping an older entry for the same thing. */
    fun record(track: Track) {
        if (track.url.isBlank()) return
        val next = (listOf(track) + state.value.filter { it.id != track.id }).take(MAX)
        if (next == state.value) return
        state.value = next
        prefs.edit().putString(KEY, write(next)).apply()
    }

    fun clear() {
        state.value = emptyList()
        prefs.edit().remove(KEY).apply()
    }

    private fun read(): List<Track> = runCatching {
        val array = JSONArray(prefs.getString(KEY, "[]"))
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

    private fun write(list: List<Track>): String = JSONArray().also { array ->
        for (t in list) {
            array.put(
                JSONObject().put("url", t.url).put("title", t.title).put("artist", t.artist).put("duration", t.durationSec)
                    .put("thumb", t.thumbnailUrl ?: JSONObject.NULL).put("kind", t.kind.name),
            )
        }
    }.toString()

    companion object {
        const val PREFS = "history"
        private const val KEY = "played"
        private const val MAX = 300
    }
}
