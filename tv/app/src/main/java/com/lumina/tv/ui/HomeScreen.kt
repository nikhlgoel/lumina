package com.lumina.tv.ui

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.LocalBringIntoViewSpec
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.Icon
import androidx.tv.material3.Text
import com.lumina.tv.Graph
import com.lumina.tv.core.Countries
import com.lumina.tv.core.Formatting
import com.lumina.tv.core.ShuffleMix
import com.lumina.tv.data.AccountPlaylistsRepo
import com.lumina.tv.data.LibraryItem
import com.lumina.tv.data.MediaKind
import com.lumina.tv.data.PlaylistSource
import com.lumina.tv.data.Track
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import java.util.Calendar

private enum class HomeFilter(val label: String) { All("All"), Music("Music"), Videos("Videos"), Device("On this device") }

private data class HomePlaylist(val id: String, val title: String, val subtitle: String, val thumb: String?, val source: PlaylistSource, val kept: Boolean, val kind: com.lumina.tv.core.PlaylistKind = com.lumina.tv.core.PlaylistKind.MIXED)

/**
 * Home is one page for everything: songs and videos together. The Shuffle shape and search sit in the header, chips
 * narrow the rows to Music, Videos or what is saved, and below them the rows scroll. Hold any card to pin it to the
 * speed dial.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun HomeScreen(graph: Graph, onGoSearch: () -> Unit, onGoLibrary: (LibrarySection) -> Unit, open: (MediaKind) -> Unit, openPlaylist: (PlaylistRef) -> Unit, openArtist: (ArtistRef) -> Unit, openLiked: () -> Unit) {
    val library = rememberAvailableLibrary(graph)
    val jobs by graph.downloads.jobs.collectAsStateWithLifecycle()
    val synced by graph.playlistStore.playlists.collectAsStateWithLifecycle()
    val account by graph.accountPlaylists.flow.collectAsStateWithLifecycle()
    val feed by graph.recommendations.feed.collectAsStateWithLifecycle()
    val liked by graph.taste.liked.collectAsStateWithLifecycle()
    val history by graph.history.items.collectAsStateWithLifecycle()
    val feedSettled by graph.recommendations.settled.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val launcher = rememberPlaylistPlayer(graph, open)
    val start = remember { FocusRequester() }
    var filterIndex by rememberSaveable { mutableIntStateOf(0) }
    val filter = HomeFilter.entries[filterIndex]
    var toast by remember { mutableStateOf<String?>(null) }
    var shuffling by remember { mutableStateOf(false) }

    LaunchedEffect(toast) { if (toast != null) { delay(2600); toast = null } }

    // Resolve what the remote rests on (after half a second, so scrolling past does not fetch everything), so
    // that pressing Play starts at once. Moving on cancels the wait. A flow rather than a state: a state read
    // here recomposed the whole page, and every card in it, on every single move of the remote.
    val looks = remember { MutableSharedFlow<Track>(extraBufferCapacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST) }
    LaunchedEffect(Unit) {
        looks.collectLatest { t ->
            delay(500)
            graph.repo.prewarm(t)
        }
    }
    // Every playlist on the account, not only the ones copied to the stick.
    LaunchedEffect(Unit) { graph.accountPlaylists.load() }

    val newest = remember(library) { library.sortedByDescending { it.addedAt } }
    val music = newest.filter { it.kind == MediaKind.AUDIO }
    val videos = newest.filter { it.kind == MediaKind.VIDEO }
    val active = jobs.filter { it.active }

    val accountLists = (account as? AccountPlaylistsRepo.State.Loaded)?.lists.orEmpty()
    val loadingAccount = graph.google.signedIn && (account is AccountPlaylistsRepo.State.Idle || account is AccountPlaylistsRepo.State.Loading)
    val kinds by graph.accountPlaylists.kinds.collectAsStateWithLifecycle()
    val playlists = remember(accountLists, synced, kinds) {
        val kept = synced.filter { it.download }.map { it.id }.toSet()
        val fromAccount = accountLists.map {
            HomePlaylist(
                it.id, it.title, if (it.itemCount >= 0) "${it.itemCount} songs" else "Your likes", it.thumbnail, PlaylistSource.ACCOUNT, it.id in kept,
                kind = if (it.isLikes) com.lumina.tv.core.PlaylistKind.VIDEO else kinds[it.id] ?: com.lumina.tv.core.PlaylistKind.MIXED,
            )
        }
        val ids = accountLists.map { it.id }.toSet()
        fromAccount + synced.filter { it.id !in ids }.map { HomePlaylist(it.id, it.title, "${it.itemCount} songs", it.thumbnailUrl, it.source, it.download) }
    }

    // Begin inside the content (not on the sidebar), so a first press of Select does something. The request goes
    // to the list itself, which never changes, and moves to its first focusable card; rows that arrive later
    // (the recommendations) therefore cannot disturb it.
    // The system assigns its own first focus a moment after launch (later on a slow stick), so ask again
    // until Home really holds focus, for a few seconds at most; after that the person is in charge.
    var contentFocused by remember { mutableStateOf(false) }
    // Whether the remote has been used yet: until it has, focus may still be moved to the top when the playlists arrive.
    val acted = remember { booleanArrayOf(false) }
    // Not while the remote is on the sidebar: Home may have just opened because the remote rested on its entry, and
    // pulling it off the sidebar then would stop the person moving down to the next entry.
    val railFocused = LocalRailFocused.current
    // The first screenful is the mosaic, so focus waits for it (8 s at most): taking it earlier would land on the playlists
    // row below, and the page keeps that row in view, leaving the mosaic scrolled away above.
    var mosaicReady by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { delay(8000); mosaicReady = true }
    LaunchedEffect(loadingAccount, mosaicReady) {
        if (mosaicReady && !loadingAccount && !acted[0] && !railFocused()) { delay(150); if (!railFocused()) runCatching { start.requestFocus() } }
    }
    LaunchedEffect(mosaicReady) {
        if (!mosaicReady) return@LaunchedEffect
        repeat(14) {
            if (contentFocused || railFocused()) return@LaunchedEffect
            runCatching { start.requestFocus() }
            delay(300)
        }
    }

    // Built in the background and cached, so Home appears at once and the row fills in when it arrives.
    LaunchedEffect(newest.size) { graph.recommendations.refresh(newest) }

    // Albums, artists and playlists follow the artists listened to most (saved, liked, played); the weekly chart needs nothing.
    // Each shelf fills in when it arrives, and one that cannot be built simply is not shown.
    val seeds = rememberSeedArtists(graph)
    val feedArtists = feed?.tracks.orEmpty().map { it.artist }
    val discAlbums by graph.discover.albums.collectAsStateWithLifecycle()
    val discPlaylists by graph.discover.playlists.collectAsStateWithLifecycle()
    val discArtists by graph.discover.artists.collectAsStateWithLifecycle()
    val chart by graph.discover.topArtists.collectAsStateWithLifecycle()
    LaunchedEffect(seeds, feedArtists.isEmpty()) { graph.discover.refresh(seeds, feedArtists) }
    LaunchedEffect(Unit) { graph.discover.loadTopArtists() }

    fun playLibrary(item: LibraryItem) {
        val queue = library.filter { it.kind == item.kind }
        graph.player.playLibrary(queue, queue.indexOfFirst { it.id == item.id }.coerceAtLeast(0))
        open(item.kind)
    }

    fun playTracks(queue: List<Track>, index: Int) {
        graph.player.playStreamQueue(queue, index)
        open(queue[index].kind)
    }

    /** A song from the history plays from the stick when it is saved there, and from the internet when it is not. */
    fun playHistory(t: Track) {
        val local = library.firstOrNull { Track.idFromUrl(it.sourceUrl) == t.id }
        if (local != null) playLibrary(local) else playTracks(listOf(t), 0)
    }

    fun shuffle() {
        if (shuffling) return
        shuffling = true
        val country = Countries.byCode(graph.settings.contentCountry) ?: Countries.all[1]
        scope.launch {
            try {
                val mix = ShuffleMix.mix(graph.repo.countryHits(country), { it.id })
                if (mix.isEmpty()) toast = "Nothing found for ${country.name}." else playTracks(mix, 0)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                toast = "Couldn't reach ${country.name} music. Check the connection."
            } finally {
                shuffling = false
            }
        }
    }

    val countryName = (Countries.byCode(graph.settings.contentCountry) ?: Countries.all[1]).name
    val onDevice = filter == HomeFilter.Device
    val shownPlaylists = (if (onDevice) playlists.filter { it.kept } else playlists)
        .filter { com.lumina.tv.core.PlaylistKinds.shown(it.kind, music = filter == HomeFilter.Music, videos = filter == HomeFilter.Videos) }
    // The tiles for the mosaic: videos, albums and playlists woven together (or only the kind the chip asks for), so no
    // three of one kind sit in a row. Songs for the panel come from what the feed, your likes and your plays offer.
    val vids = rememberVideoPicks(graph, enabled = filter != HomeFilter.Music && !onDevice).orEmpty()
    val videoItems = vids.mapIndexed { i, t ->
        MosaicItem(t.thumbnailUrl, MediaKind.VIDEO, t.title, t.artist.ifBlank { null }, lengthLabel(t.durationSec), onFocus = { looks.tryEmit(t) }) { playTracks(vids, i) }
    }
    val albumItems = discAlbums.orEmpty().map { a ->
        MosaicItem(a.thumbnail, MediaKind.AUDIO, a.title, a.artist.ifBlank { null }, null) { openPlaylist(PlaylistRef(a.playlistId, PlaylistSource.PUBLIC, a.title, a.thumbnail)) }
    }
    val mixItems = discPlaylists.orEmpty().map { p ->
        MosaicItem(p.thumbnail, MediaKind.AUDIO, p.title, p.owner.ifBlank { null }, null) { openPlaylist(PlaylistRef(p.playlistId, PlaylistSource.PUBLIC, p.title, p.thumbnail)) }
    }
    val pool = when (filter) {
        HomeFilter.Videos -> videoItems
        HomeFilter.Music -> com.lumina.tv.core.Discovery.interleave(albumItems, mixItems)
        else -> com.lumina.tv.core.Discovery.interleave(videoItems, albumItems, mixItems)
    }
    val songs = (feed?.tracks.orEmpty().filter { it.kind == MediaKind.AUDIO } + liked + history.filter { it.kind == MediaKind.AUDIO }).distinctBy { it.id }
    val quick = if (filter == HomeFilter.Videos) emptyList() else songs
    LaunchedEffect(onDevice, pool.isNotEmpty()) { if (onDevice || pool.isNotEmpty()) mosaicReady = true }

    Box(Modifier.fillMaxSize().onPreviewKeyEvent { acted[0] = true; false }) {
        Column(Modifier.fillMaxSize()) {
            // The header is the real YouTube TV one (docs/18 §1.2): one wide search bar, and nothing else competing with
            // it. The big greeting is gone; the playful Shuffle shape stays, smaller, at the right.
            Row(Modifier.fillMaxWidth().padding(start = 6.dp, top = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                SearchPill(onGoSearch, Modifier.weight(1f))
                ShuffleShape(countryName, shuffling, ::shuffle)
            }
            // Chips narrow the rows to Music, Videos or what is saved: the way music and video sit in one page. What is
            // on the device is said once, quietly, at the end of the same line.
            Row(Modifier.fillMaxWidth().padding(start = 6.dp, top = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                HomeFilter.entries.forEachIndexed { i, f -> Chip(f.label, selected = i == filterIndex) { filterIndex = i } }
                Box(Modifier.weight(1f))
                Text(
                    if (library.isEmpty()) "Nothing saved on this device yet" else "${Formatting.count(music.size, "song")} · ${Formatting.count(videos.size, "video")} on this device",
                    style = LuminaText.Small, maxLines = 1,
                )
            }

            // The page scrolls row by row to one fixed height instead of by whatever nudge the focused card needs.
            CompositionLocalProvider(LocalBringIntoViewSpec provides remember { rowAnchoredScroll(0.10f) }) {
                LazyColumn(
                    Modifier.weight(1f).fillMaxWidth().focusRequester(start).onFocusChanged { if (it.hasFocus) contentFocused = true },
                    contentPadding = PaddingValues(bottom = 16.dp),
                ) {
                    if (active.isNotEmpty()) {
                        item(key = "downloading") {
                            val first = active.first()
                            Row(
                                Modifier.fillMaxWidth().padding(top = 8.dp, start = 6.dp).background(LuminaColors.Surface, RoundedCornerShape(16.dp)).padding(horizontal = 22.dp, vertical = 12.dp),
                                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(18.dp),
                            ) {
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Text(
                                        "Downloading ${if (active.size == 1) first.track.title else Formatting.count(active.size, "item")}" +
                                            (active.sumOf { it.speedBps }.takeIf { it > 0 }?.let { " · ${Formatting.speed(it)}" } ?: ""),
                                        style = LuminaText.Row, maxLines = 1,
                                    )
                                    ProgressLine(first.fraction, Modifier.fillMaxWidth())
                                }
                                Text("${(first.fraction * 100).toInt()}%", style = LuminaText.Title.copy(color = LuminaColors.Amber))
                            }
                        }
                    }

                    // The first screenful of discovery: videos, albums and playlists in tiles of different sizes beside a panel of
                    // songs (see Mosaic.kt). Not on "On this device", which is only what is saved.
                    // One slot that stays in place: placeholders first, then the real tiles in the same spot, so nothing is
                    // inserted above what the remote is on. Gone only if nothing could be loaded at all.
                    if (!onDevice && (pool.isNotEmpty() || !mosaicReady)) item(key = "mosaic-1") {
                        if (pool.isNotEmpty()) MosaicBlockOne(pool, quick, onPlaySong = { playTracks(songs, it) }, onFocusSong = { looks.tryEmit(it) })
                        else Row(Modifier.padding(start = 6.dp, top = 12.dp, bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                            Shimmer(Modifier.size(604.dp, 340.dp), RoundedCornerShape(18.dp))
                            Shimmer(Modifier.size(230.dp, 340.dp), RoundedCornerShape(18.dp))
                            Shimmer(Modifier.size(420.dp, 340.dp), RoundedCornerShape(18.dp))
                        }
                    }

                    // Your playlists, with your liked songs as the first of them. While the account's playlists load, this slot
                    // holds placeholders and then the real cards replace them in the same place: cards arriving ahead of the
                    // remote would otherwise make it jump.
                    val showLiked = !onDevice && filter != HomeFilter.Videos
                    if (showLiked || loadingAccount || shownPlaylists.isNotEmpty()) {
                        item(key = "playlists") {
                            ContentRow("Your playlists") {
                                if (showLiked) item(key = "liked") { LikedCard(liked.size, onClick = openLiked, width = CARD_WIDTH) }
                                if (loadingAccount) items(6) { Shimmer(Modifier.size(width = CARD_WIDTH, height = 296.dp), RoundedCornerShape(14.dp)) }
                                else items(shownPlaylists, key = { it.id }) { p ->
                                    PosterCard(
                                        p.thumb, MediaKind.AUDIO, p.title, p.subtitle,
                                        onClick = { openPlaylist(PlaylistRef(p.id, p.source, p.title, p.thumb)) }
                                    )
                                }
                            }
                        }
                    }

                    // The second block is lopsided on purpose: no straight top or bottom edge.
                    if (!onDevice && pool.size > 5) item(key = "mosaic-2") {
                        val a = discArtists.orEmpty().firstOrNull()
                        MosaicBlockTwo(
                            pool.drop(5),
                            artist = if (a != null && filter != HomeFilter.Videos) ({ ArtistCard(a.thumbnail, a.name, a.subtitle ?: "Artist", onClick = { openArtist(ArtistRef(a.name, a.thumbnail)) }) }) else null,
                        )
                    }

                    // What was played lately, saved or streamed: kept on this device only (YouTube's own watch history is not
                    // available to apps). A song that is saved plays from the stick, not the internet.
                    val recent = history.filter { when (filter) { HomeFilter.Music -> it.kind == MediaKind.AUDIO; HomeFilter.Videos -> it.kind == MediaKind.VIDEO; else -> true } }.take(20)
                    if (!onDevice && recent.isNotEmpty()) {
                        item(key = "recent") {
                            ContentRow("Recently played") {
                                itemsIndexed(recent, key = { _, t -> "recent-" + t.id }) { _, t ->
                                    PosterCard(
                                        t.thumbnailUrl, t.kind, t.title, t.artist.ifBlank { null },
                                        onClick = { playHistory(t) },
                                        onFocused = { looks.tryEmit(t) },
                                        width = if (t.kind == MediaKind.VIDEO) CARD_WIDTH_VIDEO else CARD_WIDTH,
                                        aspect = if (t.kind == MediaKind.VIDEO) 16f / 9f else CARD_ASPECT,
                                    )
                                }
                            }
                        }
                    }

                    // Said plainly: this is Deezer's chart for the week, not a yearly list and not personal.
                    if (filter == HomeFilter.All || filter == HomeFilter.Music) {
                        chart?.takeIf { it.isNotEmpty() }?.let { list ->
                            item(key = "disc-chart") {
                                ContentRow("Top artists this week · Deezer chart") {
                                    items(list, key = { "dc-" + it.name }) { a ->
                                        ArtistCard(a.imageUrl, a.name, "#${a.rank} this week", onClick = { openArtist(ArtistRef(a.name, a.imageUrl)) })
                                    }
                                }
                            }
                        }
                    }
                    if (music.isNotEmpty() && (filter == HomeFilter.All || filter == HomeFilter.Music || onDevice)) {
                        item(key = "music") {
                            ContentRow("Your music") {
                                items(music.take(24), key = { it.id }) { item ->
                                    PosterCard(
                                        item.thumbPath?.let { "file://$it" }, item.kind, item.title, item.artist.ifBlank { null },
                                        onClick = { playLibrary(item) },
                                    )
                                }
                            }
                        }
                    }

                    if (videos.isNotEmpty() && (filter == HomeFilter.All || filter == HomeFilter.Videos || onDevice)) {
                        item(key = "videos") {
                            ContentRow("Your videos") {
                                items(videos.take(24), key = { it.id }) { item ->
                                    PosterCard(
                                        item.thumbPath?.let { "file://$it" }, item.kind, item.title, item.artist.ifBlank { null },
                                        onClick = { playLibrary(item) },
                                        width = CARD_WIDTH_VIDEO, aspect = 16f / 9f,
                                        duration = lengthLabel(item.durationSec),
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }

        toast?.let {
            Text(
                it, style = LuminaText.Row,
                modifier = Modifier.align(Alignment.BottomStart).padding(start = 6.dp, bottom = 12.dp)
                    .background(Color(0xE62A2933), RoundedCornerShape(24.dp)).border(1.dp, Color(0x14FFFFFF), RoundedCornerShape(24.dp))
                    .padding(horizontal = 26.dp, vertical = 14.dp),
            )
        }
    }
    PlaylistPlayerDialogs(launcher)
}

private fun greeting(): String = when (Calendar.getInstance().get(Calendar.HOUR_OF_DAY)) {
    in 5..11 -> "Good morning"
    in 12..16 -> "Good afternoon"
    in 17..21 -> "Good evening"
    else -> "Good night"
}

/**
 * The Shuffle button: a lopsided shape (two soft blobs, corners of different sizes, one tilted behind the other), not
 * a rectangle, because it is the one playful thing on the page. It mixes hits from the country chosen in Settings.
 * It lives in the header, so what is in the playlists row can never move it.
 */
@Composable
private fun ShuffleShape(country: String, busy: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.05f else 1f, tween(200), label = "shuffle-scale")
    val back = RoundedCornerShape(topStart = 30.dp, topEnd = 96.dp, bottomEnd = 34.dp, bottomStart = 88.dp)
    val front = RoundedCornerShape(topStart = 90.dp, topEnd = 28.dp, bottomEnd = 92.dp, bottomStart = 32.dp)
    Box(
        modifier
            .size(width = 300.dp, height = 112.dp)
            .onFocusChanged { focused = it.isFocused }
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .clickable(onClick = onClick),
    ) {
        Box(Modifier.matchParentSize().padding(start = 22.dp, top = 4.dp).graphicsLayer { rotationZ = -4f }.clip(back).background(LuminaColors.Amber.copy(alpha = 0.26f)))
        Box(
            Modifier.matchParentSize().padding(end = 12.dp, bottom = 8.dp).clip(front)
                .background(Brush.linearGradient(listOf(LuminaColors.Amber, lerp(LuminaColors.Amber, Color.White, 0.4f))))
                .border(BorderStroke(if (focused) 3.dp else 0.dp, if (focused) Color.White else Color.Transparent), front),
            contentAlignment = Alignment.Center,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Icon(PlayerIcons.Shuffle, contentDescription = null, tint = LuminaColors.Bg, modifier = Modifier.size(44.dp))
                Column {
                    Text(if (busy) "Mixing…" else "Shuffle", style = LuminaText.Display.copy(fontSize = 25.sp, color = LuminaColors.Bg))
                    Text("Hits from $country", style = LuminaText.Small.copy(color = LuminaColors.Bg.copy(alpha = 0.8f)), maxLines = 1)
                }
            }
        }
    }
}

/** A filter pill. Selecting one narrows the rows below; the chosen one is filled with the accent colour. */
@Composable
internal fun Chip(label: String, selected: Boolean, onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    Box(
        Modifier
            .onFocusChanged { focused = it.isFocused }
            .clip(CircleShape)
            // The chosen chip is a white pill with dark text, as on YouTube and YouTube Music; the rest are quiet grey.
            .background(if (selected) Color(0xFFF1F1F1) else if (focused) Color.White.copy(alpha = 0.22f) else Color.White.copy(alpha = 0.10f))
            .border(BorderStroke(if (focused) 2.dp else 0.dp, if (focused) Color.White else Color.Transparent), CircleShape)
            .clickable(onClick = onClick)
            .padding(horizontal = 22.dp, vertical = 10.dp),
    ) {
        Text(label, style = LuminaText.Button.copy(fontSize = 17.sp, color = if (selected) LuminaColors.Bg else LuminaColors.Ink), maxLines = 1)
    }
}

/** A minimal search bar: it looks like a field, and opens Search (where the TV keyboard lives) when selected. */
@Composable
private fun SearchPill(onClick: () -> Unit, modifier: Modifier = Modifier) {
    // Wide and quiet, like YouTube's own: it takes whatever room the Shuffle shape leaves.
    FocusSurface(onClick = onClick, modifier = modifier.fillMaxWidth(), shape = CircleShape, selected = true, scaleOnFocus = 1.0f) {
        Row(Modifier.padding(horizontal = 28.dp, vertical = 18.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Icon(Icons.Filled.Search, contentDescription = null, tint = LuminaColors.Ink2, modifier = Modifier.size(26.dp))
            Text("Search songs and videos", style = LuminaText.Row.copy(color = LuminaColors.Ink3), maxLines = 1)
        }
    }
}
