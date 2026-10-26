package com.lumina.tv.data

import android.content.Context
import com.lumina.tv.core.Countries
import com.lumina.tv.core.EqPreset
import com.lumina.tv.core.StreamPicker

/** The handful of choices a person can change. Stored plainly; none of it is sensitive. */
class AppSettings(context: Context) {
    private val prefs = context.getSharedPreferences("lumina", Context.MODE_PRIVATE)

    /** Where downloads go: [INTERNAL] or the id of a removable volume (see [Storage]). */
    /** Drives (by id) the person has already been asked about, so each is offered once however often it is re-plugged. */
    var askedDrives: Set<String>
        get() = prefs.getStringSet("asked_drives", emptySet()).orEmpty()
        set(value) { prefs.edit().putStringSet("asked_drives", value).apply() }

    var storageRoot: String
        get() = prefs.getString(KEY_ROOT, INTERNAL) ?: INTERNAL
        set(value) { prefs.edit().putString(KEY_ROOT, value).apply() }

    /**
     * The tallest picture to stream. 1080p is the default: it is what a 1080p screen shows anyway,
     * and the stick's 2 GB of memory decodes it comfortably. 4K is available for those who want it.
     */
    var playHeight: Int
        get() = prefs.getInt(KEY_PLAY_HEIGHT, 1080)
        set(value) { prefs.edit().putInt(KEY_PLAY_HEIGHT, value).apply() }

    /** The tallest video to save. Lower than playback because storage on a stick is small. */
    var downloadHeight: Int
        get() = prefs.getInt(KEY_DOWNLOAD_HEIGHT, 720)
        set(value) { prefs.edit().putInt(KEY_DOWNLOAD_HEIGHT, value).apply() }

    /** The last few searches, newest first, so the search screen is never an empty box (typing is slow on a remote). */
    var recentSearches: List<String>
        get() = prefs.getString(KEY_RECENT, "").orEmpty().split('\n').filter { it.isNotBlank() }
        set(value) { prefs.edit().putString(KEY_RECENT, value.joinToString("\n")).apply() }

    fun rememberSearch(query: String) {
        val q = query.trim().replace('\n', ' ')
        if (q.isEmpty()) return
        recentSearches = (listOf(q) + recentSearches.filterNot { it.equals(q, ignoreCase = true) }).take(MAX_RECENT)
    }

    fun clearRecentSearches() { recentSearches = emptyList() }

    /**
     * The caption language the person last chose in a video, remembered for the next one; null means captions off, which
     * is also the start. Written once when they pick from the subtitles menu.
     */
    var subtitleLanguage: String?
        get() = prefs.getString(KEY_SUBTITLE_LANGUAGE, null)
        set(value) { prefs.edit().apply { if (value == null) remove(KEY_SUBTITLE_LANGUAGE) else putString(KEY_SUBTITLE_LANGUAGE, value) }.apply() }

    /**
     * The country whose music the Shuffle button reaches for first, and the region the extractor searches in. Until
     * the person picks one it is the device's own country when we know it, else the United States.
     */
    var contentCountry: String
        get() = prefs.getString(KEY_COUNTRY, null) ?: Countries.defaultFor(java.util.Locale.getDefault().country).code
        set(value) { prefs.edit().putString(KEY_COUNTRY, value).apply() }

    /** True once the first-run welcome has been answered (a name given, signed in, or skipped), so it is never asked twice. */
    var onboarded: Boolean
        get() = prefs.getBoolean(KEY_ONBOARDED, false)
        set(value) { prefs.edit().putBoolean(KEY_ONBOARDED, value).apply() }

    /** What to call the person: the name typed at the welcome, or the YouTube channel name once signed in. Its initials are the picture until there is a real one. */
    var profileName: String?
        get() = prefs.getString(KEY_PROFILE_NAME, null)?.takeIf { it.isNotBlank() }
        set(value) { prefs.edit().apply { if (value.isNullOrBlank()) remove(KEY_PROFILE_NAME) else putString(KEY_PROFILE_NAME, value.trim()) }.apply() }

    /** The signed-in account's picture, kept so the top of the screen has it the moment the app opens, before the network answers. */
    var profileAvatar: String?
        get() = prefs.getString(KEY_PROFILE_AVATAR, null)?.takeIf { it.isNotBlank() }
        set(value) { prefs.edit().apply { if (value.isNullOrBlank()) remove(KEY_PROFILE_AVATAR) else putString(KEY_PROFILE_AVATAR, value) }.apply() }

    /** How good the streamed sound is (see [StreamPicker.AudioQuality]); downloads always keep the best. */
    var audioQuality: StreamPicker.AudioQuality
        get() = runCatching { StreamPicker.AudioQuality.valueOf(prefs.getString(KEY_AUDIO_QUALITY, null).orEmpty()) }.getOrDefault(StreamPicker.AudioQuality.BEST)
        set(value) { prefs.edit().putString(KEY_AUDIO_QUALITY, value.name).apply() }

    /** A deeper sound buffer (1-2 s instead of 0.5-1 s): fewer breaks on a busy stick, a little more delay when seeking. Read at start. */
    var audioBufferLarge: Boolean
        get() = prefs.getBoolean(KEY_AUDIO_BUFFER, false)
        set(value) { prefs.edit().putBoolean(KEY_AUDIO_BUFFER, value).apply() }

    var equalizer: EqPreset
        get() = runCatching { EqPreset.valueOf(prefs.getString(KEY_EQ, null).orEmpty()) }.getOrDefault(EqPreset.OFF)
        set(value) { prefs.edit().putString(KEY_EQ, value.name).apply() }

    /** Subtitle size: 0 small, 1 medium, 2 large. */
    var subtitleSize: Int
        get() = prefs.getInt(KEY_SUBTITLE_SIZE, 1).coerceIn(0, 2)
        set(value) { prefs.edit().putInt(KEY_SUBTITLE_SIZE, value.coerceIn(0, 2)).apply() }

    /** Seconds of quiet before the player's controls fade. */
    var controlsHideSeconds: Int
        get() = prefs.getInt(KEY_CONTROLS_HIDE, 4).coerceIn(2, 30)
        set(value) { prefs.edit().putInt(KEY_CONTROLS_HIDE, value.coerceIn(2, 30)).apply() }

    /** Lyrics of a song in another language: show the English meaning under each line, and the Latin-letter reading. */
    var lyricsTranslate: Boolean
        get() = prefs.getBoolean(KEY_LYRICS_TRANSLATE, true)
        set(value) { prefs.edit().putBoolean(KEY_LYRICS_TRANSLATE, value).apply() }

    var lyricsLatin: Boolean
        get() = prefs.getBoolean(KEY_LYRICS_LATIN, true)
        set(value) { prefs.edit().putBoolean(KEY_LYRICS_LATIN, value).apply() }

    /** The animation when the app opens. */
    var openingAnimation: Boolean
        get() = prefs.getBoolean(KEY_OPENING, true)
        set(value) { prefs.edit().putBoolean(KEY_OPENING, value).apply() }

    /** Remember what was played (Home's "Recently played", Music > History). Off: nothing new is recorded. Default on. */
    var saveHistory: Boolean
        get() = prefs.getBoolean(KEY_SAVE_HISTORY, true)
        set(value) { prefs.edit().putBoolean(KEY_SAVE_HISTORY, value).apply() }

    /** The page takes its colour from the artwork of what is playing. Off: one steady colour (lighter on a slow stick). */
    var ambientColour: Boolean
        get() = prefs.getBoolean(KEY_AMBIENT, true)
        set(value) { prefs.edit().putBoolean(KEY_AMBIENT, value).apply() }

    /** Where Lumina opens: 0 Home, 1 Music, 2 Videos. */
    var startPage: Int
        get() = prefs.getInt(KEY_START_PAGE, 0).coerceIn(0, 2)
        set(value) { prefs.edit().putInt(KEY_START_PAGE, value.coerceIn(0, 2)).apply() }

    companion object {
        private const val KEY_SAVE_HISTORY = "saveHistory"
        private const val KEY_AMBIENT = "ambientColour"
        private const val KEY_START_PAGE = "startPage"
        private const val KEY_AUDIO_QUALITY = "audioQuality"
        private const val KEY_AUDIO_BUFFER = "audioBufferLarge"
        private const val KEY_EQ = "equalizer"
        private const val KEY_SUBTITLE_SIZE = "subtitleSize"
        private const val KEY_CONTROLS_HIDE = "controlsHideSeconds"
        private const val KEY_LYRICS_TRANSLATE = "lyricsTranslate"
        private const val KEY_LYRICS_LATIN = "lyricsLatin"
        private const val KEY_OPENING = "openingAnimation"
        private const val KEY_ONBOARDED = "onboarded"
        private const val KEY_PROFILE_NAME = "profileName"
        private const val KEY_PROFILE_AVATAR = "profileAvatar"
        private const val KEY_COUNTRY = "contentCountry"
        private const val KEY_SUBTITLE_LANGUAGE = "subtitleLanguage"
        private const val KEY_RECENT = "recentSearches"
        private const val MAX_RECENT = 8
        const val INTERNAL = "internal"
        private const val KEY_ROOT = "storageRoot"
        private const val KEY_PLAY_HEIGHT = "playHeight"
        private const val KEY_DOWNLOAD_HEIGHT = "downloadHeight"
        val heights = listOf(360, 480, 720, 1080, 1440, 2160)
    }
}
