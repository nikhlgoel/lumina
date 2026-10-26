package com.lumina.tv.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.IOException

/**
 * The signed-in person's own playlists, through YouTube's official Data API (read-only).
 *
 * Used for what the public side cannot see — private playlists and Liked videos — and for showing a
 * list to pick from instead of making someone copy links. Public and unlisted playlists never need it:
 * they sync from their link without signing in.
 */
class YouTubeApi(
    private val http: OkHttpClient,
    private val auth: GoogleAuth,
    private val base: String = BASE,
) {
    data class AccountPlaylist(val id: String, val title: String, val itemCount: Int, val thumbnail: String? = null, val isLikes: Boolean = false)
    data class Channel(val name: String, val avatar: String?)
    data class Entry(val videoId: String, val title: String, val channel: String, val thumbnail: String?)

    /** A failure with a message already fit to show: quota, a disabled API, a revoked sign-in. */
    class ApiException(message: String) : IOException(message)

    /** Everything on the account worth syncing: Liked videos first, then each playlist. */
    suspend fun myPlaylists(): List<AccountPlaylist> {
        val out = ArrayList<AccountPlaylist>()
        likedPlaylistId()?.let { out += AccountPlaylist(it, "Liked videos", -1, isLikes = true) }
        var page: String? = null
        do {
            val json = get("playlists", mapOf("part" to "snippet,contentDetails", "mine" to "true", "maxResults" to "50", "pageToken" to page))
            val (items, next) = parsePlaylists(json)
            out += items
            page = next
        } while (page != null && out.size < MAX_PLAYLISTS)
        return out
    }

    /**
     * The cover for a list that has none of its own (Liked videos, or a playlist YouTube gave no picture): the
     * picture of its first video. One small request, so every card on the page can show artwork.
     */
    suspend fun firstThumbnail(playlistId: String): String? = items(playlistId, limit = 1).firstOrNull()?.thumbnail

    /** What is in one playlist now, in order, with private and deleted entries left out. */
    suspend fun items(playlistId: String, limit: Int = MAX_ITEMS): List<Entry> {
        val out = ArrayList<Entry>()
        var page: String? = null
        do {
            val json = get("playlistItems", mapOf("part" to "snippet,contentDetails", "playlistId" to playlistId, "maxResults" to "50", "pageToken" to page))
            val (entries, next) = parseItems(json)
            out += entries
            page = next
        } while (page != null && out.size < limit)
        return out
    }

    /** How many of a playlist's first videos are in YouTube's Music category, and how many were looked at (two small requests). */
    suspend fun musicShare(playlistId: String, sample: Int): Pair<Int, Int> {
        val ids = items(playlistId, limit = sample).take(sample).map { it.videoId }
        if (ids.isEmpty()) return 0 to 0
        val json = get("videos", mapOf("part" to "snippet", "id" to ids.joinToString(","), "maxResults" to "50"))
        val categories = (0 until (json.optJSONArray("items")?.length() ?: 0)).mapNotNull {
            json.optJSONArray("items")?.optJSONObject(it)?.optJSONObject("snippet")?.optString("categoryId")
        }
        return categories.count { it == com.lumina.tv.core.PlaylistKinds.MUSIC_CATEGORY } to categories.size
    }

    /** The signed-in account's YouTube channel: its name and profile picture (what YouTube itself shows as the account's picture). */
    suspend fun myChannel(): Channel? {
        val json = get("channels", mapOf("part" to "snippet", "mine" to "true"))
        val snippet = json.optJSONArray("items")?.optJSONObject(0)?.optJSONObject("snippet") ?: return null
        val name = snippet.optString("title").takeIf { it.isNotBlank() } ?: return null
        return Channel(name, bestThumbnail(snippet))
    }

    private suspend fun likedPlaylistId(): String? {
        val json = get("channels", mapOf("part" to "contentDetails", "mine" to "true"))
        return json.optJSONArray("items")?.optJSONObject(0)?.optJSONObject("contentDetails")
            ?.optJSONObject("relatedPlaylists")?.optString("likes")?.takeIf { it.isNotBlank() }
    }

    private suspend fun get(path: String, params: Map<String, String?>): JSONObject {
        val token = auth.accessToken()
        val url = "$base/$path".toHttpUrl().newBuilder().apply { for ((k, v) in params) if (v != null) addQueryParameter(k, v) }.build()
        return withContext(Dispatchers.IO) {
            http.newCall(Request.Builder().url(url).header("Authorization", "Bearer $token").build()).execute().use { response ->
                val text = response.body?.string().orEmpty()
                val json = runCatching { JSONObject(text) }.getOrNull()
                if (response.isSuccessful && json != null) return@use json
                throw ApiException(explain(response.code, json))
            }
        }
    }

    private fun explain(code: Int, json: JSONObject?): String {
        val error = json?.optJSONObject("error")
        val reason = error?.optJSONArray("errors")?.optJSONObject(0)?.optString("reason").orEmpty()
        return when {
            reason == "quotaExceeded" || reason == "rateLimitExceeded" -> "YouTube's daily limit for this account's project is used up. It resets at midnight Pacific time."
            reason == "accessNotConfigured" || error?.optString("message").orEmpty().contains("has not been used in project") ->
                "YouTube Data API v3 isn't switched on for your Google Cloud project. Enable it, then try again."
            code == 401 -> "Google refused the saved sign-in. Sign in again."
            code == 403 -> "Google said no (${reason.ifEmpty { "forbidden" }})."
            code == 404 -> "That playlist wasn't found. It may have been deleted or made private."
            else -> error?.optString("message")?.takeIf { it.isNotBlank() } ?: "YouTube error $code."
        }
    }

    companion object {
        const val BASE = "https://www.googleapis.com/youtube/v3"
        private const val MAX_PLAYLISTS = 200
        private const val MAX_ITEMS = 5000
        private val hidden = setOf("Private video", "Deleted video")

        fun parsePlaylists(json: JSONObject): Pair<List<AccountPlaylist>, String?> {
            val arr = json.optJSONArray("items")
            val list = (0 until (arr?.length() ?: 0)).mapNotNull { i ->
                val o = arr?.optJSONObject(i) ?: return@mapNotNull null
                val id = o.optString("id").takeIf { it.isNotBlank() } ?: return@mapNotNull null
                AccountPlaylist(
                    id = id,
                    title = o.optJSONObject("snippet")?.optString("title").orEmpty().ifBlank { "Untitled playlist" },
                    itemCount = o.optJSONObject("contentDetails")?.optInt("itemCount", -1) ?: -1,
                    thumbnail = bestThumbnail(o.optJSONObject("snippet")),
                )
            }
            return list to json.optString("nextPageToken").takeIf { it.isNotBlank() }
        }

        /** The largest picture YouTube lists for a playlist or video, or null when there is none. */
        fun bestThumbnail(snippet: JSONObject?): String? {
            val t = snippet?.optJSONObject("thumbnails") ?: return null
            for (size in listOf("maxres", "standard", "high", "medium", "default")) {
                t.optJSONObject(size)?.optString("url")?.takeIf { it.isNotBlank() }?.let { return it }
            }
            return null
        }

        fun parseItems(json: JSONObject): Pair<List<Entry>, String?> {
            val arr = json.optJSONArray("items")
            val list = (0 until (arr?.length() ?: 0)).mapNotNull { i ->
                val o = arr?.optJSONObject(i) ?: return@mapNotNull null
                val snippet = o.optJSONObject("snippet") ?: return@mapNotNull null
                val title = snippet.optString("title")
                val id = o.optJSONObject("contentDetails")?.optString("videoId").orEmpty()
                    .ifBlank { snippet.optJSONObject("resourceId")?.optString("videoId").orEmpty() }
                if (id.isBlank() || title.isBlank() || title in hidden) return@mapNotNull null
                val thumbs = snippet.optJSONObject("thumbnails")
                val thumb = listOf("maxres", "standard", "high", "medium", "default").firstNotNullOfOrNull { thumbs?.optJSONObject(it)?.optString("url")?.takeIf { u -> u.isNotBlank() } }
                Entry(id, title, snippet.optString("videoOwnerChannelTitle"), thumb)
            }
            return list to json.optString("nextPageToken").takeIf { it.isNotBlank() }
        }
    }
}
