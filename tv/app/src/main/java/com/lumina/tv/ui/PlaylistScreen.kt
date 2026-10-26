package com.lumina.tv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.Text
import com.lumina.tv.Graph
import com.lumina.tv.core.Formatting
import com.lumina.tv.core.PlaylistLogic
import com.lumina.tv.data.FetchedPlaylist
import com.lumina.tv.data.MediaKind
import com.lumina.tv.data.PlaylistSource
import com.lumina.tv.data.Track
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** What a playlist card points at: enough to draw the page's header at once, while the songs load. */
data class PlaylistRef(val id: String, val source: PlaylistSource, val title: String, val thumbnail: String?, val count: Int = -1)

private sealed interface Load {
    data object Loading : Load
    data class Loaded(val fetched: FetchedPlaylist) : Load
    data class Failed(val message: String) : Load
}

/**
 * One playlist as a page: its cover, name and facts at the top, the actions (play, shuffle, keep on this device), and
 * every song in order underneath to pick from. Select on a song plays from there, and the rest of the list queues after it.
 */
@Composable
fun PlaylistScreen(graph: Graph, ref: PlaylistRef, open: (MediaKind) -> Unit) {
    val scope = rememberCoroutineScope()
    val synced by graph.playlistStore.playlists.collectAsStateWithLifecycle()
    val now by graph.player.now.collectAsStateWithLifecycle()
    val kept = synced.firstOrNull { it.id == ref.id }
    var load by remember(ref.id) { mutableStateOf<Load>(Load.Loading) }
    var attempt by remember { mutableIntStateOf(0) }
    var note by remember { mutableStateOf<String?>(null) }
    val playFocus = remember { FocusRequester() }

    LaunchedEffect(ref.id, attempt) {
        load = Load.Loading
        // A saved playlist opens at once from the songs kept for it, then is refreshed from the internet behind them. With
        // no connection the kept list still shows and plays (the songs stream, so playing needs the internet, but the page
        // and the list never come up empty).
        val cached = graph.playlists.cachedTracks(ref.id)
        val saved = graph.playlistStore.playlists.value.firstOrNull { it.id == ref.id }
        if (cached.isNotEmpty()) load = Load.Loaded(FetchedPlaylist(ref.title, cached, saved?.description, ref.thumbnail))
        load = try {
            val fresh = graph.playlists.preview(ref.id, ref.source, MediaKind.AUDIO)
            // A saved playlist keeps its list current: a song added to it later shows up here.
            if (saved != null && !saved.download) launch { runCatching { graph.playlists.sync(ref.id) } }
            Load.Loaded(fresh)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            if (cached.isNotEmpty()) Load.Loaded(FetchedPlaylist(ref.title, cached, saved?.description, ref.thumbnail)) else Load.Failed("Couldn't open this playlist. ${e.message.orEmpty()}".trim())
        }
    }
    LaunchedEffect(note) { if (note != null) { delay(6000); note = null } }
    // Focus lands on Play as soon as the page is up, so one more Select starts it.
    LaunchedEffect(Unit) { delay(80); runCatching { playFocus.requestFocus() } }

    val tracks = (load as? Load.Loaded)?.fetched?.tracks.orEmpty()
    val loaded = load is Load.Loaded && tracks.isNotEmpty()

    fun playFrom(list: List<Track>, index: Int) {
        graph.player.playStreamQueue(list, index)
        open(MediaKind.AUDIO)
    }

    /** Put this playlist in the person's playlists, without downloading anything. */
    fun save() {
        val fetched = (load as? Load.Loaded)?.fetched ?: return
        scope.launch {
            graph.playlists.save(ref.id, ref.source, MediaKind.AUDIO, fetched)
            note = "Added to your playlists. It's on Home and in Playlists now."
        }
    }

    /** Also copy its songs onto this device (a playlist not yet saved is saved first). */
    fun keep() {
        val fetched = (load as? Load.Loaded)?.fetched ?: return
        scope.launch {
            val free = graph.storage.activeRoot().freeBytes
            val bytes = PlaylistLogic.estimateAudioBytes(fetched.tracks.sumOf { it.durationSec })
            val all = free <= 0 || bytes < free * 7 / 10
            if (kept != null) graph.playlists.setDownload(ref.id, on = true, downloadExisting = all)
            else graph.playlists.add(ref.id, ref.source, MediaKind.AUDIO, fetched, all)
            note = if (all) "Keeping this playlist's songs on this device. They're downloading." else "Not enough room for every song, so only new songs will be kept. A USB drive adds room: see Settings."
        }
    }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 8.dp, bottom = 28.dp)) {
        item {
            Row(Modifier.fillMaxWidth().padding(bottom = 22.dp), horizontalArrangement = Arrangement.spacedBy(32.dp), verticalAlignment = Alignment.Bottom) {
                Thumb(ref.thumbnail, MediaKind.AUDIO, Modifier.width(300.dp).height(207.dp), shape = RoundedCornerShape(22.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("PLAYLIST", style = LuminaText.Small.copy(color = LuminaColors.Amber))
                    Text(ref.title, style = LuminaText.Display.copy(fontSize = 36.sp), maxLines = 2)
                    Text(
                        when (load) {
                            Load.Loading -> if (ref.count >= 0) "${Formatting.count(ref.count, "song")} · loading…" else "Loading…"
                            is Load.Failed -> "Couldn't load the songs"
                            is Load.Loaded -> listOfNotNull(
                                Formatting.count(tracks.size, "song"),
                                tracks.sumOf { it.durationSec }.takeIf { it > 0 }?.let { Formatting.duration(it) },
                                if (ref.source == PlaylistSource.ACCOUNT) "from your YouTube account" else "from a link",
                                if (kept?.download == true) "songs on this device" else null,
                            ).joinToString(" · ")
                        },
                        style = LuminaText.Body,
                    )
                    // The playlist's own description ("bio"), when its owner wrote one.
                    (load as? Load.Loaded)?.fetched?.description?.let { Text(it, style = LuminaText.Small, maxLines = 3) }
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        LButton("Play all", { if (loaded) playFrom(tracks, 0) }, icon = PlayerIcons.Play, primary = true, dimmed = !loaded, modifier = Modifier.focusRequester(playFocus))
                        LButton("Shuffle", { if (loaded) playFrom(tracks.shuffled(), 0) }, icon = PlayerIcons.Shuffle, dimmed = !loaded)
                        // Adding to your playlists and keeping the songs are two separate things.
                        if (kept == null && ref.source == PlaylistSource.PUBLIC) LButton("Add to my playlists", { if (loaded) save() }, icon = Icons.Filled.Add, dimmed = !loaded)
                        if (kept?.download == true) LButton("On this device", {}, icon = Icons.Filled.Check, dimmed = true)
                        else LButton("Keep songs on this device", { if (loaded) keep() }, icon = PlayerIcons.Download, dimmed = !loaded)
                    }
                    note?.let { Text(it, style = LuminaText.Small.copy(color = LuminaColors.Amber)) }
                }
            }
        }

        when (val l = load) {
            Load.Loading -> placeholderRows()
            is Load.Failed -> item { StateMessage("Couldn't open this playlist", l.message, "Try again", { attempt++ }, isError = true) }
            is Load.Loaded -> {
                if (tracks.isEmpty()) {
                    item { StateMessage("Nothing playable here", "This playlist is empty, or everything in it is private or deleted.") }
                }
                itemsIndexed(tracks, key = { i, t -> "$i-${t.id}" }) { index, t ->
                    val playing = now?.id == t.id
                    Column(Modifier.fillMaxWidth().background(LuminaColors.Surface, panelShape(index, tracks.size))) {
                        if (index > 0) PanelDivider()
                        FocusSurface(onClick = { playFrom(tracks, index) }, modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp), shape = RoundedCornerShape(16.dp), scaleOnFocus = 1f) {
                            Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                                Text("${index + 1}", style = LuminaText.Small, modifier = Modifier.width(44.dp))
                                Thumb(t.thumbnailUrl, t.kind, Modifier.size(width = 84.dp, height = 58.dp))
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                    Text(t.title, style = LuminaText.Row.copy(color = if (playing) LuminaColors.Amber else LuminaColors.Ink), maxLines = 1)
                                    if (t.artist.isNotBlank()) Text(t.artist, style = LuminaText.Small, maxLines = 1)
                                }
                                if (t.durationSec > 0) Text(Formatting.duration(t.durationSec), style = LuminaText.Small)
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Placeholder rows while the songs load: the list takes its shape before it has its content. */
private fun LazyListScope.placeholderRows() {
    items(6) { Shimmer(Modifier.fillMaxWidth().padding(bottom = 10.dp).height(78.dp), RoundedCornerShape(16.dp)) }
}
