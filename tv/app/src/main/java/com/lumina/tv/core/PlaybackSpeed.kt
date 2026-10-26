package com.lumina.tv.core

/**
 * Playback speed steps. The same ladder as the PC app (`src/core/playbackSpeed.ts`) and YouTube,
 * so a speed chosen on one feels the same on the other.
 */
object PlaybackSpeed {
    val steps = listOf(0.25f, 0.5f, 0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f)
    val min = steps.first()
    val max = steps.last()

    /** Anything unusable becomes normal speed; the rest is held inside the ladder. */
    fun clamp(rate: Float): Float = if (rate.isNaN() || rate.isInfinite()) 1f else rate.coerceIn(min, max)

    fun label(rate: Float): String = if (rate == 1f) "Normal" else "${formatRate(rate)}×"

    /** The next step up (`+1`) or down (`-1`), or the nearest one in that direction if off the ladder. */
    fun step(current: Float, direction: Int): Float {
        val now = clamp(current)
        return if (direction >= 0) steps.firstOrNull { it > now } ?: max
        else steps.lastOrNull { it < now } ?: min
    }

    private fun formatRate(rate: Float): String =
        if (rate == rate.toInt().toFloat()) rate.toInt().toString() else rate.toString().trimEnd('0')
}
