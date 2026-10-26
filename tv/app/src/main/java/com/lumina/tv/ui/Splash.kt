package com.lumina.tv.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import kotlinx.coroutines.delay
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

private val Night = Color(0xFF0E0D13)

/** Eases 0..1 between [from] and [to] of the timeline, slow at both ends. */
private fun stage(t: Float, from: Float, to: Float): Float {
    val x = ((t - from) / (to - from)).coerceIn(0f, 1f)
    return x * x * (3f - 2f * x)
}

/**
 * The opening: calm and quiet, about a second and a half. A thin outline of the gem draws itself, closes, and fills in
 * softly; the name fades in beneath it; then it all fades into the app, which is already built underneath. One line, one
 * fill, one word: no flying pieces, no flashes, no sparks, no loading words. Plays once per start (and can be switched
 * off in Settings > Display). A single path and one text, so it costs the stick next to nothing.
 */
@Composable
fun Splash(onDone: () -> Unit) {
    val t = remember { Animatable(0f) }
    val exit = remember { Animatable(1f) }
    LaunchedEffect(Unit) {
        t.animateTo(1f, tween(1250, easing = LinearEasing))
        delay(120)
        exit.animateTo(0f, tween(300))
        onDone()
    }

    Box(Modifier.fillMaxSize().graphicsLayer { alpha = exit.value }.background(Night), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) { drawGem(t.value) }
        Text(
            "lumina",
            style = LuminaText.Display.copy(fontSize = 28.sp, fontWeight = FontWeight.Medium, letterSpacing = 7.sp, color = LuminaColors.Ink),
            modifier = Modifier.offset(y = 104.dp).graphicsLayer {
                val s = stage(t.value, 0.5f, 0.8f)
                alpha = s
                translationY = (1f - s) * 8.dp.toPx()
            },
        )
    }
}

private fun DrawScope.drawGem(p: Float) {
    val c = Offset(size.width / 2f, size.height / 2f - 26.dp.toPx())
    val radius = 54.dp.toPx()
    val v = List(6) { k ->
        val a = ((-90 + 60 * k) * PI / 180.0).toFloat()
        Offset(c.x + radius * cos(a), c.y + radius * sin(a))
    }
    val hex = Path().apply { moveTo(v[0].x, v[0].y); for (k in 1..5) lineTo(v[k].x, v[k].y); close() }
    val accent = Accent.Default

    // The outline draws itself from the top, all the way round.
    val draw = stage(p, 0f, 0.46f)
    val measure = PathMeasure().apply { setPath(hex, false) }
    val part = Path()
    measure.getSegment(0f, measure.length * draw, part, true)
    drawPath(part, accent, style = Stroke(width = 1.5.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))

    // Then it fills in softly, with one facet a little brighter than the rest.
    val fill = stage(p, 0.4f, 0.68f)
    if (fill > 0f) {
        drawPath(hex, accent.copy(alpha = 0.20f * fill))
        val facet = Path().apply { moveTo(v[0].x, v[0].y); lineTo(v[1].x, v[1].y); lineTo(c.x, c.y); close() }
        drawPath(facet, accent.copy(alpha = 0.34f * fill))
    }
}
