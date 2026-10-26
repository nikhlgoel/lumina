package com.lumina.tv.core

/** The letters shown as a person's picture until they sign in and have a real one. Pure, so it is tested. */
object Initials {
    /**
     * The first letter of the first two words, upper-case: "Ada Lovelace" is "AL", "ada" is "A". Null when there is no
     * letter or digit to show (blank, or only punctuation), so the caller can draw a plain person icon instead.
     */
    fun of(name: String?): String? {
        val letters = name.orEmpty().trim()
            .split(Regex("\\s+"))
            .mapNotNull { word -> word.firstOrNull { it.isLetterOrDigit() } }
            .take(2)
        return letters.joinToString("") { it.uppercase() }.ifEmpty { null }
    }
}
