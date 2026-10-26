package com.lumina.tv.data

import com.lumina.tv.core.PlaylistKind
import com.lumina.tv.core.PlaylistKinds
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.IOException

/**
 * The signed-in person's YouTube playlists, loaded once and shared by Home and the Playlists page, so both show
 * every playlist on the account (not only the ones copied onto the stick) and neither waits on the network twice.
 */
class AccountPlaylistsRepo(
    private val api: YouTubeApi,
    private val cache: android.content.SharedPreferences? = null,
    private val signedIn: () -> Boolean,
) {
    /**
     * What each playlist mostly holds, found by looking at the categories of its first videos and remembered on disk
     * (the answer rarely changes, and each costs two requests). Home's Music and Videos filters use it.
     */
    private val kindState = MutableStateFlow(readCache())
    val kinds: StateFlow<Map<String, PlaylistKind>> = kindState.asStateFlow()

    private fun readCache(): Map<String, PlaylistKind> =
        cache?.getStringSet("kinds", emptySet()).orEmpty().mapNotNull {
            val (id, kind) = it.split('|', limit = 2).takeIf { p -> p.size == 2 } ?: return@mapNotNull null
            runCatching { id to PlaylistKind.valueOf(kind) }.getOrNull()
        }.toMap()

    private suspend fun classify(lists: List<YouTubeApi.AccountPlaylist>, redo: Boolean) {
        for (l in lists) {
            if (l.isLikes) { kindState.value = kindState.value + (l.id to PlaylistKind.VIDEO); continue }
            if (!redo && l.id in kindState.value) continue
            val kind = try {
                val (music, sampled) = api.musicShare(l.id, PlaylistKinds.SAMPLE)
                PlaylistKinds.classify(false, music, sampled)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                continue
            }
            kindState.value = kindState.value + (l.id to kind)
        }
        cache?.edit()?.putStringSet("kinds", kindState.value.map { "${it.key}|${it.value.name}" }.toSet())?.apply()
    }

    sealed interface State {
        data object Idle : State
        data object Loading : State
        data class Loaded(val lists: List<YouTubeApi.AccountPlaylist>) : State
        data class Failed(val message: String) : State
    }

    private val state = MutableStateFlow<State>(State.Idle)
    val flow: StateFlow<State> = state.asStateFlow()
    private val lock = Mutex()

    /** Loads when not yet loaded (or when [force]d); a list already on screen stays there while it refreshes. */
    suspend fun load(force: Boolean = false) {
        if (!signedIn()) { state.value = State.Idle; return }
        if (!force && state.value is State.Loaded) return
        lock.withLock {
            if (!force && state.value is State.Loaded) return
            if (state.value !is State.Loaded) state.value = State.Loading
            try {
                val lists = withCovers(api.myPlaylists())
                state.value = State.Loaded(lists)
                // Likes are known at once; the rest are looked at one by one, and Home updates as each answer arrives.
                classify(lists, redo = force)
            } catch (e: CancellationException) {
                throw e
            } catch (e: IOException) {
                if (state.value !is State.Loaded) state.value = State.Failed(e.message ?: "Couldn't load your playlists.")
            }
        }
    }

    fun clear() { state.value = State.Idle }

    /**
     * A list YouTube gave no picture for (Liked videos, or one with the grey default) borrows its first video's
     * cover, so every card has artwork. Only the first few: the rest are off-screen, and each costs one request.
     */
    private suspend fun withCovers(lists: List<YouTubeApi.AccountPlaylist>): List<YouTubeApi.AccountPlaylist> = coroutineScope {
        lists.mapIndexed { i, l ->
            async { if (l.thumbnail == null && i < 30) l.copy(thumbnail = runCatching { api.firstThumbnail(l.id) }.getOrNull()) else l }
        }.awaitAll()
    }
}
