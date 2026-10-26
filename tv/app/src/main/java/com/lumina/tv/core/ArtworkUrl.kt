package com.lumina.tv.core

/**
 * Asking for a picture at the size it will be shown.
 *
 * Search results carry small thumbnails (a couple of hundred pixels), which is right for a list row
 * and far too little for a full-screen cover: stretched to 840 px they look like a mosaic. YouTube
 * Music serves the same artwork at any size, chosen by a `=w226-h226` part at the end of the URL, so
 * a larger one is a matter of changing that number. Other hosts have no such rule and are left alone.
 */
object ArtworkUrl {
    private val sized = Regex("=w\\d+-h\\d+")

    fun large(url: String?, px: Int = 800): String? {
        if (url.isNullOrBlank()) return url
        val host = url.substringAfter("://").substringBefore('/').lowercase()
        val resizable = host.endsWith("googleusercontent.com") || host.endsWith("ggpht.com")
        return if (resizable && sized.containsMatchIn(url)) url.replace(sized, "=w$px-h$px") else url
    }
}
