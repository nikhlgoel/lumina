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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.Text
import com.lumina.tv.Graph
import com.lumina.tv.core.Discovery
import com.lumina.tv.core.Formatting
import com.lumina.tv.data.LibraryItem
import com.lumina.tv.data.MediaKind
import com.lumina.tv.data.PlaylistSource
import com.lumina.tv.data.StreamRepo
import com.lumina.tv.data.Track
import kotlinx.coroutines.delay

/** The pages inside Music, as in YouTube Music's own Library: your songs, what you liked, albums, artists, and what you played. */
enum class MusicTab(val label: String) { ForYou("For you"), Saved("Saved"), Albums("Albums"), Artists("Artists"), History("History") }

/** An artist as a card points at it: enough to draw the page's header at once while its songs and albums load. */
data class ArtistRef(val name: String, val imageUrl: String?)

@Composable
fun MusicTabs(selected: MusicTab, onSelect: (MusicTab) -> Unit, modifier: Modifier = Modifier) {
    Row(modifier.padding(start = 4.dp, top = 6.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        MusicTab.entries.forEach { tab -> Chip(tab.label, selected = tab == selected) { onSelect(tab) } }
    }
}

/** Every song's artist and picture from the three places the app knows songs: saved, liked and played. */
private fun artistEntries(library: List<LibraryItem>, liked: List<Track>, history: List<Track>): List<Pair<String, String?>> =
    library.filter { it.kind == MediaKind.AUDIO }.map { it.artist to it.thumbPath?.let { p -> "file://$p" } } +
        liked.map { it.artist to it.thumbnailUrl } + history.filter { it.kind == MediaKind.AUDIO }.map { it.artist to it.thumbnailUrl }

/** The artists a person listens to most, from saved, liked and played songs. */
@Composable
fun rememberSeedArtists(graph: Graph, limit: Int = 4): List<String> {
    val library = rememberAvailableLibrary(graph)
    val liked by graph.taste.liked.collectAsStateWithLifecycle()
    val history by graph.history.items.collectAsStateWithLifecycle()
    return remember(library, liked, history) {
        Discovery.topArtists(
            listOf(library.filter { it.kind == MediaKind.AUDIO }.map { it.artist }, liked.map { it.artist }, history.filter { it.kind == MediaKind.AUDIO }.map { it.artist }),
            limit,
        )
    }
}

@Composable
fun LikedTab(graph: Graph, open: (MediaKind) -> Unit) {
    val liked by graph.taste.liked.collectAsStateWithLifecycle()
    fun play(i: Int) { graph.player.playStreamQueue(liked, i); open(MediaKind.AUDIO) }
    LazyVerticalGrid(
        columns = GridCells.Adaptive(220.dp), modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(top = 8.dp, bottom = 24.dp, start = 4.dp, end = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(20.dp), verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (liked.isNotEmpty()) Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    LButton("Play all", { graph.player.player.shuffleModeEnabled = false; play(0) }, icon = PlayerIcons.Play, primary = true)
                    LButton("Shuffle", { play(liked.indices.random()) }, icon = PlayerIcons.Shuffle)
                }
                Text(if (liked.isEmpty()) "" else "${Formatting.count(liked.size, "liked song")} · newest first", style = LuminaText.Small)
            }
        }
        if (liked.isEmpty()) item(span = { GridItemSpan(maxLineSpan) }) { StateMessage("No liked songs yet", "Press the heart in the music player on a song you love. It will be here, and on Home.") }
        itemsIndexed(liked, key = { _, t -> "liked-" + t.id }) { i, t ->
            PosterCard(t.thumbnailUrl, t.kind, t.title, t.artist.ifBlank { null }, onClick = { play(i) }, width = Dp.Unspecified)
        }
    }
}

@Composable
fun HistoryTab(graph: Graph, open: (MediaKind) -> Unit) {
    val history by graph.history.items.collectAsStateWithLifecycle()
    val library = rememberAvailableLibrary(graph)
    var confirm by remember { mutableStateOf(false) }
    fun play(t: Track) {
        val local = library.firstOrNull { Track.idFromUrl(it.sourceUrl) == t.id }
        if (local != null) graph.player.playLibrary(listOf(local), 0) else graph.player.playStreamQueue(listOf(t), 0)
        open(t.kind)
    }
    LazyVerticalGrid(
        columns = GridCells.Adaptive(220.dp), modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(top = 8.dp, bottom = 24.dp, start = 4.dp, end = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(20.dp), verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (history.isNotEmpty()) LButton("Clear history", { confirm = true }, icon = Icons.Filled.Delete)
                Text(
                    if (history.isEmpty()) "" else "${Formatting.count(history.size, "item")} · newest first · kept on this device only",
                    style = LuminaText.Small,
                )
            }
        }
        if (history.isEmpty()) item(span = { GridItemSpan(maxLineSpan) }) { StateMessage("Nothing played yet", "Songs and videos you play are listed here, newest first. This list stays on this device.") }
        itemsIndexed(history, key = { _, t -> "hist-" + t.id }) { _, t ->
            PosterCard(t.thumbnailUrl, t.kind, t.title, t.artist.ifBlank { null }, onClick = { play(t) }, width = Dp.Unspecified)
        }
    }
    if (confirm) {
        val keep = remember { FocusRequester() }
        LaunchedEffect(Unit) { delay(80); runCatching { keep.requestFocus() } }
        LDialog(onDismiss = { confirm = false }, width = 520.dp) {
            Text("Clear your history?", style = LuminaText.DialogTitle)
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                LButton("Clear", { graph.history.clear(); confirm = false }, icon = Icons.Filled.Delete, primary = true)
                LButton("Keep it", { confirm = false }, modifier = Modifier.focusRequester(keep))
            }
        }
    }
}

@Composable
fun ArtistsTab(graph: Graph, openArtist: (ArtistRef) -> Unit) {
    val library = rememberAvailableLibrary(graph)
    val liked by graph.taste.liked.collectAsStateWithLifecycle()
    val history by graph.history.items.collectAsStateWithLifecycle()
    val groups = remember(library, liked, history) { Discovery.artistGroups(artistEntries(library, liked, history)) }
    LazyVerticalGrid(
        columns = GridCells.Adaptive(200.dp), modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(top = 8.dp, bottom = 24.dp, start = 4.dp, end = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Text(if (groups.isEmpty()) "" else "${Formatting.count(groups.size, "artist")} · from your saved, liked and played songs", style = LuminaText.Small)
        }
        if (groups.isEmpty()) item(span = { GridItemSpan(maxLineSpan) }) { StateMessage("No artists yet", "Save, like or play a few songs and the artists show up here.") }
        itemsIndexed(groups, key = { _, g -> "artist-" + g.name.lowercase() }) { _, g ->
            ArtistCard(g.imageUrl, g.name, Formatting.count(g.songs, "song"), onClick = { openArtist(ArtistRef(g.name, g.imageUrl)) }, width = 200.dp)
        }
    }
}

@Composable
fun AlbumsTab(graph: Graph, openPlaylist: (PlaylistRef) -> Unit) {
    val seeds = rememberSeedArtists(graph)
    val albums by graph.discover.albums.collectAsStateWithLifecycle()
    LaunchedEffect(seeds) { graph.discover.refresh(seeds, emptyList()) }
    LazyVerticalGrid(
        columns = GridCells.Adaptive(220.dp), modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(top = 8.dp, bottom = 24.dp, start = 4.dp, end = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(20.dp), verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Text(if (seeds.isEmpty()) "Popular albums to start with" else "Albums by artists you listen to: ${seeds.take(3).joinToString(", ")}", style = LuminaText.Small)
        }
        val list = albums
        when {
            list == null -> item(span = { GridItemSpan(maxLineSpan) }) { Shimmer(Modifier.fillMaxWidth().height(120.dp), RoundedCornerShape(16.dp)) }
            list.isEmpty() -> item(span = { GridItemSpan(maxLineSpan) }) { StateMessage("No albums found", "Check the internet connection. Albums come from YouTube Music.") }
            else -> itemsIndexed(list, key = { _, a -> "album-" + a.playlistId }) { _, a ->
                PosterCard(a.thumbnail, MediaKind.AUDIO, a.title, a.artist.ifBlank { null }, onClick = { openPlaylist(PlaylistRef(a.playlistId, PlaylistSource.PUBLIC, a.title, a.thumbnail)) }, width = Dp.Unspecified)
            }
        }
    }
}

/**
 * One artist: the songs of theirs you have (saved, liked, played), their popular songs, and their albums from YouTube Music.
 * Select on a song plays from there, and the rest of the row queues after it.
 */
@Composable
fun ArtistScreen(graph: Graph, ref: ArtistRef, open: (MediaKind) -> Unit, openPlaylist: (PlaylistRef) -> Unit) {
    val library = rememberAvailableLibrary(graph)
    val liked by graph.taste.liked.collectAsStateWithLifecycle()
    val history by graph.history.items.collectAsStateWithLifecycle()
    val key = ref.name.lowercase()
    fun mine(a: String) = com.lumina.tv.core.PlaylistLogic.cleanArtist(a).lowercase() == key

    val saved = remember(library) { library.filter { it.kind == MediaKind.AUDIO && mine(it.artist) } }
    val known = remember(liked, history) { (liked + history.filter { it.kind == MediaKind.AUDIO }).filter { mine(it.artist) }.distinctBy { it.id } }
    var popular by remember(ref.name) { mutableStateOf<List<Track>?>(null) }
    var albums by remember(ref.name) { mutableStateOf<List<StreamRepo.AlbumHit>?>(null) }
    val play = remember { FocusRequester() }

    LaunchedEffect(ref.name) {
        popular = runCatching { graph.repo.songs(ref.name) }.getOrDefault(emptyList()).filter { it.artist.lowercase().contains(key) || key.contains(it.artist.lowercase()) }
        albums = runCatching { graph.repo.searchAlbums(ref.name, 12) }.getOrDefault(emptyList())
    }
    LaunchedEffect(Unit) { delay(80); runCatching { play.requestFocus() } }

    fun playAll() {
        val songs = popular.orEmpty().ifEmpty { known }
        if (songs.isNotEmpty()) { graph.player.playStreamQueue(songs, 0); open(MediaKind.AUDIO) }
        else if (saved.isNotEmpty()) { graph.player.playLibrary(saved, 0); open(MediaKind.AUDIO) }
    }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 8.dp, bottom = 28.dp)) {
        item {
            Row(Modifier.fillMaxWidth().padding(bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(32.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.size(180.dp).clip(CircleShape).background(LuminaColors.SurfaceHigh)) {
                    Thumb(ref.imageUrl, MediaKind.AUDIO, Modifier.fillMaxSize(), shape = RoundedCornerShape(0.dp))
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("ARTIST", style = LuminaText.Small.copy(color = LuminaColors.Amber))
                    Text(ref.name, style = LuminaText.Display.copy(fontSize = 40.sp), maxLines = 2)
                    Text(
                        listOfNotNull(
                            saved.size.takeIf { it > 0 }?.let { Formatting.count(it, "song") + " saved" },
                            known.size.takeIf { it > 0 }?.let { Formatting.count(it, "liked or played song") },
                        ).joinToString(" · ").ifEmpty { "From YouTube Music" },
                        style = LuminaText.Body,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        LButton("Play", ::playAll, icon = PlayerIcons.Play, primary = true, modifier = Modifier.focusRequester(play))
                        LButton("Shuffle", { val s = popular.orEmpty().ifEmpty { known }; if (s.isNotEmpty()) { graph.player.playStreamQueue(s.shuffled(), 0); open(MediaKind.AUDIO) } }, icon = PlayerIcons.Shuffle)
                    }
                }
            }
        }
        if (saved.isNotEmpty()) item(key = "saved") {
            ContentRow("Your songs on this device") {
                itemsIndexed(saved, key = { _, it -> "s-" + it.id }) { i, it ->
                    PosterCard(it.thumbPath?.let { p -> "file://$p" }, it.kind, it.title, null, onClick = { graph.player.playLibrary(saved, i); open(MediaKind.AUDIO) })
                }
            }
        }
        if (known.isNotEmpty()) item(key = "known") {
            ContentRow("Liked and played") {
                itemsIndexed(known, key = { _, t -> "k-" + t.id }) { i, t ->
                    PosterCard(t.thumbnailUrl, t.kind, t.title, null, onClick = { graph.player.playStreamQueue(known, i); open(MediaKind.AUDIO) })
                }
            }
        }
        item(key = "popular") {
            val list = popular
            ContentRow("Songs") {
                if (list == null) items(5) { Shimmer(Modifier.size(width = CARD_WIDTH, height = 296.dp), RoundedCornerShape(14.dp)) }
                else itemsIndexed(list, key = { _, t -> "p-" + t.id }) { i, t ->
                    PosterCard(t.thumbnailUrl, t.kind, t.title, null, onClick = { graph.player.playStreamQueue(list, i); open(MediaKind.AUDIO) })
                }
            }
        }
        val albumList = albums
        if (albumList == null || albumList.isNotEmpty()) item(key = "albums") {
            ContentRow("Albums") {
                if (albumList == null) items(5) { Shimmer(Modifier.size(width = CARD_WIDTH, height = 296.dp), RoundedCornerShape(14.dp)) }
                else itemsIndexed(albumList, key = { _, a -> "a-" + a.playlistId }) { _, a ->
                    PosterCard(a.thumbnail, MediaKind.AUDIO, a.title, a.artist.ifBlank { null }, onClick = { openPlaylist(PlaylistRef(a.playlistId, PlaylistSource.PUBLIC, a.title, a.thumbnail)) })
                }
            }
        }
    }
}
