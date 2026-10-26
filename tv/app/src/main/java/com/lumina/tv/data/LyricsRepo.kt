package com.lumina.tv.data

import com.lumina.tv.core.Lrc
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Lyrics, from the most exact source to the loosest, so a song is found whatever it is called on YouTube:
 *
 *  1. LRCLIB (lrclib.net), free and without an account, asked exactly (title, artist, length), then by search. It has
 *     timestamps for most popular songs. A length more than a few seconds off is a different recording and is refused.
 *  2. lyrics.ovh, plain words only, when LRCLIB has nothing. It has no length to check, so it is the last resort.
 *
 * Each song is tried under every plausible reading of its YouTube title and channel ([Lrc.queryVariants]). The answer
 * tells "none exist" from "could not ask" ([Result]), because a dropped connection must not read as "no lyrics".
 *
 * When a [log] is given, every lookup writes down how it went (see [LyricsLog]); that changes nothing about the choice.
 */
class LyricsRepo(client: OkHttpClient, private val translator: LyricsTranslator? = null, private val log: LyricsLog? = null) {
    /**
     * [timed] lines carry real timestamps; otherwise they are plain text, all at 0. [english] and [romanized], when
     * present, have one entry per line (null where nothing is added), and [language] is what the song is sung in.
     */
    data class Lyrics(
        val lines: List<Lrc.Line>,
        val timed: Boolean,
        val source: String,
        val language: String? = null,
        val english: List<String?>? = null,
        val romanized: List<String?>? = null,
    )

    sealed interface Result {
        data class Found(val lyrics: Lyrics) : Result
        data object NotFound : Result
        data object Unreachable : Result
    }

    private val http = client.newBuilder().callTimeout(8, TimeUnit.SECONDS).build()

    private val cache = object : LinkedHashMap<String, Result>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Result>?) = size > 24
    }

    /**
     * The lyrics of one song. [durationSec] is 0 when the length is not known yet; the length check is then skipped.
     * [context] is only for the log: where the length came from, which item the player was on.
     */
    suspend fun load(title: String, artist: String, durationSec: Long, context: String = ""): Result = withContext(Dispatchers.IO) {
        val trace = log?.begin(title, artist, durationSec, context)
        try {
            lookup(title, artist, durationSec, trace)
        } catch (e: CancellationException) {
            trace?.outcome("cancelled before an answer (the song changed or the lyrics view was closed)")
            throw e
        } catch (e: Exception) {
            trace?.outcome("failed with ${e.javaClass.simpleName}: ${e.message}")
            throw e
        } finally {
            if (log != null && trace != null) log.write(trace)
        }
    }

    private suspend fun lookup(title: String, artist: String, durationSec: Long, trace: LyricsLog.Trace?): Result {
        val key = "${Lrc.cleanArtist(artist)}|${Lrc.cleanTitle(title)}|${durationSec / 3}"
        synchronized(cache) { cache[key] }?.let {
            trace?.outcome("answered from the session cache (key ${LyricsLog.quote(key)}): ${describe(it)}")
            return it
        }

        var reached = false
        var plain: Lyrics? = null
        val variants = Lrc.queryVariants(title, artist).take(6)
        trace?.note("cleaned: artist=${LyricsLog.quote(Lrc.cleanArtist(artist))} title=${LyricsLog.quote(Lrc.cleanTitle(title))}; ${variants.size} variant(s) to try")
        for ((i, v) in variants.withIndex()) {
            val (a, t) = v
            trace?.note("variant ${i + 1}: artist=${LyricsLog.quote(a)} title=${LyricsLog.quote(t)}")
            val attempt = try { lrclib(a, t, durationSec, trace) } catch (e: IOException) {
                trace?.note("  lrclib could not be reached: ${e.message}")
                continue
            }
            reached = true
            val found = attempt ?: continue
            if (found.timed) {
                trace?.outcome("FOUND timed lyrics from ${found.source} (${found.lines.size} lines, first: ${LyricsLog.quote(found.lines.first().text)}) with variant ${i + 1}")
                return remember(key, Result.Found(found))
            }
            if (plain == null) plain = found
        }
        if (plain == null) {
            for ((a, t) in variants.filter { it.first.isNotBlank() }.take(2)) {
                trace?.note("lyrics.ovh: artist=${LyricsLog.quote(a)} title=${LyricsLog.quote(t)} (no length check is possible here)")
                val found = try { lyricsOvh(a, t) } catch (e: IOException) {
                    trace?.note("  lyrics.ovh could not be reached: ${e.message}")
                    continue
                }
                reached = true
                if (found != null) {
                    trace?.note("  lyrics.ovh gave ${found.lines.size} lines, first: ${LyricsLog.quote(found.lines.first().text)}")
                    plain = found
                    break
                }
                trace?.note("  lyrics.ovh had nothing usable")
            }
        }
        return when {
            plain != null -> {
                trace?.outcome("FOUND plain (untimed) lyrics from ${plain.source}, ${plain.lines.size} lines")
                remember(key, Result.Found(plain))
            }
            reached -> {
                trace?.outcome("NOT FOUND: the service was reached and had nothing that matched")
                remember(key, Result.NotFound)
            }
            else -> {
                trace?.outcome("UNREACHABLE: no lyrics service could be asked")
                Result.Unreachable
            }
        }
    }

    private fun describe(r: Result): String = when (r) {
        is Result.Found -> "found from ${r.lyrics.source}, ${r.lyrics.lines.size} lines, timed=${r.lyrics.timed}"
        Result.NotFound -> "not found"
        Result.Unreachable -> "unreachable"
    }

    /** Forgets the lyrics and translations kept so far, so the next song is looked up afresh. Returns the saved translations removed. */
    fun clearCache(): Int {
        synchronized(cache) { cache.clear() }
        return translator?.clearCache() ?: 0
    }

    /** Adds the English (and Latin-letter) lines for a song in another language; the same lyrics back when it needs none. */
    suspend fun withTranslation(lyrics: Lyrics): Lyrics {
        val annotation = translator?.annotate(lyrics.lines.map { it.text }) ?: return lyrics
        return lyrics.copy(language = annotation.language, english = annotation.english, romanized = annotation.romanized)
    }

    private fun remember(key: String, result: Result): Result {
        synchronized(cache) { cache[key] = result }
        return result
    }

    /** Exact lookup first, then a search by fields, then a search by words; the first answer with a usable length wins. */
    private suspend fun lrclib(artist: String, title: String, durationSec: Long, trace: LyricsLog.Trace?): Lyrics? {
        if (artist.isNotBlank() && durationSec > 0) {
            val exact = "https://lrclib.net/api/get".toHttpUrl().newBuilder()
                .addQueryParameter("track_name", title).addQueryParameter("artist_name", artist)
                .addQueryParameter("duration", durationSec.toString()).build()
            trace?.note("  lrclib exact (title, artist, length ${durationSec}s)")
            val exactBody = request(exact.toString())
            if (exactBody == null) {
                trace?.note("    no exact match")
            } else {
                val o = try { JSONObject(exactBody) } catch (e: JSONException) { null }
                if (o != null) candidateLyrics(listOf(o), durationSec, trace, "exact")?.let { return it }
            }
        }
        val byFields = "https://lrclib.net/api/search".toHttpUrl().newBuilder().addQueryParameter("track_name", title)
            .apply { if (artist.isNotBlank()) addQueryParameter("artist_name", artist) }.build()
        trace?.note("  lrclib search by fields")
        searchLyrics(byFields.toString(), durationSec, trace, "by fields")?.let { return it }
        val byWords = "https://lrclib.net/api/search".toHttpUrl().newBuilder().addQueryParameter("q", "$artist $title".trim()).build()
        trace?.note("  lrclib search by words ${LyricsLog.quote("$artist $title".trim())}")
        return searchLyrics(byWords.toString(), durationSec, trace, "by words")
    }

    private suspend fun searchLyrics(url: String, durationSec: Long, trace: LyricsLog.Trace?, label: String): Lyrics? {
        val body = request(url) ?: return null
        val array = try { JSONArray(body) } catch (e: JSONException) { return null }
        return candidateLyrics((0 until array.length()).mapNotNull { array.optJSONObject(it) }, durationSec, trace, label)
    }

    private fun candidateLyrics(objects: List<JSONObject>, durationSec: Long, trace: LyricsLog.Trace?, label: String): Lyrics? {
        trace?.note("    $label: ${objects.size} result(s)")
        val candidates = objects.filter { !it.optBoolean("instrumental", false) }.map {
            Lrc.Candidate(
                it.optDouble("duration", 0.0), it.optString("syncedLyrics").ifBlank { null }, it.optString("plainLyrics").ifBlank { null },
                track = it.optString("trackName"), artist = it.optString("artistName"),
            )
        }
        val best = Lrc.pick(candidates, durationSec)
        if (trace != null) {
            for ((i, c) in candidates.take(12).withIndex()) {
                val verdict = when {
                    c === best -> "CHOSEN"
                    c.synced.isNullOrBlank() && c.plain.isNullOrBlank() -> "refused: no lyrics"
                    durationSec > 0 && kotlin.math.abs(c.durationSec - durationSec) > 6 -> "refused: length differs by ${kotlin.math.abs(c.durationSec - durationSec).toInt()}s"
                    else -> "not chosen: a closer or timed one won"
                }
                trace.note("      #${i + 1} ${LyricsLog.quote(c.track)} by ${LyricsLog.quote(c.artist)} ${c.durationSec.toInt()}s ${if (c.synced.isNullOrBlank()) "plain" else "timed"} -> $verdict")
            }
            if (candidates.size > 12) trace.note("      (${candidates.size - 12} more not listed)")
            if (objects.size > candidates.size) trace.note("      (${objects.size - candidates.size} instrumental result(s) skipped)")
        }
        if (best == null) return null
        best.synced?.let { synced ->
            val lines = Lrc.parse(synced).filter { it.text.isNotBlank() }
            if (lines.isNotEmpty()) return Lyrics(lines, timed = true, source = "LRCLIB")
        }
        val plain = Lrc.plainLines(best.plain ?: return null)
        return if (plain.isEmpty()) null else Lyrics(plain.map { Lrc.Line(0, it) }, timed = false, source = "LRCLIB")
    }

    private suspend fun lyricsOvh(artist: String, title: String): Lyrics? {
        val url = "https://api.lyrics.ovh/v1".toHttpUrl().newBuilder().addPathSegment(artist).addPathSegment(title).build()
        val body = request(url.toString()) ?: return null
        val text = try { JSONObject(body).optString("lyrics") } catch (e: JSONException) { return null }
        val plain = Lrc.plainLines(text)
        // A short scrap is not a song's words.
        return if (plain.size < 6) null else Lyrics(plain.map { Lrc.Line(0, it) }, timed = false, source = "lyrics.ovh")
    }

    /** The body, or null for "not found". Waits once when told to slow down; any other failure is an [IOException]. */
    private suspend fun request(url: String): String? {
        repeat(2) { attempt ->
            val request = Request.Builder().url(url).header("User-Agent", "Lumina-TV (https://github.com/nikhlgoel/lumina)").build()
            val code: Int
            val body: String
            http.newCall(request).execute().use { response ->
                code = response.code
                body = response.body?.string().orEmpty()
            }
            when {
                code in 200..299 -> return body
                code == 404 -> return null
                code == 429 && attempt == 0 -> delay(1500)
                else -> throw IOException("Lyrics service answered $code.")
            }
        }
        throw IOException("Lyrics service is busy.")
    }
}
