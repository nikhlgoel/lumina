package com.lumina.tv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.toArgb
import androidx.compose.animation.animateColor
import androidx.compose.animation.core.animateFloat
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.sp
import com.lumina.tv.R
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.darkColorScheme

/** Settings that change how the screen looks right now, as live state so a switch in Settings shows at once. Set from the saved values at start. */
object LiveSettings {
    var ambientColour: Boolean by androidx.compose.runtime.mutableStateOf(true)
}

/** Holds the current accent colour; set by the shell from the artwork, read everywhere through [LuminaColors.Amber]. */
object Accent {
    /** Soft lavender (a light tone of violet) while nothing has artwork: calm, and clear of the logo's amber. */
    val Default = Color(0xFFCDB4FF)
    var color: Color by androidx.compose.runtime.mutableStateOf(Default)
}

/** The brand palette: the amber crystal on near-black, the same as the PC app's player. */
object LuminaColors {
    // A touch lighter and greyer than the first near-black violet (2026-10-22): still dark, but not a hole.
    val Bg = Color(0xFF15141B)
    val Surface = Color(0xFF211F29)
    val SurfaceHigh = Color(0xFF2D2B37)
    /** The one border: a hairline of the page's ink, for every card, panel and popup, so edges look the same everywhere. */
    val Hairline = Color(0x1AF3F1F8)
    /** The same line a step stronger, for the panel that is on top (a popup) and for resting controls. */
    val HairlineStrong = Color(0x33F3F1F8)
    /** The brand's own amber: the logo and the wordmark, and nothing else. */
    val Brand = Color(0xFFFFD27A)

    /**
     * The one accent colour: focus glow, primary buttons, progress, the page you are on. It follows the cover art of
     * what is playing (see [Accent]), so the app takes the colour of the music instead of a fixed brand orange.
     * Still named Amber because that is what every screen already calls it; reading it is a state read, so
     * anything drawn with it repaints by itself when the colour changes.
     */
    val Amber: Color get() = Accent.color
    val Copper = Color(0xFFF59A4E)
    val Ink = Color(0xFFF3F1F8)
    val Ink2 = Color(0xB8F3F1F8)
    val Ink3 = Color(0x80F3F1F8)
    val Danger = Color(0xFFFF7A7A)
    val Ok = Color(0xFF7BE0A3)
}

/**
 * Two typefaces, both SIL Open Font License and both variable (one small file each, any weight): Sora for headings, a wide
 * geometric face with a recognisable look that holds up at TV distance, and Plus Jakarta Sans for everything that is read in
 * a line (rows, buttons, captions), a clean professional sans. Variable weights need Android 8 (the Fire TV Stick has 11);
 * on anything older the regular weight is drawn.
 */
@OptIn(androidx.compose.ui.text.ExperimentalTextApi::class)
private fun variable(res: Int, weight: Int) = Font(
    res, FontWeight(weight),
    variationSettings = androidx.compose.ui.text.font.FontVariation.Settings(androidx.compose.ui.text.font.FontVariation.weight(weight)),
)

val Sora = FontFamily(variable(R.font.sora, 400), variable(R.font.sora, 600), variable(R.font.sora, 700))
val Jakarta = FontFamily(variable(R.font.plusjakarta, 400), variable(R.font.plusjakarta, 500), variable(R.font.plusjakarta, 600), variable(R.font.plusjakarta, 700))

/**
 * Type sizes are larger than a phone's because a TV is read from across a room: nothing meant to be
 * read is under 16sp, and the minimum for a label someone must act on is 18sp.
 */
object LuminaText {
    val Display = TextStyle(fontFamily = Sora, fontSize = 42.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.5).sp, color = LuminaColors.Ink)
    val Title = TextStyle(fontFamily = Sora, fontSize = 27.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.2).sp, color = LuminaColors.Ink)
    val Row = TextStyle(fontFamily = Jakarta, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = LuminaColors.Ink)
    val Body = TextStyle(fontFamily = Jakarta, fontSize = 18.sp, color = LuminaColors.Ink2)
    val Small = TextStyle(fontFamily = Jakarta, fontSize = 16.sp, color = LuminaColors.Ink3)
    val Button = TextStyle(fontFamily = Jakarta, fontSize = 17.sp, fontWeight = FontWeight.Medium)
    /** A popup's title: lighter and smaller than a page title, so a popup reads as a quiet sheet and not a poster. */
    val DialogTitle = TextStyle(fontFamily = Jakarta, fontSize = 23.sp, fontWeight = FontWeight.SemiBold, color = LuminaColors.Ink)
}

/**
 * The layout is designed for a screen this many dp wide, whatever the TV is. Android picks a density from
 * the TV's resolution and DPI bucket (a 1080p Fire TV reports 320 dpi, so Compose sees 960x540dp and draws
 * everything at 2x, which read as zoomed in; a 4K TV in 4K mode reports a different bucket again). Deriving
 * the density from the real pixel width instead gives the same proportions on 720p, 1080p and 4K, and a
 * 4K picture is drawn sharp at 4K rather than upscaled from 1080p.
 */
private const val DESIGN_WIDTH_DP = 1733f // 1300 / 0.75: the owner asked for everything 25% smaller (2026-10-22)

/** Pixels-per-dp for a screen [widthPx] wide, kept within a sane range so a bad report cannot break the layout. */
internal fun densityFor(widthPx: Int): Float = (widthPx / DESIGN_WIDTH_DP).coerceIn(0.6f, 7f)

/** Material's default text styles, all in the UI face: any text that does not pick a style still never shows the system font. */
private fun luminaTypography(): androidx.tv.material3.Typography {
    val d = androidx.tv.material3.Typography()
    fun androidx.compose.ui.text.TextStyle.p() = copy(fontFamily = Jakarta)
    return androidx.tv.material3.Typography(
        displayLarge = d.displayLarge.p(), displayMedium = d.displayMedium.p(), displaySmall = d.displaySmall.p(),
        headlineLarge = d.headlineLarge.p(), headlineMedium = d.headlineMedium.p(), headlineSmall = d.headlineSmall.p(),
        titleLarge = d.titleLarge.p(), titleMedium = d.titleMedium.p(), titleSmall = d.titleSmall.p(),
        bodyLarge = d.bodyLarge.p(), bodyMedium = d.bodyMedium.p(), bodySmall = d.bodySmall.p(),
        labelLarge = d.labelLarge.p(), labelMedium = d.labelMedium.p(), labelSmall = d.labelSmall.p(),
    )
}

/**
 * A bright, readable colour from the song's own tint (which is deliberately dark, for backgrounds): the same hue,
 * lightened, for the things that must be seen on top of it - the current lyric line, the progress bar, the Play button.
 */
fun accentOf(tint: Color): Color {
    val hsl = FloatArray(3)
    androidx.core.graphics.ColorUtils.colorToHSL(tint.toArgb(), hsl)
    hsl[1] = hsl[1].coerceIn(0.45f, 0.85f)
    // A light tone of the cover's hue (about tone 80): readable as a fill under dark text and as text on the page.
    hsl[2] = 0.78f
    return Color(androidx.core.graphics.ColorUtils.HSLToColor(hsl))
}

@Composable
fun LuminaTheme(content: @Composable () -> Unit) {
    val base = LocalDensity.current
    val metrics = androidx.compose.ui.platform.LocalContext.current.resources.displayMetrics
    val widthPx = maxOf(metrics.widthPixels, metrics.heightPixels)
    CompositionLocalProvider(LocalDensity provides Density(densityFor(widthPx), base.fontScale)) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = LuminaColors.Amber,
            onPrimary = LuminaColors.Bg,
            background = LuminaColors.Bg,
            onBackground = LuminaColors.Ink,
            surface = LuminaColors.Surface,
            onSurface = LuminaColors.Ink,
        ),
        typography = luminaTypography(),
        content = content,
    )
    }
}

/**
 * The page behind everything. Not a fixed colour pair: it takes its tint from the artwork of what is playing
 * (or your latest saved item) and cross-fades when that changes, and two soft glows drift slowly so the
 * page is never a still image. With no artwork it cycles gently through the brand colours.
 *
 * The drift is read only while drawing, so it repaints this one layer and never recomposes the screen.
 */
@Composable
fun AmbientBackground(accent: Color?, modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    // The whole backdrop (page colour, two tinted glows, the engraving) is painted ONCE into a picture, off the
    // main thread, and every frame after that draws that one picture. Painting the gradients and ~45 large
    // stroked arcs live on every frame cost the stick 8-21 ms each (measured with gfxinfo and per-piece
    // switches, 2026-10-22: 69 ms per frame with them, 8 ms without), which is what made scrolling judder.
    // When the tint changes (a new song) the new picture is painted, then cross-faded over the old one.
    val target = accent ?: IDLE_TINT
    var size by remember { mutableStateOf(androidx.compose.ui.unit.IntSize.Zero) }
    var current by remember { mutableStateOf<androidx.compose.ui.graphics.ImageBitmap?>(null) }
    var previous by remember { mutableStateOf<androidx.compose.ui.graphics.ImageBitmap?>(null) }
    val fade = remember { androidx.compose.animation.core.Animatable(1f) }
    val density = androidx.compose.ui.platform.LocalDensity.current.density
    // On a small stick the picture is painted smaller and stretched to the screen: it is glows and hairlines at a few percent
    // opacity, so nothing visible is lost, and it takes under half the memory (two of them are alive during a cross-fade).
    val context = androidx.compose.ui.platform.LocalContext.current
    val scale = remember { (context.applicationContext as? com.lumina.tv.LuminaApp)?.memoryPlan?.backdropScale ?: 1f }

    LaunchedEffect(target, size) {
        if (size.width == 0 || size.height == 0) return@LaunchedEffect
        // Skipping through songs changes the tint in a burst: only the last one is worth painting.
        if (current != null) kotlinx.coroutines.delay(250)
        val painted = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) {
            renderBackdrop((size.width * scale).toInt().coerceAtLeast(2), (size.height * scale).toInt().coerceAtLeast(2), density * scale, target)
        }
        previous = current
        current = painted
        if (previous == null) {
            fade.snapTo(1f)
        } else {
            fade.snapTo(0f)
            fade.animateTo(1f, androidx.compose.animation.core.tween(1200))
            previous = null
        }
    }

    Box(
        modifier
            .fillMaxSize()
            .onSizeChanged { size = it }
            .drawBehind {
                val now = current
                if (now == null) {
                    drawRect(LuminaColors.Bg)
                } else {
                    val full = androidx.compose.ui.unit.IntSize(this.size.width.toInt(), this.size.height.toInt())
                    previous?.let { drawImage(it, dstSize = full, filterQuality = androidx.compose.ui.graphics.FilterQuality.Medium) }
                    drawImage(now, dstSize = full, alpha = fade.value, filterQuality = androidx.compose.ui.graphics.FilterQuality.Medium)
                }
            },
    ) { content() }
}

/** Paints the page: base colour, a glow from the upper right and one from the lower left, then the engraving. */
private fun renderBackdrop(w: Int, h: Int, density: Float, tint: Color): androidx.compose.ui.graphics.ImageBitmap {
    val bitmap = androidx.compose.ui.graphics.ImageBitmap(w, h)
    val canvas = androidx.compose.ui.graphics.Canvas(bitmap)
    val wf = w.toFloat()
    val hf = h.toFloat()
    androidx.compose.ui.graphics.drawscope.CanvasDrawScope().draw(
        androidx.compose.ui.unit.Density(density), androidx.compose.ui.unit.LayoutDirection.Ltr, canvas, androidx.compose.ui.geometry.Size(wf, hf),
    ) {
        drawRect(LuminaColors.Bg)
        drawRect(
            Brush.radialGradient(
                listOf(tint.copy(alpha = 0.55f), tint.copy(alpha = 0.16f), Color.Transparent),
                center = androidx.compose.ui.geometry.Offset(wf * 0.82f, hf * 0.04f), radius = wf * 0.70f,
            ),
        )
        drawRect(
            Brush.radialGradient(
                listOf(companion(tint).copy(alpha = 0.42f), companion(tint).copy(alpha = 0.12f), Color.Transparent),
                center = androidx.compose.ui.geometry.Offset(wf * 0.06f, hf * 1.0f), radius = wf * 0.62f,
            ),
        )
        // A soft vignette: the corners fall away to near-black, so the middle (where the cards are) reads as lit.
        drawRect(
            Brush.radialGradient(
                listOf(Color.Transparent, Color(0x66000000)),
                center = androidx.compose.ui.geometry.Offset(wf * 0.5f, hf * 0.5f), radius = wf * 0.78f,
            ),
        )
        Engraving.build(wf, hf, density).draw(this, tint)
    }
    return bitmap
}

/** The tint when nothing has artwork yet: a calm violet-blue, cooler and quieter than the brand amber. */
private val IDLE_TINT = Color(0xFF6B5BE0)

/**
 * A fine engraving behind the page: arcs of a big dial off the lower right, a lighter set from the upper left, a
 * scale of ticks along one arc, and a few shallow hairlines. Deliberately lopsided (spacing widens away from the
 * corner, the two centres differ) so it reads as drawn, not tiled. Lines are the page's ink with a little of the
 * tint, at 2-10% so they are felt before they are noticed. Geometry is computed once per size; drawing is cheap.
 */
private class Engraving private constructor(private val lines: List<Line>, private val hair: Float) {
    private class Line(val kind: Int, val cx: Float, val cy: Float, val r: Float, val a: Float, val x2: Float, val y2: Float, val tinted: Boolean)

    fun draw(scope: androidx.compose.ui.graphics.drawscope.DrawScope, tint: Color) {
        val ink = Color(0xFFF3F1F8)
        val soft = androidx.compose.ui.graphics.lerp(ink, tint, 0.55f)
        for (l in lines) {
            val c = (if (l.tinted) soft else ink).copy(alpha = l.a)
            if (l.kind == 0) {
                scope.drawCircle(c, l.r, androidx.compose.ui.geometry.Offset(l.cx, l.cy), style = androidx.compose.ui.graphics.drawscope.Stroke(hair))
            } else {
                scope.drawLine(c, androidx.compose.ui.geometry.Offset(l.cx, l.cy), androidx.compose.ui.geometry.Offset(l.x2, l.y2), strokeWidth = hair)
            }
        }
    }

    companion object {
        fun build(w: Float, h: Float, density: Float): Engraving {
            val out = ArrayList<Line>()
            // Big dial from beyond the lower-right corner: spacing grows outward, strength fades outward.
            val c1x = w * 1.06f; val c1y = h * 1.18f
            for (k in 0 until 15) {
                val r = h * (0.30f + 0.085f * k + 0.006f * k * k)
                out += Line(0, c1x, c1y, r, (0.10f - 0.0058f * k).coerceAtLeast(0.018f), 0f, 0f, tinted = k % 3 == 0)
            }
            // A lighter, wider set from above the left edge.
            val c2x = -w * 0.05f; val c2y = -h * 0.22f
            for (k in 0 until 8) {
                out += Line(0, c2x, c2y, h * (0.34f + 0.10f * k), (0.055f - 0.005f * k).coerceAtLeast(0.015f), 0f, 0f, tinted = k % 2 == 1)
            }
            // A scale of ticks along one arc of the big dial, every fifth one longer, like an engraved bezel.
            val tr = h * 0.30f + h * 0.085f * 5 + 0.006f * 25 * h
            var deg = 196.0
            var n = 0
            while (deg <= 262.0) {
                val a = Math.toRadians(deg)
                val len = h * if (n % 5 == 0) 0.032f else 0.017f
                val ca = kotlin.math.cos(a).toFloat(); val sa = kotlin.math.sin(a).toFloat()
                out += Line(1, c1x + ca * tr, c1y + sa * tr, 0f, if (n % 5 == 0) 0.12f else 0.07f, c1x + ca * (tr + len), c1y + sa * (tr + len), tinted = false)
                deg += 2.2; n++
            }
            // Shallow hairlines low on the left, steadily further apart, each of a different length.
            val lens = floatArrayOf(0.34f, 0.22f, 0.41f, 0.17f, 0.29f, 0.12f)
            for (i in lens.indices) {
                val y = h * (0.66f + 0.062f * i + 0.004f * i * i)
                val x1 = w * (0.02f + 0.03f * (i % 3))
                out += Line(1, x1, y, 0f, 0.05f - 0.005f * i, x1 + w * lens[i], y - w * lens[i] * 0.2f, tinted = i % 2 == 0)
            }
            return Engraving(out, hair = maxOf(1f, density * 0.9f))
        }
    }
}

/** A second glow for the corner opposite the first: the same colour turned along the wheel, so the pair always agrees. */
private fun companion(c: Color): Color {
    val hsl = FloatArray(3)
    androidx.core.graphics.ColorUtils.colorToHSL(c.toArgb(), hsl)
    hsl[0] = (hsl[0] + 48f) % 360f
    hsl[1] = hsl[1].coerceIn(0.35f, 0.7f)
    hsl[2] = hsl[2].coerceIn(0.14f, 0.3f)
    return Color(androidx.core.graphics.ColorUtils.HSLToColor(hsl))
}
