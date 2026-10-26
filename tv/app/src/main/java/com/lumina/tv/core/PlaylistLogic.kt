package com.lumina.tv.core

/**
 * The decisions behind playlist syncing, with no network and no Android, so each can be tested.
 *
 * Syncing means: remember a playlist, and from time to time ask what is in it now; whatever was not
 * there before gets downloaded. Everything that can go wrong in that — a pasted link that is not a
 * playlist, a "mix" that changes every time you open it, a first sync that would fill the stick —
 * is decided here.
 */
object PlaylistLogic {
    sealed interface Parsed {
        data class Ok(val id: String) : Parsed
        /** A YouTube "Mix" or "Radio": generated on the fly, different each time, so there is nothing stable to sync. */
        data object Mix : Parsed
        data object Invalid : Parsed
    }

    private val listParam = Regex("[?&]list=([A-Za-z0-9_-]+)")
    private val bareId = Regex("^(PL|OLAK5uy_|UU|FL)[A-Za-z0-9_-]{10,}$")

    /**
     * Pull a playlist id out of whatever was pasted: a playlist link, a link to a video *in* a playlist
     * (`watch?v=…&list=…`), a music.youtube.com link, or the bare id.
     */
    fun parse(input: String): Parsed {
        val text = input.trim()
        if (text.isEmpty()) return Parsed.Invalid
        val id = listParam.find(text)?.groupValues?.get(1) ?: text.takeIf { bareId.matches(it) } ?: return Parsed.Invalid
        // "RD…" is a generated mix. It would "sync" to whatever YouTube felt like showing that day.
        if (id.startsWith("RD")) return Parsed.Mix
        return if (id.length >= 12 || id == "LL") Parsed.Ok(id) else Parsed.Invalid
    }

    fun canonicalUrl(id: String): String = "https://www.youtube.com/playlist?list=$id"

    /** YouTube Music files auto-generated tracks under "Artist - Topic"; the artist is the part before it. */
    fun cleanArtist(name: String?): String = name.orEmpty().removeSuffix(" - Topic").trim()

    private val htmlTag = Regex("</?[a-zA-Z][^>]*>")

    /**
     * A playlist's description as plain text. YouTube hands descriptions over with their links as raw HTML
     * (`Created with <a href="…">https://…</a>`), which showed up on screen as markup. Tags are dropped (the link's own text
     * stays), the few entities that appear are decoded, and runs of whitespace become one space. A "<" that is not a tag
     * ("I <3 this") is left alone. Blank in, null out.
     */
    fun plainText(html: String?): String? {
        val text = html.orEmpty().replace(htmlTag, "")
            .replace("&nbsp;", " ").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&amp;", "&")
            .replace(Regex("\\s+"), " ").trim()
        return text.ifEmpty { null }
    }

    /**
     * The ids in `listed` that have not been seen, in the order the playlist shows them, each once.
     * "Seen" is anything already synced *or* already in the library, so a song downloaded by hand is not fetched twice.
     */
    fun newIds(listed: List<String>, known: Set<String>): List<String> {
        val seen = HashSet(known)
        val out = ArrayList<String>()
        for (id in listed) if (id.isNotBlank() && seen.add(id)) out += id
        return out
    }

    /** Due when never synced, or when the interval has passed. A clock that went backwards counts as due, not as "never". */
    fun isDue(lastSyncMs: Long, nowMs: Long, intervalMs: Long): Boolean =
        lastSyncMs <= 0 || nowMs < lastSyncMs || nowMs - lastSyncMs >= intervalMs

    /** Rough size of the audio of a whole playlist at a typical streaming bitrate, so a big one can be questioned first. */
    fun estimateAudioBytes(totalSeconds: Long, kbps: Int = 128): Long = (totalSeconds.coerceAtLeast(0) * kbps * 1000L) / 8

    /** "just now", "12 min ago", "3 h ago", "2 days ago", or "never". */
    fun describeAge(lastMs: Long, nowMs: Long): String {
        if (lastMs <= 0) return "never"
        val seconds = ((nowMs - lastMs) / 1000).coerceAtLeast(0)
        return when {
            seconds < 60 -> "just now"
            seconds < 3600 -> "${seconds / 60} min ago"
            seconds < 86_400 -> "${seconds / 3600} h ago"
            else -> "${seconds / 86_400} day${if (seconds / 86_400 == 1L) "" else "s"} ago"
        }
    }
}
