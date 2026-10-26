package com.lumina.tv.core

/**
 * Lyrics, as far as they can be decided without the network: reading the timed "LRC" format, finding the line
 * that is being sung, cleaning a YouTube title into something a lyrics database knows, and choosing the best of
 * several matches. Pure, so each rule has a test.
 */
object Lrc {
    data class Line(val timeMs: Long, val text: String)

    private val stamp = Regex("\\[(\\d{1,3}):(\\d{2})(?:[.:](\\d{1,3}))?]")

    /** Timed lines in order. Metadata tags like [ar:Someone] are not timestamps and are skipped; a line may carry several stamps. */
    fun parse(text: String): List<Line> {
        val out = mutableListOf<Line>()
        for (raw in text.lineSequence()) {
            val stamps = stamp.findAll(raw).toList()
            if (stamps.isEmpty()) continue
            val words = raw.substring(stamps.last().range.last + 1).trim()
            for (m in stamps) {
                val min = m.groupValues[1].toLong()
                val sec = m.groupValues[2].toLong()
                val frac = m.groupValues[3].padEnd(3, '0').take(3).toLongOrNull() ?: 0L
                out += Line(min * 60_000 + sec * 1000 + frac, words)
            }
        }
        return out.sortedBy { it.timeMs }
    }

    /** Index of the line being sung at [posMs]: the last one that has started. -1 before the first. */
    fun activeIndex(lines: List<Line>, posMs: Long): Int {
        var lo = 0
        var hi = lines.lastIndex
        var found = -1
        while (lo <= hi) {
            val mid = (lo + hi) ushr 1
            if (lines[mid].timeMs <= posMs) { found = mid; lo = mid + 1 } else hi = mid - 1
        }
        return found
    }

    private val brackets = Regex("[(\\[{][^)\\]}]*[)\\]}]")
    private val trailing = Regex("(?i)\\s*[-|:]?\\s*(official\\s*(music\\s*)?(video|audio)|lyric(s)?\\s*video|lyrics?|full\\s*(video|song)|video\\s*song|hd|4k|audio)\\s*$")
    private val featuring = Regex("(?i)\\s+(feat\\.?|ft\\.?|featuring)\\s+.*$")

    /** "Espresso (Official Video) ft. X" -> "Espresso": what a lyrics database lists the song as. */
    fun cleanTitle(title: String): String {
        var t = title.replace(brackets, " ")
        t = t.replace(featuring, "")
        // Strip repeatedly: "Song - Official Video HD" has two tails.
        repeat(3) { t = t.replace(trailing, "") }
        return t.replace(Regex("\\s+"), " ").trim().trim('-', '|', ':').trim()
    }

    /** "Artist - Topic" is YouTube's auto-generated channel name; the artist is the part before it. */
    fun cleanArtist(artist: String): String = artist.replace(Regex("(?i)\\s*-\\s*topic$"), "").replace(Regex("(?i)vevo$"), "").trim()

    /**
     * The (artist, title) pairs worth asking a lyrics database about, best guess first. YouTube titles are messy:
     * "Artist - Song", "Song | Artist | Movie", the artist missing from the channel name, several artists joined by
     * commas. Each distinct reading is tried, so a song is not missed because the first guess was wrong.
     */
    fun queryVariants(title: String, artist: String): List<Pair<String, String>> {
        val cleanArtist = cleanArtist(artist)
        val firstArtist = cleanArtist.split(Regex("(?i)\\s*(,|&|\\bx\\b|\\band\\b)\\s*")).first().trim()
        val out = linkedSetOf<Pair<String, String>>()
        val main = cleanTitle(title.substringBefore('|'))
        out += cleanArtist to main
        if (firstArtist != cleanArtist) out += firstArtist to main
        // "Artist - Song" and "Song - Artist": either order can be the real one, and the database decides.
        val dash = main.split(Regex("\\s+[-\u2013\u2014]\\s+"), limit = 2)
        if (dash.size == 2 && dash.all { it.isNotBlank() }) {
            out += dash[0].trim() to dash[1].trim()
            out += dash[1].trim() to dash[0].trim()
            out += "" to dash[1].trim()
        }
        // "Song | Artist | Movie": the piece after the first bar is often the artist.
        val bars = title.split('|').map { cleanTitle(it) }.filter { it.isNotBlank() }
        if (bars.size >= 2) out += bars[1] to bars[0]
        out += "" to main
        return out.filter { it.second.isNotBlank() }
    }

    /** Plain lyrics without the "[Chorus]" / "[Jungkook]" section labels some databases insert, which are not words sung. */
    fun plainLines(text: String): List<String> =
        text.lines().map { it.trim() }.filter { it.isNotEmpty() && !(it.startsWith("[") && it.endsWith("]")) }

    /** At least as many Latin-alphabet letters as others: such lyrics need no romanising. */
    fun mostlyLatin(lines: List<String>): Boolean {
        var latin = 0
        var other = 0
        for (line in lines) for (c in line) if (c.isLetter()) { if (c.code < 0x250) latin++ else other++ }
        return latin >= other
    }

    /** [track] and [artist] are the lyrics service's own names for it, kept so a wrong match can be explained afterwards. */
    data class Candidate(val durationSec: Double, val synced: String?, val plain: String?, val track: String = "", val artist: String = "")

    /**
     * The best match for a song of [durationSec]: one with timed lyrics beats one without, and among equals the
     * closest length wins. A length more than [toleranceSec] away is a different recording, so it is refused
     * rather than showing the wrong song's words.
     */
    fun pick(candidates: List<Candidate>, durationSec: Long, toleranceSec: Int = 6): Candidate? {
        val usable = candidates.filter { !it.synced.isNullOrBlank() || !it.plain.isNullOrBlank() }
        val near = if (durationSec > 0) usable.filter { kotlin.math.abs(it.durationSec - durationSec) <= toleranceSec } else usable
        return near.minWithOrNull(
            compareBy<Candidate> { if (it.synced.isNullOrBlank()) 1 else 0 }
                .thenBy { if (durationSec > 0) kotlin.math.abs(it.durationSec - durationSec) else 0.0 },
        )
    }
}
