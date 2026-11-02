package com.lumina.tv.core

/**
 * Notices when a stream keeps running dry, so the picture can step down a quality instead of cycling "plays, loads, plays, loads".
 *
 * The player resumes a few seconds after it runs dry. On a connection that is only just fast enough for the chosen quality it
 * then runs dry again, and again: each stall is short, but together they are the "lag and loading" a viewer sees. A service
 * like YouTube drops to a smaller picture when that happens; this tells the controller when.
 *
 * Time is passed in, so it can be tested without a clock.
 */
class RebufferGuard(
    private val windowMs: Long = 90_000,
    private val threshold: Int = 3,
    private val quietAfterActionMs: Long = 6_000,
    private val quietAfterStepMs: Long = 25_000,
) {
    private val stalls = ArrayDeque<Long>()
    private var quietUntil = 0L

    /** A seek, a quality change or a new stream: the buffering that follows is expected, not a stall. */
    fun userAction(now: Long) {
        quietUntil = now + quietAfterActionMs
        stalls.clear()
    }

    /**
     * The player ran dry in the middle of playing. True when that has happened [threshold] times within [windowMs], which is
     * the moment to step down. After a step the new quality gets [quietAfterStepMs] to settle before the next one can count.
     */
    fun stalled(now: Long): Boolean {
        if (now < quietUntil) return false
        stalls.addLast(now)
        while (stalls.isNotEmpty() && now - stalls.first() > windowMs) stalls.removeFirst()
        if (stalls.size < threshold) return false
        stalls.clear()
        quietUntil = now + quietAfterStepMs
        return true
    }
}
