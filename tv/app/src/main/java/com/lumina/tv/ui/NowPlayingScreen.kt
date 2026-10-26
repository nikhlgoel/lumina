package com.lumina.tv.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Lyrics
import androidx.compose.material.icons.filled.QueueMusic
import androidx.compose.material.icons.filled.ThumbDown
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.toArgb
import androidx.compose.animation.core.animateFloat
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.Player
import androidx.tv.material3.Icon
import androidx.tv.material3.Text
import com.lumina.tv.Graph
import com.lumina.tv.core.ArtworkUrl
import com.lumina.tv.core.Formatting
import com.lumina.tv.core.Lrc
import com.lumina.tv.core.PlaybackSpeed
import com.lumina.tv.data.LyricsRepo
import com.lumina.tv.data.MediaKind
import com.lumina.tv.data.Track
import com.lumina.tv.player.PlaybackController

import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.material.icons.filled.MusicNote

private enum class Panel { None, Lyrics, Queue, More, Related }

/** How far above the bottom edge a tray or popover sits: clear of the progress bar and the transport. */
private val TrayClearance = 150.dp

/**
 * The music screen. While anything is being touched it shows the artwork, large and in the middle, and along the bottom
 * the progress bar with the song's name on the left, the transport (Previous, Play, Next) in the middle, and Lyrics,
 * Up next, Like, More and Watch on the right. After a few quiet seconds everything but the picture fades away, and the
 * picture grows to fill the room: a clear screen to look at from the sofa. With Lyrics open the words take the whole
 * screen over the artwork, behind a translucent veil, and fade down to just the words the same way. The first key
 * pressed after the fade only brings the controls back. Left and Right on the progress bar seek.
 *
 * Nothing on this screen animates while the controls are hidden, which keeps the stick's processor free for the sound.
 */
@Composable
fun NowPlayingScreen(graph: Graph, now: PlaybackController.Now, onClose: () -> Unit, onWatch: (Track, Long) -> Unit) {
    val controller = graph.player
    val player = controller.player
    val ui = rememberPlayerUi(player)
    val speed by controller.speed.collectAsStateWithLifecycle()
    val library by graph.library.items.collectAsStateWithLifecycle()
    val jobs by graph.downloads.jobs.collectAsStateWithLifecycle()
    val queue by controller.streamQueue.collectAsStateWithLifecycle()
    val liked by graph.taste.liked.collectAsStateWithLifecycle()
    var shuffle by remember { mutableStateOf(player.shuffleModeEnabled) }
    var repeat by remember { mutableIntStateOf(player.repeatMode) }
    var panel by remember { mutableStateOf(Panel.None) }
    val playFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { playFocus.requestFocus() } }

    // Back closes the lyrics, queue or More panel first; only then the screen (the shell's own handler).
    BackHandler(enabled = panel != Panel.None) { panel = Panel.None }
    // When a panel closes, the remote lands back on Play instead of being lost where the panel was.
    var hadPanel by remember { mutableStateOf(false) }
    LaunchedEffect(panel) {
        if (panel != Panel.None) hadPanel = true
        else if (hadPanel) { hadPanel = false; kotlinx.coroutines.delay(50); runCatching { playFocus.requestFocus() } }
    }

    // The controls fade after a quiet moment while music plays, and show again for a moment at each new song; any key
    // brings them back (and only does that). Queue and More stay up: they are being used.
    var activity by remember { mutableIntStateOf(0) }
    var controlsVisible by remember { mutableStateOf(true) }
    LaunchedEffect(activity, ui.isPlaying, panel, now.id) {
        controlsVisible = true
        if (ui.isPlaying && (panel == Panel.None || panel == Panel.Lyrics)) { kotlinx.coroutines.delay(graph.settings.controlsHideSeconds * 1000L + 500L); controlsVisible = false }
    }
    val controlsAlpha by androidx.compose.animation.core.animateFloatAsState(
        if (controlsVisible) 1f else 0f, androidx.compose.animation.core.tween(if (controlsVisible) 160 else 600), label = "np-controls",
    )
    // The picture makes room for the controls, and takes the room back when they go.
    val grow by androidx.compose.animation.core.animateFloatAsState(
        if (controlsVisible) 1f else 1.2f, androidx.compose.animation.core.tween(700, easing = androidx.compose.animation.core.FastOutSlowInEasing), label = "np-grow",
    )
    // A tray takes a strip along the bottom, so the cover steps up and shrinks a little to stay clear of it.
    val trayOpen = panel == Panel.Queue || panel == Panel.Related
    val trayShrink by androidx.compose.animation.core.animateFloatAsState(if (trayOpen) 0.72f else 1f, androidx.compose.animation.core.tween(260), label = "np-tray")
    val lyricsMix by androidx.compose.animation.core.animateFloatAsState(if (panel == Panel.Lyrics) 1f else 0f, androidx.compose.animation.core.tween(350), label = "np-lyrics-mix")

    val track = now.sourceUrl?.let { Track(it, now.title, now.artist, 0, now.thumbnail, now.kind) }
    val saved = track != null && library.any { Track.idFromUrl(it.sourceUrl) == track.id && it.kind == now.kind }
    val job = track?.let { t -> jobs.firstOrNull { it.key == "${t.id}:${now.kind.name}" } }
    val isLiked = track != null && liked.any { it.id == track.id }
    val rawTint = rememberArtworkColor(now.thumbnail)
    // Colours cross-fade when the song changes, never snap: the screen should feel like it is breathing with the music.
    val tint by androidx.compose.animation.animateColorAsState(rawTint ?: LuminaColors.SurfaceHigh, androidx.compose.animation.core.tween(1600), label = "np-tint")
    val accent by androidx.compose.animation.animateColorAsState(rawTint?.let(::accentOf) ?: LuminaColors.Amber, androidx.compose.animation.core.tween(1600), label = "np-accent")
    val art = ArtworkUrl.large(now.thumbnail)

    AmbientBackground(
        accent = tint,
        modifier = Modifier
            .onPreviewKeyEvent { e ->
                if (e.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                val wasHidden = !controlsVisible
                activity++
                when {
                    // Seek with the media keys wherever focus is.
                    e.key == Key.MediaFastForward -> { controller.seekBy(10_000); true }
                    e.key == Key.MediaRewind -> { controller.seekBy(-10_000); true }
                    // The first key after the controls faded only brings them back; Back and the media keys still act.
                    wasHidden && e.key != Key.Back && e.key != Key.MediaPlayPause && e.key != Key.MediaPlay && e.key != Key.MediaPause -> true
                    else -> false
                }
            },
    ) {
        // The artwork, a rounded picture in the middle of the page. One static image: nothing here moves.
        if (lyricsMix < 1f) {
            Box(Modifier.fillMaxSize().padding(bottom = 100.dp * controlsAlpha).graphicsLayer { alpha = 1f - lyricsMix }, contentAlignment = Alignment.Center) {
                Box(
                    Modifier.fillMaxHeight(0.6f).aspectRatio(1f, matchHeightConstraintsFirst = true)
                        .graphicsLayer { scaleX = grow * trayShrink; scaleY = grow * trayShrink; translationY = -(1f - trayShrink) * 180.dp.toPx() }
                        .clip(RoundedCornerShape(28.dp)).background(LuminaColors.SurfaceHigh),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Filled.MusicNote, contentDescription = null, tint = LuminaColors.Ink3, modifier = Modifier.size(72.dp))
                    if (art != null) coil.compose.AsyncImage(model = art, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize())
                }
            }
        }

        // With lyrics open: the artwork fills the whole screen, a translucent veil over it, the words on top.
        if (lyricsMix > 0f) {
            // Song thumbnails are often 16:9 with the square cover in the middle and plain bars at the sides: scaled up
            // so the cover fills the width, the bars fall outside the screen.
            var wideThumbnail by remember(art) { mutableStateOf(false) }
            Box(Modifier.fillMaxSize().clipToBounds().graphicsLayer { alpha = lyricsMix }) {
                if (art != null) {
                    coil.compose.AsyncImage(
                        model = art, contentDescription = null, contentScale = ContentScale.Crop,
                        onSuccess = { s -> wideThumbnail = s.painter.intrinsicSize.let { it.height > 0f && it.width / it.height > 1.5f } },
                        modifier = Modifier.fillMaxSize().graphicsLayer { if (wideThumbnail) { scaleX = 1.78f; scaleY = 1.78f } },
                    )
                }
                Box(Modifier.fillMaxSize().background(LuminaColors.Bg.copy(alpha = 0.8f)))
            }
        }
        if (panel == Panel.Lyrics) LyricsPane(graph, now, ui, accent, Modifier.fillMaxSize().padding(horizontal = 140.dp))

        // YouTube Music's "Song | Video" switch, at the top: the same track as a picture, from the same moment in it.
        // It fades with the rest of the controls.
        if (now.streaming && track != null && now.kind == MediaKind.AUDIO) {
            SongVideoToggle(
                video = false, onSong = {}, onVideo = { onWatch(track, ui.positionMs) },
                modifier = Modifier.align(Alignment.TopCenter).padding(top = 30.dp).graphicsLayer { alpha = controlsAlpha },
            )
        }

        if (ui.buffering) {
            Text(
                "Loading…", style = LuminaText.Row.copy(color = accent),
                // Below the Song | Video switch, not on top of it.
                modifier = Modifier.align(Alignment.TopCenter).padding(top = 96.dp).background(Color(0x99000000), CircleShape).padding(horizontal = 22.dp, vertical = 8.dp),
            )
        }

        // Everything else lives in one block along the bottom, and fades as one.
        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().graphicsLayer { alpha = controlsAlpha }
                .background(Brush.verticalGradient(listOf(Color.Transparent, LuminaColors.Bg.copy(alpha = 0.92f))))
                .padding(start = 56.dp, end = 56.dp, top = 72.dp, bottom = 34.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            SeekBar(ui, accent, onSeek = controller::seekBy, onToggle = controller::togglePlay)

            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f).padding(end = 24.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(now.title, style = LuminaText.Title.copy(fontSize = 24.sp), maxLines = 1)
                    if (now.artist.isNotBlank()) Text(now.artist, style = LuminaText.Body.copy(color = LuminaColors.Ink2), maxLines = 1)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    BareIconButton(PlayerIcons.Previous, "Previous", 64.dp, onClick = controller::previous)
                    PlayButton(
                        playing = ui.isPlaying, ended = ui.ended, onClick = controller::togglePlay, accent = accent,
                        modifier = Modifier.focusRequester(playFocus),
                    )
                    BareIconButton(PlayerIcons.Next, "Next", 64.dp, onClick = controller::next, enabled = controller.hasNext() || queue.hasNext)
                }
                Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(4.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically) {
                    TextTab("Lyrics", selected = panel == Panel.Lyrics) { panel = if (panel == Panel.Lyrics) Panel.None else Panel.Lyrics }
                    TextTab("Up next", selected = panel == Panel.Queue) { panel = if (panel == Panel.Queue) Panel.None else Panel.Queue }
                    // A third tab, matching real YouTube Music's Up next/Lyrics/Related row (checked on the
                    // owner's phone, docs/18 §3). Only shown once there is a track to find related songs for.
                    if (track != null) {
                        TextTab("Related", selected = panel == Panel.Related) { panel = if (panel == Panel.Related) Panel.None else Panel.Related }
                    }
                    if (track != null) {
                        BareIconButton(if (isLiked) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder, if (isLiked) "Unlike" else "Like", 48.dp, active = isLiked, onClick = { graph.taste.toggleLike(track) })
                    }
                    BareIconButton(PlayerIcons.More, "More", 48.dp, active = panel == Panel.More, onClick = { panel = if (panel == Panel.More) Panel.None else Panel.More })
                }
            }
        }

        when (panel) {
            Panel.Queue -> QueuePanel(graph, queue, accent, Modifier.align(Alignment.BottomCenter).padding(bottom = TrayClearance))
            Panel.More -> MorePanel(
                downloadLabel = when {
                    saved -> "Saved on this device"
                    job != null && job.active -> "Downloading ${(job.fraction * 100).toInt()}%"
                    else -> "Download"
                },
                downloadIcon = if (saved) PlayerIcons.Downloaded else PlayerIcons.Download,
                canDownload = now.streaming && track != null && now.kind == MediaKind.AUDIO && !saved && job?.active != true,
                onDownload = { if (track != null) graph.downloads.enqueue(track) },
                shuffle = shuffle, onShuffle = { shuffle = !shuffle; player.shuffleModeEnabled = shuffle },
                repeat = repeat,
                onRepeat = {
                    repeat = when (repeat) { Player.REPEAT_MODE_OFF -> Player.REPEAT_MODE_ALL; Player.REPEAT_MODE_ALL -> Player.REPEAT_MODE_ONE; else -> Player.REPEAT_MODE_OFF }
                    player.repeatMode = repeat
                },
                speed = speed,
                onSpeed = { controller.setSpeed(if (speed >= PlaybackSpeed.max) PlaybackSpeed.min else PlaybackSpeed.step(speed, 1)) },
                canDislike = track != null,
                onDislike = { if (track != null) { graph.taste.dislike(track); panel = Panel.None; controller.next() } },
                modifier = Modifier.align(Alignment.BottomEnd).padding(end = 56.dp, bottom = TrayClearance)
                    .onPreviewKeyEvent { e -> if (e.type == KeyEventType.KeyDown && e.key == Key.DirectionLeft) { panel = Panel.None; true } else false },
            )
            Panel.Related -> track?.let { RelatedPanel(graph, it, accent, Modifier.align(Alignment.BottomCenter).padding(bottom = TrayClearance)) }
            else -> Unit
        }
    }
}

/** A bare icon: no box until the remote is on it, then a white disc. Most controls on this screen look like this. */
@Composable
private fun BareIconButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector, description: String, size: androidx.compose.ui.unit.Dp,
    onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, active: Boolean = false,
) {
    var focused by remember { mutableStateOf(false) }
    Box(
        modifier.size(size)
            .onFocusChanged { focused = it.isFocused }
            .clip(CircleShape)
            .background(if (focused) Color.White else Color.Transparent, CircleShape)
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            icon, contentDescription = description, modifier = Modifier.size(size * 0.6f),
            tint = when { !enabled -> LuminaColors.Ink3; focused -> LuminaColors.Bg; active -> LuminaColors.Amber; else -> LuminaColors.Ink },
        )
    }
}

/** "Lyrics", "Up next": words, not buttons. The open one has a short bar of accent colour under it. */
@Composable
private fun TextTab(label: String, selected: Boolean, onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    Column(
        Modifier
            .onFocusChanged { focused = it.isFocused }
            .clip(RoundedCornerShape(14.dp))
            .background(if (focused) Color.White.copy(alpha = 0.16f) else Color.Transparent, RoundedCornerShape(14.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(label, style = LuminaText.Row.copy(fontSize = 18.sp, color = if (selected || focused) LuminaColors.Ink else LuminaColors.Ink2))
        Box(Modifier.padding(top = 4.dp).size(width = 22.dp, height = 3.dp).background(if (selected) LuminaColors.Amber else Color.Transparent, CircleShape))
    }
}

/**
 * "Song | Video": the switch at the top of both players, as on YouTube Music. The side you are on is a light pill; the
 * other, when chosen, hands the same track and the same moment to the other player. [video] says which side is current.
 */
@Composable
internal fun SongVideoToggle(video: Boolean, onSong: () -> Unit, onVideo: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier.clip(CircleShape).background(Color.White.copy(alpha = 0.12f), CircleShape).padding(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ToggleSide("Song", selected = !video, onClick = onSong)
        ToggleSide("Video", selected = video, onClick = onVideo)
    }
}

@Composable
private fun ToggleSide(label: String, selected: Boolean, onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    Box(
        Modifier
            .onFocusChanged { focused = it.isFocused }
            .clip(CircleShape)
            .background(if (selected) Color(0xFFF1F1F1) else if (focused) Color.White.copy(alpha = 0.22f) else Color.Transparent, CircleShape)
            .border(BorderStroke(if (focused) 2.dp else 0.dp, if (focused) Color.White else Color.Transparent), CircleShape)
            .clickable(onClick = onClick)
            .padding(horizontal = 30.dp, vertical = 9.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = LuminaText.Button.copy(fontSize = 18.sp, color = if (selected) LuminaColors.Bg else LuminaColors.Ink), maxLines = 1)
    }
}

/** Everything that is not used every minute, in one place, each with a word and its current state. */
@Composable
private fun MorePanel(
    downloadLabel: String, downloadIcon: androidx.compose.ui.graphics.vector.ImageVector, canDownload: Boolean, onDownload: () -> Unit,
    shuffle: Boolean, onShuffle: () -> Unit, repeat: Int, onRepeat: () -> Unit,
    speed: Float, onSpeed: () -> Unit, canDislike: Boolean, onDislike: () -> Unit, modifier: Modifier = Modifier,
) {
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) { first.requestWhenReady() }
    Popover(modifier, width = 380.dp) {
        MoreRow(downloadIcon, downloadLabel, null, enabled = canDownload, onClick = onDownload, modifier = Modifier.focusRequester(first))
        MoreRow(PlayerIcons.Shuffle, "Shuffle", if (shuffle) "On" else "Off", active = shuffle, onClick = onShuffle)
        MoreRow(
            if (repeat == Player.REPEAT_MODE_ONE) PlayerIcons.RepeatOne else PlayerIcons.Repeat, "Repeat",
            when (repeat) { Player.REPEAT_MODE_ALL -> "All"; Player.REPEAT_MODE_ONE -> "One"; else -> "Off" },
            active = repeat != Player.REPEAT_MODE_OFF, onClick = onRepeat,
        )
        MoreRow(PlayerIcons.Speed, "Speed", if (speed == 1f) "Normal" else PlaybackSpeed.label(speed), active = speed != 1f, onClick = onSpeed)
        if (canDislike) MoreRow(Icons.Filled.ThumbDown, "Not for me", "Skips it, plays less like it", onClick = onDislike)
    }
}

@Composable
private fun MoreRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, state: String?, onClick: () -> Unit,
    modifier: Modifier = Modifier, enabled: Boolean = true, active: Boolean = false,
) {
    FocusSurface(onClick = { if (enabled) onClick() }, modifier = modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp)) { focused ->
        Row(Modifier.padding(horizontal = 14.dp, vertical = 11.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(26.dp), tint = if (!enabled) LuminaColors.Ink3 else if (active) LuminaColors.Amber else if (focused) Color.White else LuminaColors.Ink2)
            Text(label, style = LuminaText.Row.copy(color = if (enabled) LuminaColors.Ink else LuminaColors.Ink3), modifier = Modifier.weight(1f), maxLines = 1)
            if (state != null) Text(state, style = LuminaText.Small.copy(color = if (active) LuminaColors.Amber else LuminaColors.Ink2), maxLines = 1)
        }
    }
}

/** The big round primary control: the one thing on this screen that should be found without looking. */
@Composable
private fun PlayButton(playing: Boolean, ended: Boolean, onClick: () -> Unit, accent: Color, modifier: Modifier = Modifier) {
    FocusSurface(onClick = onClick, modifier = modifier.size(76.dp), shape = CircleShape, selected = true, scaleOnFocus = 1.08f) { focused ->
        Box(Modifier.fillMaxSize().background(if (focused) Color.White else accent, CircleShape), contentAlignment = Alignment.Center) {
            Icon(
                when { ended -> PlayerIcons.Replay; playing -> PlayerIcons.Pause; else -> PlayerIcons.Play },
                contentDescription = if (playing) "Pause" else "Play", tint = LuminaColors.Bg, modifier = Modifier.size(46.dp),
            )
        }
    }
}

/** Progress you can steer: focus it and press Left or Right to seek ten seconds, Select to pause. Thicker while focused. */
@Composable
private fun SeekBar(ui: PlayerUi, accent: Color, onSeek: (Long) -> Unit, onToggle: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    Row(
        Modifier.fillMaxWidth()
            .onFocusChanged { focused = it.isFocused }
            .focusable()
            .onPreviewKeyEvent { e ->
                if (e.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                when (e.key) {
                    Key.DirectionLeft -> { onSeek(-10_000); true }
                    Key.DirectionRight -> { onSeek(10_000); true }
                    Key.DirectionCenter, Key.Enter -> { onToggle(); true }
                    else -> false
                }
            }
            .border(BorderStroke(if (focused) 2.dp else 0.dp, if (focused) LuminaColors.Amber else Color.Transparent), RoundedCornerShape(12.dp))
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text(Formatting.duration(ui.positionMs / 1000), style = LuminaText.Small)
        Box(Modifier.weight(1f).height(if (focused) 8.dp else 4.dp).background(LuminaColors.SurfaceHigh, CircleShape)) {
            Box(Modifier.fillMaxWidth(if (ui.durationMs > 0) (ui.bufferedMs.toFloat() / ui.durationMs).coerceIn(0f, 1f) else 0f).fillMaxHeight().background(LuminaColors.Ink3.copy(alpha = 0.35f), CircleShape))
            Box(Modifier.fillMaxWidth(ui.fraction).fillMaxHeight().background(accent, CircleShape))
        }
        Text(Formatting.duration(ui.durationMs / 1000), style = LuminaText.Small)
    }
}

private sealed interface LyricsState {
    data object Loading : LyricsState
    data class Ready(val lyrics: LyricsRepo.Lyrics) : LyricsState
    data object None : LyricsState
    data object Offline : LyricsState
}

/**
 * The lyrics over the whole screen. Timed lyrics follow the song and keep the line being sung in the middle. A song
 * in another language shows each line as written, then in Latin letters when its script is not Latin, then in English,
 * so it can be read and understood whatever it is sung in.
 */
@Composable
private fun LyricsPane(graph: Graph, now: PlaybackController.Now, ui: PlayerUi, accent: Color, modifier: Modifier = Modifier) {
    var state by remember(now.id) { mutableStateOf<LyricsState>(LyricsState.Loading) }
    var attempt by remember { mutableIntStateOf(0) }
    val latestUi by androidx.compose.runtime.rememberUpdatedState(ui)
    LaunchedEffect(now.id, attempt) {
        state = LyricsState.Loading
        // The song's length is what tells two recordings of one title apart: wait for the player to know it.
        var waited = 0
        val durationAtStartMs = latestUi.durationMs
        while (latestUi.durationMs <= 0 && waited < 4000) { kotlinx.coroutines.delay(100); waited += 100 }
        val seconds = if (latestUi.durationMs > 0) latestUi.durationMs / 1000 else 0L
        // For the lyrics log only: a length that is already set the moment the song changes can still be the PREVIOUS
        // song's (the player keeps the old value until the new one is known), which would pick the wrong recording.
        val lookupContext = "media=${now.id} kind=${now.kind} streaming=${now.streaming} url=${now.sourceUrl} " +
            "playerLengthAtStart=${durationAtStartMs}ms waited=${waited}ms lengthUsed=${seconds}s position=${latestUi.positionMs}ms"
        when (val r = graph.lyrics.load(now.title, now.artist, seconds, lookupContext)) {
            is LyricsRepo.Result.Found -> {
                state = LyricsState.Ready(r.lyrics)
                // The words show at once; the English follows when it arrives.
                if (graph.settings.lyricsTranslate) {
                    val annotated = graph.lyrics.withTranslation(r.lyrics)
                    val shown = if (graph.settings.lyricsLatin) annotated else annotated.copy(romanized = null)
                    if (shown !== r.lyrics) state = LyricsState.Ready(shown)
                }
            }
            LyricsRepo.Result.NotFound -> state = LyricsState.None
            LyricsRepo.Result.Unreachable -> state = LyricsState.Offline
        }
    }
    Box(modifier, contentAlignment = Alignment.Center) {
        when (val st = state) {
            LyricsState.Loading -> Text("Finding the lyrics…", style = LuminaText.Title)
            LyricsState.None -> Text("No lyrics found for this song.", style = LuminaText.Title, textAlign = TextAlign.Center)
            LyricsState.Offline -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text("Couldn't reach the lyrics service.", style = LuminaText.Title, textAlign = TextAlign.Center)
                Text("Check the connection, then try again.", style = LuminaText.Body)
                val retry = remember { FocusRequester() }
                LaunchedEffect(Unit) { runCatching { retry.requestFocus() } }
                LButton("Try again", { attempt++ }, primary = true, modifier = Modifier.focusRequester(retry))
            }
            is LyricsState.Ready -> {
                val l = st.lyrics
                val listState = rememberLazyListState()
                val active = if (l.timed) Lrc.activeIndex(l.lines, ui.positionMs) else -1
                LaunchedEffect(active) {
                    if (active >= 0) listState.animateScrollToItem(active, scrollOffset = -260)
                }
                Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        listOfNotNull(
                            l.language?.let { code -> java.util.Locale.forLanguageTag(code).getDisplayLanguage(java.util.Locale.ENGLISH).takeIf { it.isNotBlank() } },
                            if (l.english != null) "English shown below, translated by machine" else null,
                            "from ${l.source}",
                        ).joinToString(" · "),
                        style = LuminaText.Small, modifier = Modifier.padding(top = 30.dp),
                    )
                    LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = listState, verticalArrangement = Arrangement.spacedBy(22.dp), contentPadding = PaddingValues(top = 120.dp, bottom = 260.dp)) {
                        itemsIndexed(l.lines) { i, line ->
                            LyricLine(
                                line.text, romanized = l.romanized?.getOrNull(i), english = l.english?.getOrNull(i),
                                distance = if (l.timed) kotlin.math.abs(i - active) else 1, current = i == active, timed = l.timed, accent = accent,
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * One line of lyrics: as written, in Latin letters when that helps, and in English when the song is in another
 * language. The line being sung grows and takes the song's accent colour; those around it fade with distance.
 */
@Composable
private fun LyricLine(text: String, romanized: String?, english: String?, distance: Int, current: Boolean, timed: Boolean, accent: Color) {
    val scale by androidx.compose.animation.core.animateFloatAsState(if (current) 1f else 0.84f, androidx.compose.animation.core.tween(420), label = "lyric-scale")
    val alpha by androidx.compose.animation.core.animateFloatAsState(
        if (!timed) 0.92f else when (distance) { 0 -> 1f; 1 -> 0.62f; 2 -> 0.4f; else -> 0.26f },
        androidx.compose.animation.core.tween(420), label = "lyric-alpha",
    )
    val color by androidx.compose.animation.animateColorAsState(if (current) accent else LuminaColors.Ink, androidx.compose.animation.core.tween(420), label = "lyric-color")
    Column(
        Modifier.fillMaxWidth()
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .alpha(alpha)
            .then(if (timed) Modifier else Modifier.focusable()),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            text, textAlign = TextAlign.Center,
            style = LuminaText.Title.copy(fontSize = 34.sp, fontWeight = if (current) androidx.compose.ui.text.font.FontWeight.Bold else androidx.compose.ui.text.font.FontWeight.Medium, color = color),
        )
        if (romanized != null && !romanized.equals(text, ignoreCase = true)) {
            Text(romanized, textAlign = TextAlign.Center, style = LuminaText.Body.copy(fontSize = 22.sp, color = LuminaColors.Ink2))
        }
        if (english != null) {
            Text(english, textAlign = TextAlign.Center, style = LuminaText.Body.copy(fontSize = 24.sp, color = if (current) accent.copy(alpha = 0.9f) else LuminaColors.Ink2))
        }
    }
}

/** Four bars that dance while music plays and settle low when it stops: a small sign that the screen is live. */
@Composable
private fun EqBars(active: Boolean, color: Color) {
    val t = androidx.compose.animation.core.rememberInfiniteTransition(label = "eq")
    val periods = listOf(520, 740, 610, 880)
    val levels = periods.mapIndexed { i, ms ->
        t.animateFloat(0.25f, 1f, androidx.compose.animation.core.infiniteRepeatable(androidx.compose.animation.core.tween(ms, easing = androidx.compose.animation.core.FastOutSlowInEasing), androidx.compose.animation.core.RepeatMode.Reverse), label = "eq$i")
    }
    Row(horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.Bottom, modifier = Modifier.height(20.dp)) {
        for (level in levels) {
            Box(
                Modifier.size(width = 4.dp, height = 20.dp)
                    .graphicsLayer { scaleY = if (active) level.value else 0.2f; transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0.5f, 1f) }
                    .background(color, RoundedCornerShape(2.dp)),
            )
        }
    }
}

/**
 * What is coming up, as a tray of covers along the bottom (the picture stays visible above it). Saved-file queues come from the
 * player; streamed ones from the controller. The playing song is marked and holds the remote when the tray opens.
 */
@Composable
private fun QueuePanel(graph: Graph, queue: PlaybackController.StreamQueue, accent: Color, modifier: Modifier = Modifier) {
    val player = graph.player.player
    val items: List<TrayItem> = if (queue.tracks.isNotEmpty()) {
        queue.tracks.map { TrayItem(it.title, it.artist, it.thumbnailUrl, it.kind) }
    } else {
        (0 until player.mediaItemCount).map { i ->
            player.getMediaItemAt(i).mediaMetadata.let { TrayItem(it.title?.toString().orEmpty(), it.artist?.toString().orEmpty(), it.artworkUri?.toString()) }
        }
    }
    val current = if (queue.tracks.isNotEmpty()) queue.index else player.currentMediaItemIndex
    PlayerTray("Up next", com.lumina.tv.core.Formatting.count(items.size, "song"), modifier) {
        if (items.size <= 1) Text("Nothing else is lined up. Play a song from a row on Home to line up the rest of that row.", style = LuminaText.Small)
        else TrayRow(items, current, accent, onPick = { i -> if (queue.tracks.isNotEmpty()) graph.player.playQueueIndex(i) else player.seekToDefaultPosition(i) })
    }
}

/**
 * Songs picked for being like the one playing, as a tray: YouTube Music's "Related" tab (docs/18 §3). Selecting a card plays it
 * straight away, the same as every other list in the app, rather than queuing silently.
 */
@Composable
private fun RelatedPanel(graph: Graph, seed: Track, accent: Color, modifier: Modifier = Modifier) {
    var items by remember(seed.id) { mutableStateOf<List<Track>?>(null) }
    var failed by remember(seed.id) { mutableStateOf(false) }
    LaunchedEffect(seed.id) {
        failed = false
        items = null
        items = try {
            graph.repo.related(seed, limit = 20)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Throwable) {
            failed = true
            emptyList()
        }
    }
    PlayerTray("Related", null, modifier) {
        val list = items
        when {
            list == null -> { Text("Finding related songs", style = LuminaText.Small); ThinProgress(Modifier.width(240.dp)) }
            failed -> Text("Couldn't load related songs. Check the connection, then open Related again.", style = LuminaText.Small)
            list.isEmpty() -> Text("Nothing related found for this song.", style = LuminaText.Small)
            else -> TrayRow(list.map { TrayItem(it.title, it.artist, it.thumbnailUrl, it.kind) }, current = -1, accent = accent, onPick = { graph.player.playStreamQueue(list, it) })
        }
    }
}

/**
 * The cover for Now Playing, painted once into one bitmap: centre-cropped to the pane, washed with the song's own
 * colour, then faded out to the left and at the bottom so the page's glow shows through (the same look the old offscreen
 * layer and blend modes gave, without redoing it every frame). Built off the main thread; until a new one is ready the
 * previous song's stays, and they cross-fade. Null until the first is ready.
 */
@Composable
private fun rememberBakedCover(url: String?, tint: Color?): androidx.compose.ui.graphics.ImageBitmap? {
    val context = androidx.compose.ui.platform.LocalContext.current
    val metrics = context.resources.displayMetrics
    val width = (metrics.widthPixels * 0.68f).toInt().coerceAtLeast(2)
    val height = metrics.heightPixels.coerceAtLeast(2)
    var baked by remember { mutableStateOf<androidx.compose.ui.graphics.ImageBitmap?>(null) }
    val latestTint by androidx.compose.runtime.rememberUpdatedState(tint)
    LaunchedEffect(url, width, height) {
        if (url.isNullOrBlank()) return@LaunchedEffect
        // The colour is found by a second, parallel request: give it a moment so the wash is in the first picture.
        kotlinx.coroutines.delay(150)
        val wash = latestTint
        val picture = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) { bakeCover(context, url, width, height, wash) }
        if (picture != null) baked = picture
    }
    return baked
}

private suspend fun bakeCover(context: android.content.Context, url: String, width: Int, height: Int, wash: Color?): androidx.compose.ui.graphics.ImageBitmap? = runCatching {
    val request = coil.request.ImageRequest.Builder(context).data(url).allowHardware(false).size(width, height).scale(coil.size.Scale.FILL).build()
    val source = ((coil.Coil.imageLoader(context).execute(request) as? coil.request.SuccessResult)?.drawable as? android.graphics.drawable.BitmapDrawable)?.bitmap
        ?: return@runCatching null
    val out = android.graphics.Bitmap.createBitmap(width, height, android.graphics.Bitmap.Config.ARGB_8888)
    val canvas = android.graphics.Canvas(out)
    // Centre-crop the picture to fill the pane.
    val scale = maxOf(width.toFloat() / source.width, height.toFloat() / source.height)
    val matrix = android.graphics.Matrix().apply {
        postScale(scale, scale)
        postTranslate((width - source.width * scale) / 2f, (height - source.height * scale) / 2f)
    }
    canvas.drawBitmap(source, matrix, android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG))
    val w = width.toFloat()
    val h = height.toFloat()
    // Its own colour washed over it (only where there is picture), strongest on the right.
    if (wash != null) {
        val c = wash.toArgb()
        val paint = android.graphics.Paint().apply {
            shader = android.graphics.LinearGradient(
                0f, 0f, w, 0f,
                intArrayOf(android.graphics.Color.TRANSPARENT, withAlpha(c, 0.22f), withAlpha(c, 0.3f)), floatArrayOf(0f, 0.5f, 1f), android.graphics.Shader.TileMode.CLAMP,
            )
            xfermode = android.graphics.PorterDuffXfermode(android.graphics.PorterDuff.Mode.SRC_ATOP)
        }
        canvas.drawRect(0f, 0f, w, h, paint)
    }
    // Fade out to the left and at the bottom: black stands for "remove this much picture".
    fun cutOut(shader: android.graphics.Shader) {
        canvas.drawRect(0f, 0f, w, h, android.graphics.Paint().apply {
            this.shader = shader
            xfermode = android.graphics.PorterDuffXfermode(android.graphics.PorterDuff.Mode.DST_OUT)
        })
    }
    val black = android.graphics.Color.BLACK
    cutOut(android.graphics.LinearGradient(0f, 0f, w, 0f, intArrayOf(black, black, withAlpha(black, 0.4f), android.graphics.Color.TRANSPARENT), floatArrayOf(0f, 0.16f, 0.55f, 1f), android.graphics.Shader.TileMode.CLAMP))
    cutOut(android.graphics.LinearGradient(0f, 0f, 0f, h, intArrayOf(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT, withAlpha(black, 0.85f)), floatArrayOf(0f, 0.65f, 1f), android.graphics.Shader.TileMode.CLAMP))
    out.asImageBitmap()
}.getOrNull()

private fun withAlpha(color: Int, alpha: Float): Int =
    (color and 0x00FFFFFF) or ((alpha.coerceIn(0f, 1f) * 255f).toInt() shl 24)
