package com.lumina.tv.core

import java.util.Locale

/** Text for numbers shown on screen. Pure, so it is testable and identical wherever it is used. */
object Formatting {
    /** "1 song", "2 songs", "0 songs": a count with its noun in the right number, so no screen ever says "1 songs". */
    fun count(n: Int, singular: String, plural: String = singular + "s"): String = "$n ${if (n == 1) singular else plural}"

    /** `3:07`, or `1:02:09` once past an hour. Negative or unknown becomes `0:00`. */
    fun duration(seconds: Long): String {
        val s = if (seconds < 0) 0 else seconds
        val h = s / 3600
        val m = (s % 3600) / 60
        val sec = s % 60
        return if (h > 0) String.format(Locale.US, "%d:%02d:%02d", h, m, sec)
        else String.format(Locale.US, "%d:%02d", m, sec)
    }

    /**
     * How a title or a name is shown under or over a picture: all lowercase, a softer look than mixed capitals. Display only (the
     * stored title is untouched). Uses the root locale, so a Turkish "I" is not turned into a dotless one; scripts without
     * capitals (Hindi, Korean, Chinese) come out as they went in.
     */
    fun caption(text: String): String = text.lowercase(Locale.ROOT)

    /** A long span in a word or two: `45 min`, `1 h 20 min`, `30 h`. For a playlist's total length, where seconds are noise. */
    fun durationShort(seconds: Long): String {
        val minutes = (if (seconds < 0) 0 else seconds) / 60
        val h = minutes / 60
        val m = minutes % 60
        return when {
            h == 0L -> "$m min"
            h >= 10 || m == 0L -> "$h h"
            else -> "$h h $m min"
        }
    }

    fun bytes(n: Long): String {
        if (n < 0) return "—"
        val units = listOf("B", "KB", "MB", "GB", "TB")
        var value = n.toDouble()
        var i = 0
        while (value >= 1024 && i < units.lastIndex) { value /= 1024; i++ }
        return if (i == 0) "$n B" else String.format(Locale.US, if (value >= 100) "%.0f %s" else "%.1f %s", value, units[i])
    }

    fun speed(bytesPerSecond: Long): String = if (bytesPerSecond <= 0) "—" else "${bytes(bytesPerSecond)}/s"

    /** The bitrate of a stream as a person reads it: `128 kbps`, `1.2 Mbps`, or `unknown`. */
    fun kbps(value: Int?): String = when {
        value == null || value <= 0 -> "unknown"
        value >= 1000 -> String.format(Locale.US, "%.1f Mbps", value / 1000.0)
        else -> "$value kbps"
    }
}
