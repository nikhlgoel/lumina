package com.lumina.tv.core

import java.net.URLDecoder

/**
 * Reading what a phone or laptop sends to the TV's setup page. The page is a plain HTML form, so the
 * body is `application/x-www-form-urlencoded`. This is the only input from the network the app parses
 * itself, so it is deliberately small and strict: bounded in size and count, never throws, and a
 * malformed piece is dropped rather than guessed at.
 */
object Forms {
    private const val MAX_FIELDS = 32
    private const val MAX_FIELD_CHARS = 4096

    fun parse(body: String): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        for (pair in body.split('&')) {
            if (out.size >= MAX_FIELDS) break
            if (pair.isEmpty()) continue
            val eq = pair.indexOf('=')
            val rawKey = if (eq < 0) pair else pair.substring(0, eq)
            val rawValue = if (eq < 0) "" else pair.substring(eq + 1)
            val key = decode(rawKey) ?: continue
            val value = decode(rawValue) ?: continue
            if (key.isEmpty() || key.length > MAX_FIELD_CHARS || value.length > MAX_FIELD_CHARS) continue
            out[key] = value
        }
        return out
    }

    /** `%`-decoding with `+` as space; null for a broken escape such as `%zz` instead of throwing. */
    private fun decode(raw: String): String? = try {
        URLDecoder.decode(raw, "UTF-8")
    } catch (e: IllegalArgumentException) {
        null
    }

    /** Compares without stopping at the first difference, so how long it took says nothing about how much matched. */
    fun constantTimeEquals(a: String, b: String): Boolean {
        val x = a.toByteArray(Charsets.UTF_8)
        val y = b.toByteArray(Charsets.UTF_8)
        var diff = x.size xor y.size
        for (i in 0 until maxOf(x.size, y.size)) {
            diff = diff or ((x.getOrElse(i) { 0 }.toInt()) xor (y.getOrElse(i) { 0 }.toInt()))
        }
        return diff == 0
    }

    /** Escapes text for placing inside HTML, so something typed into the form cannot become markup on the page. */
    fun escapeHtml(text: String): String = buildString(text.length) {
        for (c in text) when (c) {
            '&' -> append("&amp;")
            '<' -> append("&lt;")
            '>' -> append("&gt;")
            '"' -> append("&quot;")
            '\'' -> append("&#39;")
            else -> append(c)
        }
    }
}
