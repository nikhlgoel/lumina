package com.lumina.tv.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.Text
import com.lumina.tv.Graph
import com.lumina.tv.data.MediaKind
import com.lumina.tv.data.PlaylistSource
import com.lumina.tv.data.Track
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.collectLatest

/**
 * Resolves what the remote rests on after half a second, so pressing Play starts at once. A flow, not a state: a state read
 * would recompose the whole page (and every card) on each move of the remote.
 */
@Composable
fun rememberPrewarm(graph: Graph): (Track) -> Unit {
    val looks = remember { MutableSharedFlow<Track>(extraBufferCapacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST) }
    LaunchedEffect(Unit) { looks.collectLatest { delay(500); graph.repo.prewarm(it) } }
    return remember { { t -> looks.tryEmit(t); Unit } }
}

private enum class VideoTopic(val label: String, val query: String?) {
    ForYou("For you", null), Saved("Saved", null), Music("Music", "music videos"), Gaming("Gaming", "gaming"),
    News("News", "news today"), Learning("Learning", "learn something new"), Comedy("Comedy", "comedy"),
}

/**
 * The Videos page, laid out like YouTube's own home: a row of topic chips and a grid of big 16:9 pictures with the title and
 * the channel under each. "For you" follows the videos you played or saved (YouTube has no public API for a person's own
 * home feed, so this is what YouTube lists next to them); the other chips are searches for that topic; "Saved" is your files.
 */
@Composable
fun VideosPage(graph: Graph, open: (MediaKind) -> Unit) {
    var topic by rememberSaveable { mutableStateOf(VideoTopic.ForYou) }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.padding(start = 4.dp, top = 6.dp, bottom = 4.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            VideoTopic.entries.forEach { t -> Chip(t.label, selected = t == topic) { topic = t } }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (topic == VideoTopic.Saved) MediaList(graph, MediaKind.VIDEO, open) else VideoGrid(graph, topic, open)
        }
    }
}

/**
 * Videos for "For you": what YouTube lists next to the videos you played or saved most recently, or popular videos when
 * there is nothing to go on yet. Null while it is still loading. Shared by the Videos page and Home.
 */
@Composable
fun rememberVideoPicks(graph: Graph, enabled: Boolean = true): List<Track>? {
    val library = rememberAvailableLibrary(graph)
    val history by graph.history.items.collectAsStateWithLifecycle()
    val picks by graph.recommendations.videos.collectAsStateWithLifecycle()
    var fallback by remember { mutableStateOf<List<Track>?>(null) }
    LaunchedEffect(enabled) {
        if (!enabled) return@LaunchedEffect
        val seeds = history.filter { it.kind == MediaKind.VIDEO } +
            library.filter { it.kind == MediaKind.VIDEO }.sortedByDescending { it.addedAt }.map { Track(it.sourceUrl, it.title, it.artist, it.durationSec, null, it.kind) }
        graph.recommendations.refreshVideos(seeds)
        if (graph.recommendations.videos.value.isNullOrEmpty()) {
            fallback = runCatching { graph.repo.videos("popular videos") }.getOrDefault(emptyList()).filterNot(graph.taste::blocks)
        }
    }
    return picks?.takeIf { it.isNotEmpty() } ?: fallback
}

@Composable
private fun VideoGrid(graph: Graph, topic: VideoTopic, open: (MediaKind) -> Unit) {
    var found by remember(topic) { mutableStateOf<List<Track>?>(null) }
    val prewarm = rememberPrewarm(graph)
    val forYou = rememberVideoPicks(graph, enabled = topic.query == null)

    LaunchedEffect(topic) {
        found = null
        if (topic.query != null) found = runCatching { graph.repo.videos(topic.query) }.getOrDefault(emptyList()).filterNot(graph.taste::blocks)
    }
    val list: List<Track>? = if (topic.query != null) found else forYou

    LazyVerticalGrid(
        columns = GridCells.Adaptive(370.dp), modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(top = 12.dp, bottom = 24.dp, start = 4.dp, end = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(22.dp), verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        when {
            list == null -> items(8) { Shimmer(Modifier.fillMaxWidth().height(260.dp), RoundedCornerShape(14.dp)) }
            list.isEmpty() -> item(span = { GridItemSpan(maxLineSpan) }) { StateMessage("No videos found", "Check the internet connection, then pick the chip again.") }
            else -> itemsIndexed(list, key = { _, t -> "v-" + t.id }) { i, t ->
                PosterCard(
                    t.thumbnailUrl, MediaKind.VIDEO, t.title, t.artist.ifBlank { null },
                    onClick = { graph.player.playStreamQueue(list, i); open(MediaKind.VIDEO) },
                    onFocused = { prewarm(t) }, width = androidx.compose.ui.unit.Dp.Unspecified, aspect = 16f / 9f, duration = lengthLabel(t.durationSec),
                )
            }
        }
    }
}

/** A history entry plays from the stick when it is saved there, and from the internet when it is not. */
fun playHistoryTrack(graph: Graph, library: List<com.lumina.tv.data.LibraryItem>, t: Track, open: (MediaKind) -> Unit) {
    val local = library.firstOrNull { Track.idFromUrl(it.sourceUrl) == t.id }
    if (local != null) {
        val queue = library.filter { it.kind == local.kind }
        graph.player.playLibrary(queue, queue.indexOfFirst { it.id == local.id }.coerceAtLeast(0))
    } else {
        graph.player.playStreamQueue(listOf(t), 0)
    }
    open(t.kind)
}

/**
 * The Music page's "For you", laid out like YouTube Music's home: Quick picks (songs in columns of four, to scroll
 * sideways), Listen again, then shelves of albums, playlists and artists that follow what you listen to. Your own saved
 * songs, albums, artists and history are the other tabs.
 */
@Composable
fun MusicForYou(graph: Graph, open: (MediaKind) -> Unit, openPlaylist: (PlaylistRef) -> Unit, openArtist: (ArtistRef) -> Unit) {
    val library = rememberAvailableLibrary(graph)
    val seeds = rememberSeedArtists(graph)
    val feed by graph.recommendations.feed.collectAsStateWithLifecycle()
    val liked by graph.taste.liked.collectAsStateWithLifecycle()
    val history by graph.history.items.collectAsStateWithLifecycle()
    val albums by graph.discover.albums.collectAsStateWithLifecycle()
    val lists by graph.discover.playlists.collectAsStateWithLifecycle()
    val artists by graph.discover.artists.collectAsStateWithLifecycle()
    val prewarm = rememberPrewarm(graph)

    LaunchedEffect(library.size) { graph.recommendations.refresh(library.sortedByDescending { it.addedAt }) }
    LaunchedEffect(seeds, feed) { graph.discover.refresh(seeds, feed?.tracks.orEmpty().map { it.artist }) }

    val songs = remember(feed, liked, history) {
        (feed?.tracks.orEmpty().filter { it.kind == MediaKind.AUDIO } + liked + history.filter { it.kind == MediaKind.AUDIO }).distinctBy { it.id }
    }
    val again = remember(history) { history.filter { it.kind == MediaKind.AUDIO }.take(20) }
    fun playSongs(index: Int) { graph.player.playStreamQueue(songs, index); open(MediaKind.AUDIO) }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 4.dp, bottom = 28.dp)) {
        if (songs.isNotEmpty()) item(key = "quick") {
            Column {
                Text("Quick picks", style = LuminaText.Title.copy(fontSize = 24.sp), modifier = Modifier.padding(start = 6.dp, top = 8.dp))
                LazyRow(horizontalArrangement = Arrangement.spacedBy(28.dp), contentPadding = PaddingValues(start = 6.dp, end = 6.dp, top = 14.dp, bottom = 22.dp)) {
                    itemsIndexed(songs.take(16).chunked(4)) { col, group ->
                        Column(Modifier.width(500.dp)) {
                            group.forEachIndexed { r, t -> SongRow(t, onClick = { playSongs(col * 4 + r) }, onFocused = { prewarm(t) }) }
                        }
                    }
                }
            }
        }
        if (again.isNotEmpty()) item(key = "again") {
            ContentRow("Listen again") {
                items(again, key = { "again-" + it.id }) { t ->
                    PosterCard(t.thumbnailUrl, t.kind, t.title, t.artist.ifBlank { null }, onClick = { playHistoryTrack(graph, library, t, open) }, onFocused = { prewarm(t) })
                }
            }
        }
        albums?.takeIf { it.isNotEmpty() }?.let { list ->
            item(key = "albums") {
                ContentRow("Albums for you") {
                    items(list, key = { "al-" + it.playlistId }) { a ->
                        PosterCard(a.thumbnail, MediaKind.AUDIO, a.title, a.artist.ifBlank { null }, onClick = { openPlaylist(PlaylistRef(a.playlistId, PlaylistSource.PUBLIC, a.title, a.thumbnail)) })
                    }
                }
            }
        }
        lists?.takeIf { it.isNotEmpty() }?.let { list ->
            item(key = "mixes") {
                ContentRow("Mixed for you") {
                    items(list, key = { "pl-" + it.playlistId }) { p ->
                        PosterCard(p.thumbnail, MediaKind.AUDIO, p.title, p.owner.ifBlank { null }, onClick = { openPlaylist(PlaylistRef(p.playlistId, PlaylistSource.PUBLIC, p.title, p.thumbnail)) })
                    }
                }
            }
        }
        artists?.takeIf { it.isNotEmpty() }?.let { list ->
            item(key = "artists") {
                ContentRow("Artists") {
                    items(list, key = { "ar-" + it.name }) { a ->
                        ArtistCard(a.thumbnail, a.name, a.subtitle ?: "Artist", onClick = { openArtist(ArtistRef(a.name, a.thumbnail)) })
                    }
                }
            }
        }
        if (songs.isEmpty() && albums.isNullOrEmpty() && lists.isNullOrEmpty()) item(key = "empty") {
            if (albums == null && feed == null) ContentRow("Quick picks") { items(6) { Shimmer(Modifier.width(300.dp).height(240.dp), RoundedCornerShape(14.dp)) } }
            else StateMessage("Nothing to suggest yet", "Play or like a few songs and this page fills with albums, playlists and artists for you.")
        }
    }
}

/** Your liked songs as a page of their own (opened from the "Liked songs" tile among your playlists). */
@Composable
fun LikedScreen(graph: Graph, open: (MediaKind) -> Unit) {
    Column(Modifier.fillMaxSize()) {
        Text("Liked songs", style = LuminaText.Display.copy(fontSize = 38.sp), modifier = Modifier.padding(start = 4.dp, top = 4.dp, bottom = 4.dp))
        Box(Modifier.weight(1f).fillMaxWidth()) { LikedTab(graph, open) }
    }
}
