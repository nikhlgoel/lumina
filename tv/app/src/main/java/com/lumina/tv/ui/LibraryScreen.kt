package com.lumina.tv.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.PlaylistPlay
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.Icon
import androidx.tv.material3.Text
import com.lumina.tv.Graph
import com.lumina.tv.core.Formatting
import com.lumina.tv.data.MediaKind
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.random.Random

/**
 * Everything you keep, in one place: Library replaces what used to be four separate sidebar entries.
 * Each section carries its own colour — real YouTube's Library screen (checked live, signed in, on a
 * real Fire TV Stick, 2026-10-23; see docs/18) uses solid colour blocks instead of cards for its top-level
 * categories (History purple, Watch Later teal, Playlists green, Music orange...), not a row of identical
 * pills. These four colours are Lumina's own, chosen to read clearly on the dark background and stay
 * distinct from [LuminaColors.Amber] (the one colour reserved for "this is playing" / primary actions,
 * so a category chip is never mistaken for that).
 */
enum class LibrarySection(val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector, val chipColor: Color) {
    Music("Music", Icons.Filled.MusicNote, Color(0xFFB8562B)),
    Videos("Videos", Icons.Filled.VideoLibrary, Color(0xFF1E6F63)),
    Playlists("Playlists", Icons.Filled.PlaylistPlay, Color(0xFF5B4FA0)),
    Downloads("Downloads", Icons.Filled.Download, Color(0xFF2E7D4F)),
}

@Composable
fun LibraryScreen(
    graph: Graph, section: LibrarySection, onSection: (LibrarySection) -> Unit, open: (MediaKind) -> Unit, openPlaylist: (PlaylistRef) -> Unit,
    musicTab: MusicTab = MusicTab.ForYou, onMusicTab: (MusicTab) -> Unit = {}, openArtist: (ArtistRef) -> Unit = {}, openLiked: () -> Unit = {},
) {
    val jobs by graph.downloads.jobs.collectAsStateWithLifecycle()
    val active = jobs.count { it.active }
    val scope = rememberCoroutineScope()
    var note by remember { mutableStateOf<String?>(null) }
    // The note about a rescan fades by itself: a message that stays forever is clutter.
    LaunchedEffect(note) { if (note != null) { delay(4000); note = null } }
    Column(Modifier.fillMaxSize()) {
        // The sidebar now chooses the section, so the page just says which one it is: a bar in the section's own colour
        // (the colour-block idea from YouTube's Library, docs/18 §1.3) and its name, large, as on YouTube's own pages.
        TabBar(Modifier.padding(top = 4.dp)) {
            Box(Modifier.size(width = 8.dp, height = 40.dp).background(section.chipColor, RoundedCornerShape(4.dp)))
            Text(
                if (section == LibrarySection.Downloads && active > 0) "${section.label} · $active" else section.label,
                style = LuminaText.Display.copy(fontSize = 38.sp), maxLines = 1,
            )
            Box(Modifier.weight(1f))
            if (section == LibrarySection.Music || section == LibrarySection.Videos) {
                LIconButton(Icons.Filled.Refresh, "Look for new files", size = 49.dp, onClick = {
                    scope.launch {
                        val added = graph.library.adoptUntracked(graph.storage.allMediaDirs())
                        graph.library.load()
                        graph.storage.refresh()
                        note = if (added > 0) "Found ${Formatting.count(added, "new file")}." else "No new files found."
                    }
                })
            }
            note?.let { Text(it, style = LuminaText.Small.copy(color = LuminaColors.Amber)) }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when (section) {
                LibrarySection.Music -> Column(Modifier.fillMaxSize()) {
                    MusicTabs(musicTab, onMusicTab)
                    Box(Modifier.weight(1f).fillMaxWidth()) {
                        when (musicTab) {
                            MusicTab.ForYou -> MusicForYou(graph, open, openPlaylist, openArtist)
                            MusicTab.Saved -> MediaList(graph, MediaKind.AUDIO, open)
                            MusicTab.Albums -> AlbumsTab(graph, openPlaylist)
                            MusicTab.Artists -> ArtistsTab(graph, openArtist)
                            MusicTab.History -> HistoryTab(graph, open)
                        }
                    }
                }
                LibrarySection.Videos -> VideosPage(graph, open)
                LibrarySection.Playlists -> PlaylistsScreen(graph, open, openPlaylist, openLiked)
                LibrarySection.Downloads -> DownloadsScreen(graph)
            }
        }
    }
}

@Composable
internal fun MediaList(graph: Graph, tab: MediaKind, open: (MediaKind) -> Unit) {
    val scope = rememberCoroutineScope()
    val library = rememberAvailableLibrary(graph)
    var deleting by remember { mutableStateOf<com.lumina.tv.data.LibraryItem?>(null) }
    var note by remember { mutableStateOf<String?>(null) }

    val shown = library.filter { it.kind == tab }.sortedByDescending { it.addedAt }
    val root = remember(library) { graph.storage.activeRoot() }

    fun play(index: Int) {
        graph.player.playLibrary(shown, index)
        open(tab)
    }

    LazyVerticalGrid(
        columns = GridCells.Adaptive(if (tab == MediaKind.VIDEO) 370.dp else 220.dp),
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(top = 8.dp, bottom = 24.dp, start = 4.dp, end = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(20.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (shown.isNotEmpty()) {
                        LButton("Play all", onClick = { graph.player.player.shuffleModeEnabled = false; play(0) }, icon = PlayerIcons.Play, primary = true)
                        LButton("Shuffle", onClick = { graph.player.player.shuffleModeEnabled = true; play(Random.nextInt(shown.size)) }, icon = PlayerIcons.Shuffle)
                    }
                }
                Text(
                    note ?: if (shown.isEmpty()) "" else "${if (tab == MediaKind.AUDIO) Formatting.count(shown.size, "song") else Formatting.count(shown.size, "video")} · ${Formatting.bytes(shown.sumOf { it.sizeBytes })} · ${root.label}" +
                        (root.freeBytes.takeIf { it >= 0 }?.let { " (${Formatting.bytes(it)} free)" } ?: "") + " · hold Select on a cover to delete",
                    style = LuminaText.Small,
                )
            }
        }

        if (shown.isEmpty()) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                StateMessage(
                    if (tab == MediaKind.AUDIO) "No music saved yet" else "No videos saved yet",
                    if (tab == MediaKind.AUDIO) "Play a song and press the download icon in the player. It will appear here and play with no internet."
                    else "Open a video and press Download in its controls. It will appear here and play with no internet.",
                )
            }
        }

        itemsIndexed(shown, key = { _, it -> it.id }) { index, item ->
            PosterCard(
                item.thumbPath?.let { "file://$it" }, item.kind, item.title, item.artist.ifBlank { null },
                onClick = { play(index) }, onLongClick = { deleting = item },
                width = androidx.compose.ui.unit.Dp.Unspecified, aspect = if (tab == MediaKind.VIDEO) 16f / 9f else CARD_ASPECT,
                duration = if (tab == MediaKind.VIDEO) lengthLabel(item.durationSec) else null,
            )
        }
    }

    deleting?.let { item ->
        // The harmless answer holds focus when the question opens, so even a stray press cannot delete anything.
        val keep = remember { androidx.compose.ui.focus.FocusRequester() }
        LaunchedEffect(Unit) { delay(80); runCatching { keep.requestFocus() } }
        LDialog(onDismiss = { deleting = null }, width = 520.dp) {
            Text("Delete this ${if (item.kind == MediaKind.AUDIO) "song" else "video"}?", style = LuminaText.DialogTitle)
            Text(item.title, style = LuminaText.Body, maxLines = 2)
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                LButton("Delete", onClick = {
                    deleting = null
                    // If this is what is playing, stop it first: deleting a playing file under the player is a crash waiting to happen.
                    if (graph.player.now.value?.id == item.id) graph.player.stop()
                    scope.launch {
                        graph.library.remove(item.id)
                        graph.playlistStore.excludeEverywhere(com.lumina.tv.data.Track.idFromUrl(item.sourceUrl))
                    }
                }, icon = Icons.Filled.Delete, primary = true)
                LButton("Keep it", onClick = { deleting = null }, modifier = Modifier.focusRequester(keep))
            }
        }
    }
}
