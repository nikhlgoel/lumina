package com.lumina.tv.data

import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * A record of how each song's lyrics were chosen, kept in a file that can be pulled off the stick with `adb pull`, so a wrong
 * match can be read from the log instead of photographed off the screen.
 *
 * One block per lookup: what the player asked for, every search variant that was tried, every candidate the lyrics service
 * returned (its own title, artist and length) with the reason it was accepted or refused, and the final outcome. It changes
 * nothing about how lyrics are chosen; it only writes down what happened. The file is capped (an older copy is kept), so it
 * can be left on for good.
 */
class LyricsLog(private val file: File, private val maxBytes: Long = 400_000) {

    /** Everything one lookup did, in order. Built while the lookup runs, written once at the end. */
    class Trace(private val title: String, private val artist: String, private val durationSec: Long, private val context: String) {
        private val lines = mutableListOf<String>()

        fun note(line: String) { lines += line }

        fun outcome(text: String) { lines += "=> $text" }

        /** The block as it is written to the file. */
        fun render(at: String): String = buildString {
            append(at).append("  LOOKUP  title=").append(quote(title)).append("  artist=").append(quote(artist))
                .append("  length=").append(if (durationSec > 0) "${durationSec}s" else "unknown").append('\n')
            if (context.isNotBlank()) append("  context: ").append(context).append('\n')
            for (l in lines) append("  ").append(l).append('\n')
        }
    }

    fun begin(title: String, artist: String, durationSec: Long, context: String = ""): Trace = Trace(title, artist, durationSec, context)

    /** Writes a finished trace. Never throws: a log that cannot be written must not break the lyrics. */
    @Synchronized
    fun write(trace: Trace) {
        try {
            file.parentFile?.mkdirs()
            if (file.exists() && file.length() > maxBytes) {
                val old = File(file.parentFile, file.name + ".1")
                old.delete()
                file.renameTo(old)
            }
            file.appendText(trace.render(timestamp()) + "\n")
        } catch (_: Exception) {
            // best effort
        }
    }

    private fun timestamp(): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date())

    companion object {
        /** A value in quotes with line breaks and quotes made harmless, so one value is always one readable token. */
        fun quote(value: String): String =
            "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\r", " ").replace("\n", " ").take(160) + "\""
    }
}
