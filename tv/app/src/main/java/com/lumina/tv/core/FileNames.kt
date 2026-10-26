package com.lumina.tv.core

/**
 * How Lumina names files on disk and on a USB drive.
 *
 * A port of `safeSegment` and `portableTargetFor` in the PC app (`src/core/portable.ts`). The two
 * must agree character for character, so that a file saved here and a file saved there are named
 * identically and a stick moves between them without renaming. That is enforced by one shared
 * fixture, `shared/contract/portable-names.json`, which both test suites read — change a rule on
 * one side and the other side's tests fail.
 */
object FileNames {
    const val PORTABLE_DIR = "LuminaMedia"

    /** Windows device names that cannot be a file name on FAT32, exFAT or NTFS. */
    private val reserved = Regex("^(con|prn|aux|nul|com[1-9]|lpt[1-9])$", RegexOption.IGNORE_CASE)

    /** Characters FAT32/exFAT reject, the ones Windows reserves, and control characters. */
    private val illegal = Regex("[<>:\"/\\\\|?*\\u0000-\\u001f]")
    private val whitespace = Regex("\\s+")
    private val trailing = Regex("[. ]+$")

    /**
     * One path segment that is safe on a FAT32/exFAT stick: illegal characters become spaces,
     * whitespace collapses, trailing dots and spaces go (Windows silently mangles them), reserved
     * device names get a leading underscore, and the length is capped so a deep path still fits.
     */
    fun safeSegment(raw: String, max: Int = 80): String {
        var name = raw.replace(illegal, " ").replace(whitespace, " ").trim()
        name = name.replace(trailing, "")
        if (name.isEmpty()) name = "Untitled"
        if (reserved.matches(name)) name = "_$name"
        if (name.length > max) {
            name = name.substring(0, max).replace(trailing, "")
            if (name.isEmpty()) name = "Untitled"
        }
        return name
    }

    /** `.ext` of the last path component, or "" when it has none (a leading dot is not an extension). */
    fun extensionOf(path: String): String {
        val base = path.substringAfterLast('/').substringAfterLast('\\')
        val dot = base.lastIndexOf('.')
        return if (dot > 0) base.substring(dot) else ""
    }

    /**
     * Where a single downloaded item belongs, relative to the drive root with `/` separators:
     * a song flat as `Music/Artist - Title.ext`, a video flat as `Videos/Title.ext`.
     *
     * Songs are never put in an Artist/Album folder here, matching the PC app, because a track
     * downloaded on its own has no album — and a television that lists folders turns a library
     * into hundreds of folders holding one song each.
     */
    fun targetFor(isAudio: Boolean, sourcePath: String, title: String, artist: String?): String {
        val ext = extensionOf(sourcePath)
        if (isAudio) {
            val name = if (!artist.isNullOrEmpty()) "$artist - $title" else title
            return "$PORTABLE_DIR/Music/${safeSegment(name, 110)}$ext"
        }
        return "$PORTABLE_DIR/Videos/${safeSegment(title, 110)}$ext"
    }
}
