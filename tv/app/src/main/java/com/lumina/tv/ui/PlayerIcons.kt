package com.lumina.tv.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

/**
 * Lumina's own icons for the players, drawn on a 24 x 24 grid in one visual language. The transport icons (play, pause, next,
 * previous) are solid, with softly rounded corners and a thin facet cut through each triangle, like the gem in the logo:
 * a play button that is not the plain triangle every player has. Every other icon is a fine 1.8 line with round ends and a small
 * detail of its own (the shuffle's two crossing arrows, the repeat's closed loop, the speed gauge's needle).
 *
 * The paths are the ones in the approved drawing; the rounded-triangle ones were generated (quadratic corners, a 0.5-wide gap).
 * Drawn in black and tinted by whoever uses them, like any icon.
 */
object PlayerIcons {
    private const val LINE = 1.8f

    private fun solid(name: String, vararg paths: String): ImageVector = ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
        for (d in paths) addPath(PathParser().parsePathString(d).toNodes(), fill = SolidColor(Color.Black))
    }.build()

    private fun line(name: String, vararg paths: String, dots: List<String> = emptyList()): ImageVector = ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
        for (d in paths) addPath(
            PathParser().parsePathString(d).toNodes(), fill = null, stroke = SolidColor(Color.Black),
            strokeLineWidth = LINE, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round,
        )
        for (d in dots) addPath(PathParser().parsePathString(d).toNodes(), fill = SolidColor(Color.Black))
    }.build()

    private fun circle(cx: Float, cy: Float, r: Float) = "M${cx - r} ${cy}a$r $r 0 1 0 ${2 * r} 0a$r $r 0 1 0 ${-2 * r} 0Z"

    val Play: ImageVector by lazy {
        solid(
            "play",
            "M7.20 5.30Q7.20 4.20 8.14 4.77L18.34 10.88Q19.28 11.45 18.18 11.45L8.30 11.45Q7.20 11.45 7.20 10.35Z" +
                "M7.20 13.65Q7.20 12.55 8.30 12.55L18.18 12.55Q19.28 12.55 18.34 13.12L8.14 19.23Q7.20 19.80 7.20 18.70Z",
        )
    }

    val Pause: ImageVector by lazy {
        solid(
            "pause",
            "M6.40 6.20Q6.40 4.60 8.00 4.60L8.90 4.60Q10.50 4.60 10.50 6.20L10.50 17.80Q10.50 19.40 8.90 19.40L8.00 19.40Q6.40 19.40 6.40 17.80Z" +
                "M13.50 6.20Q13.50 4.60 15.10 4.60L16.00 4.60Q17.60 4.60 17.60 6.20L17.60 17.80Q17.60 19.40 16.00 19.40L15.10 19.40Q13.50 19.40 13.50 17.80Z",
        )
    }

    val Next: ImageVector by lazy {
        solid(
            "next",
            "M4.60 7.10Q4.60 6.20 5.40 6.62L13.95 11.13Q14.75 11.55 13.85 11.55L5.50 11.55Q4.60 11.55 4.60 10.65Z" +
                "M4.60 13.35Q4.60 12.45 5.50 12.45L13.85 12.45Q14.75 12.45 13.95 12.87L5.40 17.38Q4.60 17.80 4.60 16.90Z" +
                "M17.60 7.20Q17.60 6.20 18.60 6.20L18.80 6.20Q19.80 6.20 19.80 7.20L19.80 16.80Q19.80 17.80 18.80 17.80L18.60 17.80Q17.60 17.80 17.60 16.80Z",
        )
    }

    val Previous: ImageVector by lazy {
        solid(
            "previous",
            "M19.40 7.10Q19.40 6.20 18.60 6.62L10.05 11.13Q9.25 11.55 10.15 11.55L18.50 11.55Q19.40 11.55 19.40 10.65Z" +
                "M19.40 13.35Q19.40 12.45 18.50 12.45L10.15 12.45Q9.25 12.45 10.05 12.87L18.60 17.38Q19.40 17.80 19.40 16.90Z" +
                "M6.40 7.20Q6.40 6.20 5.40 6.20L5.20 6.20Q4.20 6.20 4.20 7.20L4.20 16.80Q4.20 17.80 5.20 17.80L5.40 17.80Q6.40 17.80 6.40 16.80Z",
        )
    }

    val Replay: ImageVector by lazy { line("replay", "M5.2 9.6A7.6 7.6 0 1 1 4.4 13.4M4.6 4.6V9.8H9.8") }

    val Shuffle: ImageVector by lazy {
        line(
            "shuffle",
            "M4 7.2h3.1c2.5 0 3.7 1.4 5.1 3.6l1.7 2.8c1.4 2.2 2.6 3.6 5.1 3.6H20M13.2 8.7c.9-1 2-1.5 3.6-1.5H20M4 16.8h3.1c1.6 0 2.7-.5 3.6-1.5M18 5l2.2 2.2L18 9.4M18 14.6l2.2 2.2L18 19",
        )
    }

    private const val REPEAT = "M4 11.2V10a3 3 0 0 1 3-3h13M17.6 4.4L20.3 7l-2.7 2.6M20 12.8V14a3 3 0 0 1-3 3H4M6.4 14.4L3.7 17l2.7 2.6"
    val Repeat: ImageVector by lazy { line("repeat", REPEAT) }
    val RepeatOne: ImageVector by lazy { line("repeat-one", REPEAT, "M10.8 10.7l1.5-1v5.6") }

    val Lyrics: ImageVector by lazy {
        line("lyrics", "M5.2 5.4h13.6a1.7 1.7 0 0 1 1.7 1.7v8.2a1.7 1.7 0 0 1-1.7 1.7h-6.6L8 20.2v-3.2H5.2a1.7 1.7 0 0 1-1.7-1.7V7.1a1.7 1.7 0 0 1 1.7-1.7zM7.6 9.6h8.8M7.6 12.8h5.4")
    }

    val UpNext: ImageVector by lazy { line("up-next", "M4 7h11.5M4 12h11.5M4 17h6M16.8 14.6l3.6 2.4-3.6 2.4z") }

    val More: ImageVector by lazy { solid("more", circle(5.2f, 12f, 1.7f), circle(12f, 12f, 1.7f), circle(18.8f, 12f, 1.7f)) }

    val Settings: ImageVector by lazy {
        line("settings", "M4 8h6.4M15.6 8H20M4 16h2.4M11.6 16H20", circle(13f, 8f, 2.3f), circle(9f, 16f, 2.3f))
    }

    val Subtitles: ImageVector by lazy {
        line("subtitles", "M5.4 5.6h13.2a2 2 0 0 1 2 2v8.8a2 2 0 0 1-2 2H5.4a2 2 0 0 1-2-2V7.6a2 2 0 0 1 2-2zM10.6 10.2a2.5 2.5 0 1 0 0 3.6M17 10.2a2.5 2.5 0 1 0 0 3.6")
    }

    val Speed: ImageVector by lazy { line("speed", "M4.4 16.6a8.1 8.1 0 1 1 15.2 0M12 14.4l3.6-4.6", dots = listOf(circle(12f, 14.6f, 1.3f))) }

    val Download: ImageVector by lazy { line("download", "M12 4.6v10.2M8 11.2l4 4 4-4M5 19.2h14") }

    /** The download icon with a tick in place of the arrow: already saved on this device. */
    val Downloaded: ImageVector by lazy { line("downloaded", "M7 12.4l3.4 3.4L17 9M5 19.2h14") }
}
