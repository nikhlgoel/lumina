package com.lumina.tv.core

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeout
import java.io.IOException

/**
 * Runs [block] with a time limit and, if it fails or runs out of time, tries again. Streaming starts by asking YouTube's
 * page for the video's links, which on a slow stick or a flaky line can stall or fail once and work the next moment; one
 * attempt with no limit left the screen on "Getting the video…" for good.
 *
 * - Each attempt gets [perAttemptMs]; running out of time counts as a failure to retry.
 * - [retryIf] decides which failures are worth another go (a removed or private video is not).
 * - A real cancellation (the person pressed Back) is never retried and never turned into an error.
 * - When every attempt has failed, the last failure is thrown; a timeout becomes an [IOException] with a plain message, because
 *   a timeout thrown as it is would look like a cancellation to the code above and be swallowed in silence.
 */
suspend fun <T> retrying(
    attempts: Int = 2,
    perAttemptMs: Long = 25_000,
    backoffMs: Long = 400,
    retryIf: (Throwable) -> Boolean = { true },
    block: suspend (attempt: Int) -> T,
): T {
    var last: Throwable? = null
    for (attempt in 0 until attempts) {
        try {
            return withTimeout(perAttemptMs) { block(attempt) }
        } catch (e: TimeoutCancellationException) {
            last = IOException("It took too long to reach YouTube. Check the connection and try again.")
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            if (!retryIf(e)) throw e
            last = e
        }
        if (attempt < attempts - 1) delay(backoffMs)
    }
    throw last ?: IllegalStateException("No attempt was made")
}
