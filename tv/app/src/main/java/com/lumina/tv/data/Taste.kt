package com.lumina.tv.data

import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject

/**
 * What the person has told the app about their taste: songs they liked (kept whole, so a "Liked songs" row can
 * play them), and songs they disliked. A dislike hides that song and, so "less like this" is real, quietly mutes
 * its artist in the Recommended row. Nothing leaves the device.
 *
 * Small and kept in SharedPreferences: a few hundred entries at most.
 */
class Taste(private val prefs: SharedPreferences) {
    private val likedState = MutableStateFlow(readLiked())
    val liked: StateFlow<List<Track>> = likedState.asStateFlow()

    private var dislikedIds: Set<String> = prefs.getStringSet(KEY_DISLIKED_IDS, emptySet()).orEmpty()
    private var mutedArtists: Set<String> = prefs.getStringSet(KEY_MUTED_ARTISTS, emptySet()).orEmpty()

    fun isLiked(id: String) = likedState.value.any { it.id == id }

    /** Newest first. Liking again removes the like. */
    fun toggleLike(track: Track) {
        val now = likedState.value
        val next = if (now.any { it.id == track.id }) now.filter { it.id != track.id } else listOf(track) + now
        likedState.value = next.take(MAX_LIKED)
        prefs.edit().putString(KEY_LIKED, writeLiked(likedState.value)).apply()
        // Liking something you had disliked changes your mind, in the song's favour.
        if (track.id in dislikedIds) undislike(track)
    }

    fun dislike(track: Track) {
        dislikedIds = dislikedIds + track.id
        val artist = normalise(track.artist)
        if (artist.isNotEmpty()) mutedArtists = mutedArtists + artist
        likedState.value = likedState.value.filter { it.id != track.id }
        prefs.edit()
            .putStringSet(KEY_DISLIKED_IDS, dislikedIds)
            .putStringSet(KEY_MUTED_ARTISTS, mutedArtists)
            .putString(KEY_LIKED, writeLiked(likedState.value))
            .apply()
    }

    private fun undislike(track: Track) {
        dislikedIds = dislikedIds - track.id
        mutedArtists = mutedArtists - normalise(track.artist)
        prefs.edit().putStringSet(KEY_DISLIKED_IDS, dislikedIds).putStringSet(KEY_MUTED_ARTISTS, mutedArtists).apply()
    }

    fun isDisliked(id: String) = id in dislikedIds

    /** True when a recommendation should be left out: the song, or its artist, was disliked. */
    fun blocks(track: Track): Boolean = track.id in dislikedIds || normalise(track.artist).let { it.isNotEmpty() && it in mutedArtists }

    private fun normalise(artist: String) = artist.trim().lowercase()

    private fun readLiked(): List<Track> = runCatching {
        val array = JSONArray(prefs.getString(KEY_LIKED, "[]"))
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

    private fun writeLiked(list: List<Track>): String = JSONArray().also { array ->
        for (t in list) {
            array.put(
                JSONObject().put("url", t.url).put("title", t.title).put("artist", t.artist).put("duration", t.durationSec)
                    .put("thumb", t.thumbnailUrl ?: JSONObject.NULL).put("kind", t.kind.name),
            )
        }
    }.toString()

    companion object {
        const val PREFS = "taste"
        private const val KEY_LIKED = "liked"
        private const val KEY_DISLIKED_IDS = "disliked_ids"
        private const val KEY_MUTED_ARTISTS = "muted_artists"
        private const val MAX_LIKED = 300
    }
}
