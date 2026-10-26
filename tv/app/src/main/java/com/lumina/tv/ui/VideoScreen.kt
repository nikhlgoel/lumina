package com.lumina.tv.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Audiotrack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Headphones
import androidx.compose.material.icons.filled.HighQuality
import androidx.compose.material.icons.filled.Info
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.CaptionStyleCompat
import androidx.media3.ui.PlayerView
import androidx.media3.ui.SubtitleView
import androidx.tv.material3.Icon
import androidx.tv.material3.Text
import com.lumina.tv.Graph
import com.lumina.tv.core.ControlsVisibility
import com.lumina.tv.core.Formatting
import com.lumina.tv.core.PlaybackSpeed
import com.lumina.tv.data.Track
import com.lumina.tv.player.PlaybackController
import kotlinx.coroutines.delay

/** The pages of the settings sheet, as in YouTube's player: a list of settings, each opening its own list of choices. */
private enum class Sheet(val title: String) {
    Main("Settings"), Quality("Quality"), Speed("Playback speed"), Audio("Audio language"), Subtitles("Subtitles"),
}

/**
 * Full-screen video, laid out like YouTube's player on a TV. The controls show for a few seconds and then get out of
 * the way; any remote button brings them back; left and right seek (hold to go faster).
 *
 * Bottom: the progress bar, then Play/Pause (with Previous and Next when there is a queue) on the left, and on the
 * right Subtitles (CC) and Settings. Settings is a sheet down the right edge: Quality, Playback speed, Audio language,
 * Subtitles, Listen only, Download and Stats for nerds, each opening a short list of choices.
 */
@Composable
fun VideoScreen(graph: Graph, now: PlaybackController.Now, onExit: () -> Unit, onListen: (Track, Long) -> Unit) {
    val controller = graph.player
    val ui = rememberPlayerUi(controller.player)
    val speed by controller.speed.collectAsStateWithLifecycle()
    val loading by controller.loading.collectAsStateWithLifecycle()
    val queue by controller.streamQueue.collectAsStateWithLifecycle()
    val library by graph.library.items.collectAsStateWithLifecycle()
    val jobs by graph.downloads.jobs.collectAsStateWithLifecycle()
    val track = now.sourceUrl?.let { Track(it, now.title, now.artist, 0, now.thumbnail, now.kind) }
    val saved = track != null && library.any { Track.idFromUrl(it.sourceUrl) == track.id && it.kind == now.kind }
    val job = track?.let { t -> jobs.firstOrNull { it.key == "${t.id}:${now.kind.name}" } }

    var idleElapsed by remember { mutableStateOf(false) }
    var interaction by remember { mutableIntStateOf(0) }
    var sheet by remember { mutableStateOf<Sheet?>(null) }
    // Opened from Settings, a sub-page's Back returns to Settings; opened from the CC button, Back closes the sheet.
    var fromSettings by remember { mutableStateOf(false) }
    var stats by remember { mutableStateOf(false) }
    var osd by remember { mutableStateOf<Pair<Int, String>?>(null) }
    var osdId by remember { mutableIntStateOf(0) }

    val rootFocus = remember { FocusRequester() }
    val seekFocus = remember { FocusRequester() }

    // The decision is the tested core rule: hide only while playing, after stillness, with no sheet open.
    val shown = !ControlsVisibility.hidden(idle = idleElapsed, playing = ui.isPlaying, menuOpen = sheet != null)

    fun wake() { idleElapsed = false; interaction++ }
    fun flash(text: String) { osdId++; osd = osdId to text }
    fun seek(seconds: Int) {
        controller.seekBy(seconds * 1000L)
        flash("${if (seconds > 0) "+" else "−"}${kotlin.math.abs(seconds)} s")
    }
    fun closeSheet() { sheet = null; wake() }

    // Every interaction restarts the countdown.
    LaunchedEffect(interaction) {
        idleElapsed = false
        delay(graph.settings.controlsHideSeconds * 1000L)
        idleElapsed = true
    }
    LaunchedEffect(osd) { if (osd != null) { delay(900); osd = null } }

    // Focus follows visibility: onto the progress bar when the controls appear, back to the screen
    // itself when they go, so a remote button is never delivered to something that is not there.
    // While the sheet is open it owns the focus.
    LaunchedEffect(shown, sheet) { if (sheet == null) runCatching { if (shown) seekFocus.requestFocus() else rootFocus.requestFocus() } }

    // Keep the TV awake while a picture is on screen.
    val view = androidx.compose.ui.platform.LocalView.current
    DisposableEffect(Unit) {
        view.keepScreenOn = true
        onDispose { view.keepScreenOn = false }
    }

    // Back steps out one level at a time: a sub-page to Settings, Settings to the player, then the stats panel.
    BackHandler(enabled = sheet != null || stats) {
        when {
            sheet != null && sheet != Sheet.Main && fromSettings -> sheet = Sheet.Main
            sheet != null -> closeSheet()
            else -> stats = false
        }
    }

    // Buffering for a long time almost always means the line is too slow for this resolution, and a
    // bare "Loading…" gives the viewer nothing to do about it. Say what will help.
    var slow by remember { mutableStateOf(false) }
    var loweredFor by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(ui.buffering, loading) {
        slow = false
        if (ui.buffering || loading) {
            delay(10_000)
            slow = true
            // Still stuck on the picture (not on finding the video) after ten seconds: step down one size, once per video,
            // instead of leaving it to the person to find the menu. The player carries on from the same second.
            val current = controller.now.value
            val stalled = !controller.loading.value && controller.player.playbackState == androidx.media3.common.Player.STATE_BUFFERING
            if (stalled && current != null && loweredFor != current.id && current.qualityIndex in 0 until current.qualities.lastIndex) {
                loweredFor = current.id
                val lower = current.qualityIndex + 1
                controller.setQuality(lower)
                flash("Lowered to ${current.qualities[lower].label}")
            }
        }
    }

    Box(
        Modifier.fillMaxSize().background(Color.Black)
            .focusRequester(rootFocus)
            .focusable()
            .onPreviewKeyEvent { e ->
                if (e.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                val wasShown = shown
                wake()
                when (e.key) {
                    Key.MediaPlayPause, Key.MediaPlay, Key.MediaPause -> { controller.togglePlay(); true }
                    Key.MediaFastForward -> { seek(30); true }
                    Key.MediaRewind -> { seek(-30); true }
                    // With the controls hidden the whole screen is the control: Select toggles, sides seek.
                    Key.DirectionCenter, Key.Enter, Key.NumPadEnter ->
                        if (!wasShown && sheet == null) { controller.togglePlay(); flash(if (ui.isPlaying) "❚❚ Paused" else "▶ Play"); true } else false
                    Key.DirectionLeft -> if (!wasShown && sheet == null) { seek(-seekStep(e)); true } else false
                    Key.DirectionRight -> if (!wasShown && sheet == null) { seek(seekStep(e)); true } else false
                    Key.DirectionUp, Key.DirectionDown -> !wasShown && sheet == null
                    else -> false
                }
            },
    ) {
        AndroidView(
            factory = { ctx ->
                PlayerView(ctx).apply {
                    useController = false
                    setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER)
                    resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                    player = controller.player
                    subtitleView?.apply {
                        // Clear of the edge TVs may crop, large enough for a sofa, outlined so any picture reads.
                        setBottomPaddingFraction(0.12f)
                        setFractionalTextSize(SubtitleView.DEFAULT_TEXT_SIZE_FRACTION * listOf(1.0f, 1.25f, 1.6f)[graph.settings.subtitleSize])
                        setApplyEmbeddedStyles(false)
                        setStyle(
                            CaptionStyleCompat(
                                android.graphics.Color.WHITE, android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT,
                                CaptionStyleCompat.EDGE_TYPE_OUTLINE, android.graphics.Color.BLACK, null,
                            ),
                        )
                    }
                }
            },
            onRelease = { it.player = null },
            modifier = Modifier.fillMaxSize(),
        )

        if (loading || ui.buffering) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.background(Color(0x99000000), RoundedCornerShape(20.dp)).padding(horizontal = 32.dp, vertical = 18.dp)) {
                    Text(if (loading) "Getting the video…" else "Loading…", style = LuminaText.Title.copy(color = LuminaColors.Amber))
                    if (slow) Text("Taking a while. Open Settings and choose a lower quality.", style = LuminaText.Body)
                }
            }
        }

        osd?.let { (id, text) ->
            key(id) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(text, style = LuminaText.Display, modifier = Modifier.background(Color(0x99000000), RoundedCornerShape(40.dp)).padding(horizontal = 36.dp, vertical = 14.dp))
                }
            }
        }

        if (stats) StatsPanel(controller, Modifier.align(Alignment.TopStart).padding(start = 64.dp, top = 120.dp))

        if (shown) {
            // Top: the title and who made it, over a scrim so it reads against a bright picture without dimming it.
            Column(
                Modifier.fillMaxWidth().align(Alignment.TopCenter).background(Brush.verticalGradient(listOf(Color(0xCC000000), Color.Transparent))).padding(horizontal = 64.dp, vertical = 36.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                // Only the left 40% of the screen: the Song | Video switch sits in the middle, and a long title ran under it.
                Text(now.title, style = LuminaText.Title.copy(fontSize = 24.sp), maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, modifier = Modifier.fillMaxWidth(0.4f))
                if (now.artist.isNotBlank()) Text(now.artist, style = LuminaText.Body, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, modifier = Modifier.fillMaxWidth(0.4f))
            }
            // The same "Song | Video" switch as the music screen, with Video current: one press hands this track, from
            // this moment, back to the audio player.
            if (track != null && now.streaming) {
                SongVideoToggle(
                    video = true, onSong = { onListen(track, ui.positionMs) }, onVideo = {},
                    modifier = Modifier.align(Alignment.TopCenter).padding(top = 30.dp),
                )
            }

            Column(
                Modifier.fillMaxWidth().align(Alignment.BottomCenter)
                    .background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xE6000000))))
                    .padding(start = 64.dp, end = 64.dp, top = 56.dp, bottom = 40.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                SeekControl(ui, focus = seekFocus, onSeek = { seek(it) }, onToggle = { controller.togglePlay() }, step = ::seekStep)

                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    // Left: play, then the queue.
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        RoundPlayButton(playing = ui.isPlaying, ended = ui.ended, onClick = controller::togglePlay)
                        if (queue.hasPrevious) LIconButton(PlayerIcons.Previous, "Previous", onClick = controller::previous)
                        if (controller.hasNext()) LIconButton(PlayerIcons.Next, "Next", onClick = controller::next)
                    }
                    Box(Modifier.weight(1f))
                    // Right: subtitles and settings.
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        if (now.hasSubtitles) {
                            LIconButton(
                                PlayerIcons.Subtitles,
                                if (now.subtitleIndex >= 0) "Subtitles: ${now.subtitles[now.subtitleIndex]}" else "Subtitles",
                                active = now.subtitleIndex >= 0,
                                onClick = { if (sheet == Sheet.Subtitles) closeSheet() else { fromSettings = false; sheet = Sheet.Subtitles } },
                            )
                        }
                        LIconButton(PlayerIcons.Settings, "Settings", active = sheet != null && fromSettings, onClick = { if (sheet != null && fromSettings) closeSheet() else { fromSettings = true; sheet = Sheet.Main } })
                    }
                }
            }
        }

        sheet?.let { page ->
            SettingsSheet(
                page = page, now = now, speed = speed, saved = saved,
                downloadPercent = job?.takeIf { it.active }?.let { (it.fraction * 100).toInt() },
                stats = stats, canListen = track != null && now.streaming, canDownload = track != null && now.streaming,
                onOpen = { fromSettings = true; sheet = it },
                onQuality = { controller.setQuality(it); closeSheet() },
                onSpeed = { controller.setSpeed(PlaybackSpeed.steps[it]); closeSheet() },
                onAudio = { controller.setAudioTrack(it); closeSheet() },
                // Entry 0 is "Off"; the rest follow the order of Now.subtitles.
                onSubtitle = { controller.setSubtitle(it - 1); closeSheet() },
                onListen = { if (track != null) onListen(track, ui.positionMs) },
                onDownload = { if (track != null) graph.downloads.enqueue(track) },
                onStats = { stats = !stats; closeSheet() },
                onBack = { if (page != Sheet.Main && fromSettings) sheet = Sheet.Main else closeSheet() },
                modifier = Modifier.align(Alignment.BottomEnd).padding(end = 64.dp, bottom = 176.dp),
            )
        }
    }
}

/** Ten seconds a press, more the longer the key is held: a long video would otherwise take forever to cross. */
private fun seekStep(e: KeyEvent): Int {
    val repeat = e.nativeKeyEvent.repeatCount
    return when {
        repeat > 20 -> 60
        repeat > 8 -> 30
        else -> 10
    }
}

/** The one big round control, in the accent colour; a circular arrow when the video has ended. */
@Composable
private fun RoundPlayButton(playing: Boolean, ended: Boolean, onClick: () -> Unit) {
    FocusSurface(onClick = onClick, modifier = Modifier.size(60.dp), shape = CircleShape, scaleOnFocus = 1.1f) { focused ->
        Box(Modifier.fillMaxSize().background(if (focused) Color.White else LuminaColors.Amber, CircleShape), contentAlignment = Alignment.Center) {
            Icon(
                when { ended -> PlayerIcons.Replay; playing -> PlayerIcons.Pause; else -> PlayerIcons.Play },
                contentDescription = if (playing) "Pause" else "Play", tint = LuminaColors.Bg, modifier = Modifier.size(40.dp),
            )
        }
    }
}

/**
 * The progress bar. When focused, left and right seek and Select toggles play, the same keys that
 * do it when the controls are hidden, so the remote behaves identically either way.
 */
@Composable
private fun SeekControl(ui: PlayerUi, focus: FocusRequester, onSeek: (Int) -> Unit, onToggle: () -> Unit, step: (KeyEvent) -> Int) {
    var focused by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(10.dp)
    Box(
        Modifier.fillMaxWidth()
            .focusRequester(focus)
            .onFocusChanged { focused = it.isFocused }
            .onPreviewKeyEvent { e ->
                if (e.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                when (e.key) {
                    Key.DirectionLeft -> { onSeek(-step(e)); true }
                    Key.DirectionRight -> { onSeek(step(e)); true }
                    Key.DirectionCenter, Key.Enter, Key.NumPadEnter -> { onToggle(); true }
                    else -> false
                }
            }
            .focusable()
            .border(BorderStroke(if (focused) 2.dp else 0.dp, if (focused) Color.White.copy(alpha = 0.9f) else Color.Transparent), shape)
            .padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        TimeBar(ui, Modifier.fillMaxWidth())
    }
}

private class SheetItem(val icon: ImageVector, val label: String, val value: String, val chevron: Boolean = true, val onClick: () -> Unit)

/**
 * The settings sheet down the right edge. [page] is Settings itself (a list of settings with their current values) or
 * one of its sub-pages (a list of choices with a tick on the current one). Opens with the first row, or the current
 * choice, focused.
 */
@Composable
private fun SettingsSheet(
    page: Sheet,
    now: PlaybackController.Now, speed: Float, saved: Boolean, downloadPercent: Int?, stats: Boolean,
    canListen: Boolean, canDownload: Boolean,
    onOpen: (Sheet) -> Unit,
    onQuality: (Int) -> Unit, onSpeed: (Int) -> Unit, onAudio: (Int) -> Unit, onSubtitle: (Int) -> Unit,
    onListen: () -> Unit, onDownload: () -> Unit, onStats: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // A small card above the button that opened it, not a sheet down the screen: the picture stays. Left steps back (a sub-page
    // to Settings, Settings to the player), as does Back; pressing the same button again closes it.
    Popover(
        modifier.onPreviewKeyEvent { e -> if (e.type == KeyEventType.KeyDown && e.key == Key.DirectionLeft) { onBack(); true } else false },
        width = 380.dp,
    ) {
        Row(Modifier.padding(start = 6.dp, top = 4.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            if (page != Sheet.Main) Icon(Icons.Filled.ChevronLeft, contentDescription = "Back", tint = LuminaColors.Ink3, modifier = Modifier.size(24.dp))
            Text(page.title, style = LuminaText.DialogTitle.copy(fontSize = 19.sp))
        }
        key(page) {
            when (page) {
                Sheet.Main -> SheetRows(
                    buildList {
                        if (now.qualities.isNotEmpty()) add(SheetItem(Icons.Filled.HighQuality, "Quality", now.qualities.getOrNull(now.qualityIndex)?.label ?: "—") { onOpen(Sheet.Quality) })
                        add(SheetItem(PlayerIcons.Speed,"Playback speed", PlaybackSpeed.label(speed)) { onOpen(Sheet.Speed) })
                        if (now.audioTracks.size > 1) add(SheetItem(Icons.Filled.Audiotrack, "Audio language", now.audioTracks.getOrNull(now.audioIndex).orEmpty()) { onOpen(Sheet.Audio) })
                        if (now.hasSubtitles) add(SheetItem(PlayerIcons.Subtitles, "Subtitles", now.subtitles.getOrNull(now.subtitleIndex) ?: "Off") { onOpen(Sheet.Subtitles) })
                        if (canListen) add(SheetItem(Icons.Filled.Headphones, "Listen only", "Audio, no picture", chevron = false, onClick = onListen))
                        if (canDownload) {
                            val state = when { saved -> "Saved"; downloadPercent != null -> "$downloadPercent%"; else -> "Save to this device" }
                            add(SheetItem(if (saved) PlayerIcons.Downloaded else PlayerIcons.Download, "Download", state, chevron = false) { if (!saved && downloadPercent == null) onDownload() })
                        }
                        add(SheetItem(Icons.Filled.Info, "Stats for nerds", if (stats) "On" else "Off", chevron = false, onClick = onStats))
                    },
                )
                Sheet.Quality -> SheetChoices(now.qualities.map { it.label }, now.qualityIndex, onQuality)
                Sheet.Speed -> SheetChoices(PlaybackSpeed.steps.map { PlaybackSpeed.label(it) }, PlaybackSpeed.steps.indexOf(speed), onSpeed)
                Sheet.Audio -> SheetChoices(now.audioTracks, now.audioIndex, onAudio)
                Sheet.Subtitles -> SheetChoices(listOf("Off") + now.subtitles, now.subtitleIndex + 1, onSubtitle)
            }
        }
    }
}

/** The rows of the Settings page: icon, name, current value, and an arrow when it opens a list. */
@Composable
private fun ColumnScope.SheetRows(rows: List<SheetItem>) {
    val requesters = remember(rows.size) { rows.map { FocusRequester() } }
    LaunchedEffect(rows.size) { requesters.firstOrNull()?.requestWhenReady() }
    LazyColumn(Modifier.fillMaxWidth().weight(1f, fill = false), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        itemsIndexed(rows) { i, row ->
            FocusSurface(onClick = row.onClick, modifier = Modifier.fillMaxWidth().focusRequester(requesters[i]), shape = RoundedCornerShape(12.dp), scaleOnFocus = 1f) {
                Row(Modifier.padding(horizontal = 14.dp, vertical = 11.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Icon(row.icon, contentDescription = null, tint = LuminaColors.Ink2, modifier = Modifier.size(26.dp))
                    Text(row.label, style = LuminaText.Row, modifier = Modifier.weight(1f), maxLines = 1)
                    Text(row.value, style = LuminaText.Body, maxLines = 1)
                    if (row.chevron) Icon(Icons.Filled.ChevronRight, contentDescription = null, tint = LuminaColors.Ink3, modifier = Modifier.size(26.dp))
                }
            }
        }
    }
}

/** A list of choices with a tick on the current one; opens with the current one focused. */
@Composable
private fun ColumnScope.SheetChoices(options: List<String>, selected: Int, onChoose: (Int) -> Unit) {
    val requesters = remember(options) { options.map { FocusRequester() } }
    LaunchedEffect(options) { requesters.getOrNull(selected.coerceAtLeast(0))?.requestWhenReady() }
    LazyColumn(Modifier.fillMaxWidth().weight(1f, fill = false), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        itemsIndexed(options) { i, label ->
            FocusSurface(onClick = { onChoose(i) }, modifier = Modifier.fillMaxWidth().focusRequester(requesters[i]), shape = RoundedCornerShape(12.dp), scaleOnFocus = 1f) {
                Row(Modifier.padding(horizontal = 16.dp, vertical = 11.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(label, style = LuminaText.Row, modifier = Modifier.weight(1f), maxLines = 1)
                    if (i == selected) Icon(Icons.Filled.Check, contentDescription = "Current", tint = LuminaColors.Amber, modifier = Modifier.size(28.dp))
                }
            }
        }
    }
}

/** Live numbers off the player, twice a second: what the picture really is, not what was asked for. */
@Composable
private fun StatsPanel(controller: PlaybackController, modifier: Modifier = Modifier) {
    var tick by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) { while (true) { delay(500); tick++ } }
    @Suppress("UNUSED_EXPRESSION") tick
    val s = controller.stats()
    val rows = listOf(
        "Picture" to "${s.resolution} · ${s.frameRate} · ${s.videoCodec}",
        "Video rate" to Formatting.kbps(s.videoKbps.takeIf { it > 0 }),
        "Sound" to "${s.audioCodec}${if (s.sampleRate > 0) " · ${"%.1f".format(s.sampleRate / 1000.0)} kHz" else ""}",
        "Sound rate" to Formatting.kbps(s.audioKbps.takeIf { it > 0 }),
        "Frames dropped" to "${s.droppedFrames}",
        "Buffered ahead" to "${s.bufferAheadSec} s",
        "Speed" to PlaybackSpeed.label(s.speed),
        "Source" to s.source,
    )
    Column(modifier.width(520.dp).background(Color(0xCC000000), RoundedCornerShape(14.dp)).padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("STATS FOR NERDS", style = LuminaText.Small.copy(color = LuminaColors.Amber))
        for ((k, v) in rows) {
            Row(Modifier.fillMaxWidth()) {
                Text(k, style = LuminaText.Small, modifier = Modifier.width(150.dp))
                Text(v, style = LuminaText.Small.copy(color = LuminaColors.Ink), maxLines = 1)
            }
        }
    }
}
