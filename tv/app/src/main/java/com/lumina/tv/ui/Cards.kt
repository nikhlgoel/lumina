package com.lumina.tv.ui

import android.graphics.Bitmap
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.graphics.ColorUtils
import androidx.palette.graphics.Palette
import androidx.tv.material3.Text
import coil.ImageLoader
import coil.compose.AsyncImage
import coil.request.ImageRequest
import coil.request.SuccessResult
import com.lumina.tv.data.MediaKind
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/*
 * The shared look. What the big TV apps (Netflix, Prime Video, YouTube, Spotify) have in common, and
 * so what people already know how to read from the sofa:
 *   - artwork leads: big images, text secondary;
 *   - one clear focus state: the card grows, gets a bright outline and a soft glow in the accent colour;
 *   - content in rows that scroll sideways, each with a heading;
 *   - dark, calm background, so the artwork is the colour on screen;
 *   - something visible while loading, never a blank gap.
 */

/**
 * True from the moment a held Select fires its long press until the key is let go. Global on purpose: a card can be
 * recreated while the key is still down (pinning changes what is on screen), and a per-card flag then forgets it has
 * fired, so the next key repeat fires again - seen on the stick as a pin that switched itself off and on in one hold.
 */
private var heldSelectFired = false

/**
 * Compose does not turn a held Select key into a long click (checked on the stick: a held Select just plays the
 * card), so it is detected here: holding Select repeats the key, and the first repeat is the long press. The release
 * after it must not also count as a click.
 */
fun Modifier.longPressSelect(onLongClick: (() -> Unit)?): Modifier = onPreviewKeyEvent { e ->
    if (onLongClick == null || (e.key != Key.DirectionCenter && e.key != Key.Enter)) return@onPreviewKeyEvent false
    when (e.type) {
        KeyEventType.KeyDown -> if (e.nativeKeyEvent.repeatCount > 0 || e.nativeKeyEvent.isLongPress) { if (!heldSelectFired) { heldSelectFired = true; onLongClick() }; true } else false
        KeyEventType.KeyUp -> if (heldSelectFired) { heldSelectFired = false; true } else false
        else -> false
    }
}

/**
 * Card proportions, taken from the real YouTube and YouTube Music TV apps (docs/18): a song or album is a true
 * square (the cover, nothing cropped to a strip), a video is 16:9, and the two are the same height so a row that
 * mixes them (Recommended) is one tidy line.
 */
const val CARD_ASPECT = 1f
val CARD_WIDTH = 230.dp

/** A 16:9 video card is this wide so its picture is exactly as tall as a song card's. */
val CARD_WIDTH_VIDEO = 409.dp

/** The corner radius of every card picture. YouTube's are about this soft: round, but still clearly a picture. */
private val CardCorner = 14.dp

/** "3:41" for a length in seconds, or null when the length is not known (so no badge is drawn rather than "0:00"). */
fun lengthLabel(seconds: Long): String? = seconds.takeIf { it > 0 }?.let { com.lumina.tv.core.Formatting.duration(it) }

/**
 * A piece of artwork with its title underneath. [aspect] is width/height of the picture. Select plays or opens it.
 * Where the remote is shows as a lift, a soft glow in the accent colour and a thin light outline - not a thick ring
 * and not a box around the text: the text sits on the page, and only the picture is the card.
 */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun PosterCard(
    imageUrl: String?,
    kind: MediaKind,
    title: String,
    subtitle: String?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    width: Dp = CARD_WIDTH,
    aspect: Float = CARD_ASPECT,
    badge: String? = null,
    progress: Float? = null,
    /** The length, like "3:41", drawn in a small dark pill at the picture's bottom-right corner, as YouTube does. */
    duration: String? = null,
    onFocused: (() -> Unit)? = null,
    onLongClick: (() -> Unit)? = null,
) {
    var focused by remember { mutableStateOf(false) }
    // Calmer than before (was 1.06 with a glow): the real YouTube TV app only draws a clean white ring round the
    // focused picture, and lifts it very slightly. Checked live on the stick, docs/18 §1.2.
    val scale by animateFloatAsState(
        if (focused) 1.035f else 1f,
        tween(180, easing = androidx.compose.animation.core.CubicBezierEasing(0.05f, 0.7f, 0.1f, 1f)), label = "poster-scale",
    )
    val shape = RoundedCornerShape(CardCorner)
    // A wide (video) card gets the title on two lines and no artist line squeezed in below; a square one keeps one
    // line for the title and one for who made it.
    val wide = aspect > 1.2f
    Column(
        modifier
            // Unspecified width: fill the grid cell this card is placed in.
            .then(if (width == Dp.Unspecified) Modifier.fillMaxWidth() else Modifier.width(width))
            .onFocusChanged { focused = it.isFocused; if (it.isFocused) onFocused?.invoke() }
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .longPressSelect(onLongClick)
            .combinedClickable(onClick = onClick, onLongClick = onLongClick),
    ) {
        Box(
            Modifier.fillMaxWidth().aspectRatio(aspect)
                .clip(shape)
                // One clean white ring when focused, a hairline at rest (so a pale cover never melts into the page): no glow, no halo.
                .border(BorderStroke(if (focused) 3.dp else 1.dp, if (focused) Color.White else LuminaColors.Hairline), shape),
        ) {
            Thumb(imageUrl, kind, Modifier.fillMaxSize(), shape = RoundedCornerShape(0.dp))
            if (badge != null) {
                Text(
                    badge, style = LuminaText.Small.copy(color = LuminaColors.Ink, fontSize = 14.sp),
                    modifier = Modifier.align(Alignment.TopStart).padding(10.dp).background(Color.Black.copy(alpha = 0.5f), RoundedCornerShape(10.dp)).padding(horizontal = 10.dp, vertical = 4.dp),
                )
            }
            if (duration != null) {
                Text(
                    duration, style = LuminaText.Small.copy(color = Color.White, fontSize = 14.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold),
                    modifier = Modifier.align(Alignment.BottomEnd).padding(8.dp).background(Color.Black.copy(alpha = 0.72f), RoundedCornerShape(6.dp)).padding(horizontal = 8.dp, vertical = 2.dp),
                )
            }
            if (progress != null) ProgressLine(progress, Modifier.align(Alignment.BottomCenter).fillMaxWidth())
        }
        // A fixed height, so a row of cards is a tidy line whatever the titles are, rather than a ragged edge.
        Column(Modifier.padding(start = 4.dp, end = 4.dp, top = 10.dp).height(if (wide) 92.dp else 66.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                com.lumina.tv.core.Formatting.caption(title), style = LuminaText.Row.copy(fontSize = if (wide) 19.sp else 20.sp), maxLines = if (wide) 2 else 1,
                overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
            )
            if (!subtitle.isNullOrBlank()) Text(com.lumina.tv.core.Formatting.caption(subtitle), style = LuminaText.Small, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
        }
    }
}

/**
 * "Liked songs" as one more playlist tile (a heart on the accent colour), for the Playlists page and Home's playlists row: your
 * likes are a playlist like any other, so they take a place among them instead of a row of their own.
 */
@Composable
fun LikedCard(count: Int, onClick: () -> Unit, modifier: Modifier = Modifier, width: Dp = Dp.Unspecified) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.035f else 1f, tween(180), label = "liked-scale")
    val shape = RoundedCornerShape(CardCorner)
    Column(
        modifier.then(if (width == Dp.Unspecified) Modifier.fillMaxWidth() else Modifier.width(width))
            .onFocusChanged { focused = it.isFocused }.graphicsLayer { scaleX = scale; scaleY = scale }
            .combinedClickable(onClick = onClick),
    ) {
        Box(
            Modifier.fillMaxWidth().aspectRatio(CARD_ASPECT).clip(shape)
                .background(Brush.linearGradient(listOf(androidx.compose.ui.graphics.lerp(LuminaColors.Surface, LuminaColors.Amber, 0.55f), androidx.compose.ui.graphics.lerp(LuminaColors.Surface, LuminaColors.Amber, 0.18f))))
                .border(BorderStroke(if (focused) 3.dp else 1.dp, if (focused) Color.White else LuminaColors.Hairline), shape),
            contentAlignment = Alignment.Center,
        ) {
            androidx.tv.material3.Icon(androidx.compose.material.icons.Icons.Filled.Favorite, contentDescription = null, tint = Color.White, modifier = Modifier.size(64.dp))
        }
        Column(Modifier.padding(start = 4.dp, end = 4.dp, top = 10.dp).height(66.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("liked songs", style = LuminaText.Row.copy(fontSize = 20.sp), maxLines = 1)
            Text(com.lumina.tv.core.Formatting.count(count, "song"), style = LuminaText.Small, maxLines = 1)
        }
    }
}

/** An artist: a round picture (as on YouTube Music) with the name and a line under it. Falls back to initials with no picture. */
@Composable
fun ArtistCard(imageUrl: String?, name: String, subtitle: String?, onClick: () -> Unit, modifier: Modifier = Modifier, width: Dp = 190.dp, onFocused: (() -> Unit)? = null) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.05f else 1f, tween(180), label = "artist-scale")
    Column(
        modifier.width(width).onFocusChanged { focused = it.isFocused; if (it.isFocused) onFocused?.invoke() }
            .graphicsLayer { scaleX = scale; scaleY = scale }.combinedClickable(onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier.size(width - 20.dp).clip(CircleShape)
                .border(BorderStroke(if (focused) 3.dp else 1.dp, if (focused) Color.White else LuminaColors.Hairline), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            if (imageUrl.isNullOrBlank()) {
                Box(Modifier.fillMaxSize().background(LuminaColors.SurfaceHigh), contentAlignment = Alignment.Center) {
                    Text(com.lumina.tv.core.Initials.of(name) ?: "♪", style = LuminaText.Display.copy(fontSize = 44.sp))
                }
            } else {
                Thumb(imageUrl, MediaKind.AUDIO, Modifier.fillMaxSize(), shape = RoundedCornerShape(0.dp))
            }
        }
        Column(Modifier.padding(top = 10.dp).height(60.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(com.lumina.tv.core.Formatting.caption(name), style = LuminaText.Row.copy(fontSize = 19.sp), maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
            if (!subtitle.isNullOrBlank()) Text(com.lumina.tv.core.Formatting.caption(subtitle), style = LuminaText.Small, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
        }
    }
}

/** A heading and a row of cards that scrolls sideways. Padding above and below leaves room for the focus glow to be seen. */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun ContentRow(title: String, modifier: Modifier = Modifier, content: LazyListScope.() -> Unit) {
    Column(modifier) {
        // YouTube's row headings are plain and modest, so the pictures lead. 24 sp, not the 28 sp page-title size.
        Text(title, style = LuminaText.Title.copy(fontSize = 24.sp), modifier = Modifier.padding(start = 6.dp, top = 8.dp))
        // Sideways, the usual "nudge until the card is fully visible" is right; it is only the page's up/down
        // scrolling that [rowAnchoredScroll] replaces, so this row puts the default back for its own axis.
        androidx.compose.runtime.CompositionLocalProvider(
            androidx.compose.foundation.gestures.LocalBringIntoViewSpec provides remember { sideScroll },
        ) {
            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(22.dp),
                contentPadding = PaddingValues(horizontal = 6.dp, vertical = 22.dp),
                content = content,
            )
        }
    }
}

/** Along a row: move the least that shows the whole card (the library's own rule), on the same easing as the page. */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
private val sideScroll = object : androidx.compose.foundation.gestures.BringIntoViewSpec {
    override val scrollAnimationSpec: androidx.compose.animation.core.AnimationSpec<Float> =
        tween(280, easing = androidx.compose.animation.core.CubicBezierEasing(0.05f, 0.7f, 0.1f, 1f))

    override fun calculateScrollDistance(offset: Float, size: Float, containerSize: Float): Float {
        val trailing = offset + size
        return when {
            offset >= 0f && trailing <= containerSize -> 0f
            offset < 0f && trailing > containerSize -> 0f
            kotlin.math.abs(offset) < kotlin.math.abs(trailing - containerSize) -> offset
            else -> trailing - containerSize
        }
    }
}

/**
 * How a page of rows scrolls up and down. The default nudges by whatever amount makes the focused card fit, so
 * every row you enter moves the page by a different, odd distance - and at the same moment as the row scrolls
 * sideways, which reads as the whole screen shaking. This instead puts the focused row at one fixed height
 * ([anchor], a fraction of the page), with a single eased move; moving along a row asks for no move at all.
 */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
fun rowAnchoredScroll(anchor: Float = 0.27f): androidx.compose.foundation.gestures.BringIntoViewSpec =
    object : androidx.compose.foundation.gestures.BringIntoViewSpec {
        override val scrollAnimationSpec: androidx.compose.animation.core.AnimationSpec<Float> =
            tween(340, easing = androidx.compose.animation.core.CubicBezierEasing(0.05f, 0.7f, 0.1f, 1f))

        override fun calculateScrollDistance(offset: Float, size: Float, containerSize: Float): Float {
            val target = containerSize * anchor
            // Within a few pixels already: leave it, so a card's own growth never nudges the page.
            return if (kotlin.math.abs(offset - target) < 8f) 0f else offset - target
        }
    }

/** A grey block that gently pulses: stands in for content that is still loading, so the screen never looks broken. */
@Composable
fun Shimmer(modifier: Modifier = Modifier, shape: Shape = RoundedCornerShape(14.dp)) {
    val pulse by rememberInfiniteTransition(label = "shimmer").animateFloat(
        initialValue = 0.35f, targetValue = 0.8f,
        animationSpec = infiniteRepeatable(tween(900, easing = LinearEasing), RepeatMode.Reverse), label = "shimmer-alpha",
    )
    Box(modifier.clip(shape).background(LuminaColors.SurfaceHigh).alpha(pulse))
}

/** A centred panel over a dimmed screen. A real window, so the remote cannot wander onto what is behind it. */
@Composable
fun LDialog(onDismiss: () -> Unit, modifier: Modifier = Modifier, width: Dp = 620.dp, content: @Composable ColumnScope.() -> Unit) {
    // A dialog opened by HOLDING Select (delete a video, manage a playlist) opens while that key is still down, and the
    // held key keeps arriving here as repeats and then a release. Whatever button had focus took that release as a click:
    // a held Select on a video's cover deleted it before a choice could be made (reported on the stick, 2026-10-23).
    // So Select is swallowed until it has been quiet for 400 ms, which only ends once the finger is off the key.
    var armed by remember { mutableStateOf(false) }
    var lastSelect by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (!armed) {
            kotlinx.coroutines.delay(60)
            if (System.currentTimeMillis() - lastSelect > 400) armed = true
        }
    }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(
            Modifier.fillMaxSize().background(Color(0xB3000000)).onPreviewKeyEvent { e ->
                val select = e.key == Key.DirectionCenter || e.key == Key.Enter || e.key == Key.NumPadEnter
                if (select) lastSelect = System.currentTimeMillis()
                select && !armed
            },
            contentAlignment = Alignment.Center,
        ) {
            // A quiet sheet: flat near-black, one hairline, small corners, no colour wash and no heavy edge. Compact: a title,
            // one line, the buttons.
            val panel = RoundedCornerShape(16.dp)
            Column(
                modifier
                    .width(width)
                    .background(Color(0xFF17161D), panel)
                    .border(BorderStroke(1.dp, LuminaColors.HairlineStrong), panel)
                    .padding(horizontal = 28.dp, vertical = 26.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                content = content,
            )
        }
    }
}

/** Big artwork behind a hero area, fading to the page colour on the left and bottom so text on top stays readable. */
@Composable
fun HeroBackdrop(imageUrl: String?, modifier: Modifier = Modifier) {
    Box(modifier) {
        if (!imageUrl.isNullOrBlank()) {
            AsyncImage(model = imageUrl, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize().alpha(0.55f))
            // The fades only exist to keep text readable over artwork; with none, the page's own glow shows through.
            Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(listOf(LuminaColors.Bg, LuminaColors.Bg.copy(alpha = 0.85f), Color.Transparent))))
            Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Transparent, LuminaColors.Bg))))
        }
    }
}

/**
 * A colour taken from a picture, for tinting the screen that shows it — a song's cover colours its own Now
 * Playing page, as on the big music apps. Null until it has loaded, or when the picture has no usable colour.
 * Darkened, so white text always reads on it.
 */
@Composable
fun rememberArtworkColor(imageUrl: String?): Color? {
    val context = LocalContext.current
    var color by remember(imageUrl) { mutableStateOf<Color?>(null) }
    LaunchedEffect(imageUrl) {
        color = null
        if (imageUrl.isNullOrBlank()) return@LaunchedEffect
        color = withContext(Dispatchers.IO) {
            runCatching {
                // Software bitmap: Palette cannot read a hardware one.
                val request = ImageRequest.Builder(context).data(imageUrl).allowHardware(false).size(128).build()
                val bitmap = ((coil.Coil.imageLoader(context).execute(request) as? SuccessResult)?.drawable as? android.graphics.drawable.BitmapDrawable)?.bitmap
                bitmap?.let { tintFrom(it) }
            }.getOrNull()
        }
    }
    return color
}

private fun tintFrom(bitmap: Bitmap): Color? {
    val palette = Palette.from(bitmap).maximumColorCount(12).generate()
    val swatch = palette.vibrantSwatch ?: palette.mutedSwatch ?: palette.dominantSwatch ?: return null
    val hsl = FloatArray(3)
    ColorUtils.colorToHSL(swatch.rgb, hsl)
    // Keep the hue, pull lightness down and saturation in check: a calm tint, not a neon wash.
    hsl[1] = hsl[1].coerceAtMost(0.55f)
    hsl[2] = hsl[2].coerceIn(0.12f, 0.24f)
    return Color(ColorUtils.HSLToColor(hsl))
}
