package com.lumina.tv.core

import org.json.JSONObject

/**
 * The decisions behind Home's discovery rows, with no network and no Android screen, so each can be tested.
 */
object Discovery {
    data class TopArtist(val name: String, val imageUrl: String?, val rank: Int)

    /** Deezer's public chart of artists. It needs no key and no sign-in, and shows what is popular right now (not "of the year"). */
    const val DEEZER_TOP_ARTISTS = "https://api.deezer.com/chart/0/artists?limit=24"

    /**
     * Deezer's chart as a list, in rank order. Tolerant: an entry with no name is skipped, a missing or malformed reply is an
     * empty list, and the picture is the largest Deezer offers (the artist's name and picture are all a card needs).
     */
    fun parseDeezerArtists(json: String): List<TopArtist> = runCatching {
        val data = JSONObject(json).optJSONArray("data") ?: return emptyList()
        var rank = 0
        (0 until data.length()).mapNotNull { i ->
            val o = data.optJSONObject(i) ?: return@mapNotNull null
            val name = o.optString("name").trim().takeIf { it.isNotEmpty() } ?: return@mapNotNull null
            val pic = listOf("picture_xl", "picture_big", "picture_medium", "picture").firstNotNullOfOrNull { k -> o.optString(k).takeIf { it.isNotBlank() } }
            TopArtist(name, pic, ++rank)
        }
    }.getOrDefault(emptyList())

    private val skipArtists = setOf("various artists", "unknown artist", "unknown", "<unknown>", "youtube", "youtube music")

    /**
     * The artists a person actually listens to, most-heard first, from every place a song's artist is known (saved songs,
     * liked songs, what was played). [sources] are lists of artist names, **most important source first**: a name that turns up
     * in several outranks one that turns up once, and ties go to whoever appeared earlier. "Artist - Topic" suffixes and
     * "Various Artists" are not artists.
     */
    fun topArtists(sources: List<List<String>>, limit: Int): List<String> {
        val counts = LinkedHashMap<String, Int>()
        val display = HashMap<String, String>()
        for (list in sources) for (raw in list) {
            val name = PlaylistLogic.cleanArtist(raw)
            val key = name.lowercase()
            if (key.isEmpty() || key in skipArtists) continue
            counts[key] = (counts[key] ?: 0) + 1
            display.putIfAbsent(key, name)
        }
        return counts.entries.withIndex()
            .sortedWith(compareByDescending<IndexedValue<Map.Entry<String, Int>>> { it.value.value }.thenBy { it.index })
            .take(limit).map { display.getValue(it.value.key) }
    }

    /**
     * Several lists woven into one, a take from each in turn (a video, an album, a playlist, a video...), so the uneven
     * mix on Home never shows three of the same kind in a row. A list that runs out is skipped; order inside each list is kept.
     */
    fun <T> interleave(vararg lists: List<T>): List<T> {
        val out = ArrayList<T>()
        var i = 0
        while (lists.any { i < it.size }) {
            for (l in lists) if (i < l.size) out += l[i]
            i++
        }
        return out
    }

    /**
     * Whether something listed as music can really be a song: a length of fifteen minutes or less (an unknown length, 0, is
     * given the benefit of the doubt). A 20-minute reaction video or a full-length mix is not a song, and must not turn up in
     * Quick picks or Up next, or play in the music screen with a cropped video thumbnail.
     */
    fun looksLikeSong(durationSec: Long): Boolean = durationSec <= 15 * 60

    data class ArtistGroup(val name: String, val songs: Int, val imageUrl: String?)

    /**
     * Songs grouped by artist for the Artists page: each artist once (whatever the capitalisation, and with "- Topic" folded in),
     * with how many songs, and a picture from one of their songs. Most songs first; ties keep the order they were found in.
     * Songs with no artist, and "Various Artists", are left out. [entries] are (artist, picture) pairs, one per song.
     */
    fun artistGroups(entries: List<Pair<String, String?>>): List<ArtistGroup> {
        val songs = LinkedHashMap<String, Int>()
        val names = HashMap<String, String>()
        val pictures = HashMap<String, String>()
        for ((raw, pic) in entries) {
            val name = PlaylistLogic.cleanArtist(raw)
            val key = name.lowercase()
            if (key.isEmpty() || key in skipArtists) continue
            songs[key] = (songs[key] ?: 0) + 1
            names.putIfAbsent(key, name)
            if (!pic.isNullOrBlank()) pictures.putIfAbsent(key, pic)
        }
        return songs.entries.withIndex()
            .sortedWith(compareByDescending<IndexedValue<Map.Entry<String, Int>>> { it.value.value }.thenBy { it.index })
            .map { ArtistGroup(names.getValue(it.value.key), it.value.value, pictures[it.value.key]) }
    }

    /** Artists named by a recommended song that are not already among [mine]: "artists you might like", never your own again. */
    fun newArtists(candidates: List<String>, mine: Collection<String>, limit: Int): List<String> {
        val have = mine.map { PlaylistLogic.cleanArtist(it).lowercase() }.toSet()
        val seen = HashSet<String>()
        return candidates.map { PlaylistLogic.cleanArtist(it) }
            .filter { it.isNotEmpty() && it.lowercase() !in skipArtists && it.lowercase() !in have && seen.add(it.lowercase()) }
            .take(limit)
    }
}
