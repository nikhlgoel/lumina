package com.lumina.tv.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.animateFloat
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.tv.material3.Icon
import androidx.tv.material3.Text
import coil.compose.AsyncImage
import com.lumina.tv.core.Formatting
import com.lumina.tv.data.MediaKind
import kotlinx.coroutines.delay

/**
 * Anything the remote can land on. Built from plain `clickable` rather than a toolkit component so
 * the behaviour is exactly known: the D-pad moves focus, Select clicks, and the focused item grows
 * slightly and gets an amber outline — visible from across a room, which a subtle tint is not.
 */
@Composable
fun FocusSurface(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(14.dp),
    selected: Boolean = false,
    enabled: Boolean = true,
    scaleOnFocus: Float = 1.04f,
    content: @Composable BoxScope.(focused: Boolean) -> Unit,
) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) scaleOnFocus else 1f, label = "focus-scale")
    val background = when {
        focused -> LuminaColors.SurfaceHigh
        selected -> LuminaColors.Surface
        else -> Color.Transparent
    }
    Box(
        modifier
            .onFocusChanged { focused = it.isFocused }
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .clip(shape)
            .background(background, shape)
            .border(if (focused) BorderStroke(2.dp, Color.White.copy(alpha = 0.9f)) else BorderStroke(0.dp, Color.Transparent), shape)
            .clickable(enabled = enabled, onClick = onClick),
        content = { content(focused) },
    )
}

/** A labelled button. [primary] is the amber one: at most one per screen, the thing most likely wanted. */
@Composable
fun LButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    primary: Boolean = false,
    enabled: Boolean = true,
    /**
     * Looks inactive but can still hold focus. Use this, not [enabled], for a button whose state has
     * just changed under the remote ("Saved", "Downloading 40%"): a disabled button cannot be focused,
     * so the focus ring would vanish and jump to the first thing on the screen — on the search screen
     * that is the text box, which pops the keyboard open in the middle of what you were doing.
     */
    dimmed: Boolean = false,
) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.03f else 1f, label = "button-scale")
    val shape = RoundedCornerShape(10.dp)
    val muted = !enabled || dimmed
    // Quiet by default: a filled button only for the one primary action, and a hairline outline for the rest (a row of
    // filled slabs reads as heavy). The focused one is filled white, so it is unmistakable from across a room.
    val container = when {
        muted && focused -> LuminaColors.SurfaceHigh
        muted -> Color.Transparent
        focused -> Color.White
        primary -> LuminaColors.Amber
        else -> Color.Transparent
    }
    val content = when {
        muted -> LuminaColors.Ink3
        focused || primary -> LuminaColors.Bg
        else -> LuminaColors.Ink
    }
    Row(
        modifier
            .onFocusChanged { focused = it.isFocused }
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .clip(shape)
            .background(container, shape)
            .border(
                BorderStroke(
                    if (focused && primary) 2.dp else 1.dp,
                    if (focused && primary) LuminaColors.Amber else if (primary || focused) Color.Transparent else LuminaColors.HairlineStrong,
                ),
                shape,
            )
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 18.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally),
    ) {
        if (icon != null) Icon(icon, contentDescription = null, tint = content, modifier = Modifier.size(24.dp))
        // One line, always: a label that wraps squeezes its neighbours and ruins a row of buttons.
        Text(text, style = LuminaText.Button.copy(color = content), maxLines = 1, softWrap = false)
    }
}

/**
 * Puts the remote on this element once it exists. A list's rows are laid out a frame after the screen that holds them
 * appears, so a focus request made at once finds nothing to focus and silently does nothing (seen on the video settings
 * popover: the first Down and Select then went to the controls behind it). This tries again every 60 ms, for half a second.
 */
suspend fun FocusRequester.requestWhenReady(attempts: Int = 8) {
    repeat(attempts) {
        if (runCatching { requestFocus() }.isSuccess) return
        kotlinx.coroutines.delay(60)
    }
}

/**
 * A thin loading line for a popup: a 2 dp track with a short stretch of the accent colour sliding along it. Used where
 * something is being fetched and there is nothing to count; it is one animated number, so it costs next to nothing.
 */
@Composable
fun ThinProgress(modifier: Modifier = Modifier) {
    val phase by androidx.compose.animation.core.rememberInfiniteTransition(label = "thin-progress").animateFloat(
        initialValue = 0f, targetValue = 1f,
        animationSpec = androidx.compose.animation.core.infiniteRepeatable(androidx.compose.animation.core.tween(1300, easing = androidx.compose.animation.core.LinearEasing)),
        label = "thin-progress-phase",
    )
    Box(modifier.fillMaxWidth().height(2.dp).background(Color.White.copy(alpha = 0.08f), RoundedCornerShape(1.dp)).clip(RoundedCornerShape(1.dp))) {
        // The stretch is 30% of the line; it starts off the left edge and leaves off the right.
        Box(Modifier.fillMaxWidth(0.3f).height(2.dp).graphicsLayer { translationX = (phase * 1.3f - 0.3f) * (size.width / 0.3f) }.background(LuminaColors.Amber))
    }
}

/** A square button with only an icon, for transport controls where a label per button would not fit. */
@Composable
fun LIconButton(
    icon: ImageVector,
    description: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    /** A toggle that is switched on: shown in the accent colour so its state reads at a glance. */
    active: Boolean = false,
    /** 60 dp for transport controls; a row of text buttons (about 49 dp tall) passes its own height so the row lines up. */
    size: androidx.compose.ui.unit.Dp = 60.dp,
) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.1f else 1f, label = "icon-button-scale")
    val shape = RoundedCornerShape(14.dp)
    val tint = when {
        !enabled -> LuminaColors.Ink3
        focused -> LuminaColors.Bg
        active -> LuminaColors.Amber
        else -> LuminaColors.Ink
    }
    Box(
        modifier
            .size(size)
            .onFocusChanged { focused = it.isFocused }
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .clip(shape)
            .background(if (focused && enabled) Color.White else LuminaColors.SurfaceHigh, shape)
            .border(BorderStroke(if (focused) 2.dp else 0.dp, if (focused) LuminaColors.Amber else Color.Transparent), shape)
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = description, tint = tint, modifier = Modifier.size(34.dp))
    }
}

/** An artwork thumbnail that never leaves a blank hole: a tinted tile with a note or film icon until it loads. */
@Composable
fun Thumb(
    url: String?,
    kind: MediaKind,
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(10.dp),
    fit: ContentScale = ContentScale.Crop,
) {
    Box(modifier.clip(shape).background(LuminaColors.SurfaceHigh), contentAlignment = Alignment.Center) {
        Icon(
            if (kind == MediaKind.AUDIO) Icons.Filled.MusicNote else Icons.Filled.VideoLibrary,
            contentDescription = null, tint = LuminaColors.Ink3, modifier = Modifier.size(32.dp),
        )
        if (!url.isNullOrBlank()) AsyncImage(model = url, contentDescription = null, contentScale = fit, modifier = Modifier.matchParentSize())
    }
}

@Composable
fun ProgressLine(fraction: Float, modifier: Modifier = Modifier, color: Color = LuminaColors.Amber) {
    Box(modifier.height(6.dp).clip(RoundedCornerShape(3.dp)).background(LuminaColors.SurfaceHigh)) {
        Box(Modifier.fillMaxWidth(fraction.coerceIn(0f, 1f)).height(6.dp).background(color))
    }
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(text, style = LuminaText.Title, modifier = modifier.padding(top = 20.dp, bottom = 10.dp))
}

/** An empty or error state with a way forward. The action is optional; a screen with no way out is a dead end on a remote. */
@Composable
fun StateMessage(title: String, detail: String? = null, actionLabel: String? = null, onAction: (() -> Unit)? = null, isError: Boolean = false) {
    Column(Modifier.fillMaxWidth().padding(vertical = 36.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(title, style = LuminaText.Title.copy(color = if (isError) LuminaColors.Danger else LuminaColors.Ink))
        if (detail != null) Text(detail, style = LuminaText.Body)
        if (actionLabel != null && onAction != null) LButton(actionLabel, onAction, primary = true)
    }
}

// ---- Player state for the screens -------------------------------------------------------------

class PlayerUi(
    val isPlaying: Boolean,
    val buffering: Boolean,
    val positionMs: Long,
    val durationMs: Long,
    val bufferedMs: Long,
    val ended: Boolean,
) {
    val fraction: Float get() = if (durationMs > 0) (positionMs.toFloat() / durationMs).coerceIn(0f, 1f) else 0f
}

/**
 * The player's state as Compose state. Play/pause and buffering come from player events; position has
 * no event, so it is read twice a second while something is playing and not at all when idle.
 */
@Composable
fun rememberPlayerUi(player: Player): PlayerUi {
    var playing by remember { mutableStateOf(player.isPlaying) }
    var buffering by remember { mutableStateOf(player.playbackState == Player.STATE_BUFFERING) }
    var ended by remember { mutableStateOf(player.playbackState == Player.STATE_ENDED) }
    var position by remember { mutableLongStateOf(player.currentPosition) }
    var duration by remember { mutableLongStateOf(player.duration.takeIf { it != C.TIME_UNSET } ?: 0L) }
    var buffered by remember { mutableLongStateOf(player.bufferedPosition) }

    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onEvents(p: Player, events: Player.Events) {
                playing = p.isPlaying
                buffering = p.playbackState == Player.STATE_BUFFERING
                ended = p.playbackState == Player.STATE_ENDED
                duration = p.duration.takeIf { it != C.TIME_UNSET } ?: 0L
                position = p.currentPosition
            }
        }
        player.addListener(listener)
        onDispose { player.removeListener(listener) }
    }
    LaunchedEffect(player) {
        while (true) {
            position = player.currentPosition
            buffered = player.bufferedPosition
            duration = player.duration.takeIf { it != C.TIME_UNSET } ?: duration
            delay(if (playing) 500 else 1000)
        }
    }
    return PlayerUi(playing, buffering, position, duration, buffered, ended)
}

/** Position and length as a read-only bar with times either side. Seeking is done with the remote's left and right keys. */
@Composable
fun TimeBar(ui: PlayerUi, modifier: Modifier = Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Text(Formatting.duration(ui.positionMs / 1000), style = LuminaText.Small)
        Box(Modifier.weight(1f).height(8.dp).clip(RoundedCornerShape(4.dp)).background(LuminaColors.SurfaceHigh)) {
            Box(Modifier.fillMaxWidth(if (ui.durationMs > 0) (ui.bufferedMs.toFloat() / ui.durationMs).coerceIn(0f, 1f) else 0f).height(8.dp).background(LuminaColors.Ink3.copy(alpha = 0.35f)))
            Box(Modifier.fillMaxWidth(ui.fraction).height(8.dp).background(LuminaColors.Amber))
        }
        Text(Formatting.duration(ui.durationMs / 1000), style = LuminaText.Small)
    }
}


/**
 * The saved library minus anything whose file is not there right now: songs on a USB drive that was unplugged vanish
 * from the screens (instead of failing with "file is gone" when tapped) and come back when it is plugged in again.
 * Re-checked when the library or the set of drives changes, never on every frame.
 */
@Composable
fun rememberAvailableLibrary(graph: com.lumina.tv.Graph): List<com.lumina.tv.data.LibraryItem> {
    val library by graph.library.items.collectAsStateWithLifecycle()
    val drives by graph.storage.rootsFlow.collectAsStateWithLifecycle()
    return remember(library, drives) { library.filter { java.io.File(it.path).exists() } }
}
