package com.lumina.tv.data

import com.lumina.tv.core.Lrc
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.URLEncoder
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * For a song sung in another language: its lines in English, and (when the script is not Latin) the same lines in
 * Latin letters, so the words can be read and sung along with by someone who cannot read the script.
 *
 * Uses the free translation endpoint Google's own Chrome extension uses; it needs no account but is not a documented
 * API, so it can change or refuse, and then the lyrics simply show without a translation. A translation of poetry
 * is approximate, and the screen says so. Each song is done once and kept on disk.
 */
class LyricsTranslator(client: OkHttpClient, private val dir: File?) {
    /** [english] and [romanized] have one entry per lyric line; an entry is null when it adds nothing (already English). */
    data class Annotation(val language: String, val english: List<String?>, val romanized: List<String?>?)

    private val http = client.newBuilder().callTimeout(9, TimeUnit.SECONDS).build()

    /** Forgets every saved translation (Settings: Clear lyrics cache). Returns how many files were removed. */
    fun clearCache(): Int = dir?.listFiles()?.count { it.delete() } ?: 0

    /** Null when the lyrics are English, or when no translation could be had (never cached, so it is tried again). */
    suspend fun annotate(lines: List<String>): Annotation? = withContext(Dispatchers.IO) {
        if (lines.isEmpty()) return@withContext null
        val key = sha1(lines.joinToString("\n"))
        readCache(key)?.let { return@withContext it.takeIf { a -> a.language != ENGLISH } }
        val result = try {
            compute(lines)
        } catch (e: IOException) {
            return@withContext null
        }
        writeCache(key, result)
        result.takeIf { it.language != ENGLISH }
    }

    private fun compute(lines: List<String>): Annotation {
        val chunks = chunk(lines)
        // First pass lets the service detect the language line by line; the vote decides what the song is in.
        val pass1 = chunks.flatMap { translate(it, "auto") }
        val votes = pass1.mapNotNull { it.second }.filter { it.isNotBlank() }.groupingBy { it }.eachCount()
        val language = votes.maxByOrNull { it.value }?.key ?: ENGLISH
        val englishShare = (votes[ENGLISH] ?: 0).toDouble() / pass1.size.coerceAtLeast(1)
        if (language == ENGLISH || englishShare >= 0.6) return Annotation(ENGLISH, emptyList(), null)

        val latin = Lrc.mostlyLatin(lines)
        // Lyrics written in Latin letters (romanised Hindi, say) are misread line by line, so the song's language, found
        // from all its lines together, is given for a second pass.
        val translated = if (latin) chunks.flatMap { translate(it, language) } else pass1
        val english = lines.indices.map { i -> translated.getOrNull(i)?.first?.takeIf { differs(lines[i], it) } }
        val romanized = if (latin) null else chunks.map { romanize(it) }.let { parts -> if (parts.any { it == null }) null else parts.flatMap { it!! } }
        return Annotation(language, english, romanized)
    }

    /** One request for a few lines: each comes back with its translation and the language it was detected as. */
    private fun translate(lines: List<String>, from: String): List<Pair<String, String?>> {
        val url = "https://clients5.google.com/translate_a/t".toHttpUrl().newBuilder()
            .addQueryParameter("client", "dict-chrome-ex").addQueryParameter("sl", from).addQueryParameter("tl", "en")
            .apply { for (l in lines) addQueryParameter("q", l) }.build()
        val array = try { JSONArray(get(url.toString())) } catch (e: org.json.JSONException) { throw IOException("Unreadable translation.") }
        if (array.length() != lines.size) throw IOException("Translation came back with ${array.length()} of ${lines.size} lines.")
        return (0 until array.length()).map { i ->
            when (val item = array.get(i)) {
                is JSONArray -> item.optString(0) to item.optString(1).ifBlank { null }
                else -> item.toString() to null
            }
        }
    }

    /** The lines in Latin letters, or null when the service did not send them in step with the lines. */
    private fun romanize(lines: List<String>): List<String>? {
        val url = "https://clients5.google.com/translate_a/single".toHttpUrl().newBuilder()
            .addQueryParameter("client", "dict-chrome-ex").addQueryParameter("sl", "auto").addQueryParameter("tl", "en")
            .addQueryParameter("dt", "t").addQueryParameter("dt", "rm").addQueryParameter("q", lines.joinToString("\n")).build()
        val segments = try { JSONArray(get(url.toString())).optJSONArray(0) } catch (e: org.json.JSONException) { null } ?: return null
        for (i in 0 until segments.length()) {
            val item = segments.optJSONArray(i) ?: continue
            if (item.isNull(0) && item.isNull(1) && !item.isNull(3)) {
                val rom = item.optString(3).split('\n')
                return rom.takeIf { it.size == lines.size }?.map { it.trim() }
            }
        }
        return null
    }

    private fun get(url: String): String {
        val request = Request.Builder().url(url).header("User-Agent", "Mozilla/5.0").build()
        return http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IOException("Translation service answered ${response.code}.")
            response.body?.string().orEmpty()
        }
    }

    /** Groups of lines small enough for one request's address (non-Latin text grows ninefold when percent-encoded). */
    private fun chunk(lines: List<String>): List<List<String>> {
        val out = ArrayList<List<String>>()
        var current = ArrayList<String>()
        var size = 0
        for (line in lines) {
            val cost = URLEncoder.encode(line, "UTF-8").length + 3
            if (current.isNotEmpty() && (size + cost > 1800 || current.size >= 24)) { out += current; current = ArrayList(); size = 0 }
            current += line
            size += cost
        }
        if (current.isNotEmpty()) out += current
        return out
    }

    private fun differs(original: String, translated: String): Boolean {
        fun norm(s: String) = s.lowercase().filter { it.isLetterOrDigit() }
        return norm(original) != norm(translated) && translated.isNotBlank()
    }

    private fun sha1(text: String): String = MessageDigest.getInstance("SHA-1").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }

    private fun readCache(key: String): Annotation? {
        val file = dir?.let { File(it, "$key.json") }?.takeIf { it.isFile } ?: return null
        return try {
            val o = JSONObject(file.readText())
            fun list(name: String): List<String?>? = o.optJSONArray(name)?.let { a -> (0 until a.length()).map { if (a.isNull(it)) null else a.getString(it) } }
            Annotation(o.getString("lang"), list("en").orEmpty(), list("rm"))
        } catch (e: Exception) {
            null
        }
    }

    private fun writeCache(key: String, a: Annotation) {
        val folder = dir ?: return
        runCatching {
            folder.mkdirs()
            val o = JSONObject().put("lang", a.language).put("en", JSONArray(a.english.map { it ?: JSONObject.NULL }))
            a.romanized?.let { o.put("rm", JSONArray(it)) }
            File(folder, "$key.json").writeText(o.toString())
        }
    }

    companion object {
        const val ENGLISH = "en"
    }
}
