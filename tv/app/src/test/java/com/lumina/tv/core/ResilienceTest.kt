package com.lumina.tv.core

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.IOException

@OptIn(ExperimentalCoroutinesApi::class)
class ResilienceTest {
    @Test fun `a first attempt that works is not repeated`() = runTest {
        var calls = 0
        val r = retrying { calls++; "ok" }
        assertEquals("ok", r)
        assertEquals(1, calls)
    }

    @Test fun `a failure is retried and the second attempt's answer is used`() = runTest {
        var calls = 0
        val r = retrying { n -> calls++; if (n == 0) throw IOException("dropped") else "second" }
        assertEquals("second", r)
        assertEquals(2, calls)
    }

    @Test fun `an attempt that stalls is given up on and retried`() = runTest {
        var calls = 0
        val r = retrying(perAttemptMs = 1_000) { n -> calls++; if (n == 0) delay(60_000); "after the stall" }
        assertEquals("after the stall", r)
        assertEquals(2, calls)
    }

    @Test fun `when every attempt times out the error is an IOException, not a cancellation`() = runTest {
        try {
            retrying<String>(attempts = 2, perAttemptMs = 500) { delay(60_000); "never" }
            fail("should have thrown")
        } catch (e: IOException) {
            assertTrue(e.message!!.contains("too long"))
        }
    }

    @Test fun `a failure that is not worth retrying is thrown at once`() = runTest {
        var calls = 0
        try {
            retrying(retryIf = { it !is IllegalStateException }) { calls++; throw IllegalStateException("removed") }
            fail("should have thrown")
        } catch (e: IllegalStateException) {
            assertEquals(1, calls)
        }
    }

    @Test fun `cancelling from outside stops it and is not retried`() = runTest {
        var calls = 0
        val job = async { retrying<String> { calls++; delay(60_000); "never" } }
        runCurrent()
        job.cancel(CancellationException("back pressed"))
        advanceTimeBy(100_000)
        assertEquals(1, calls)
        assertTrue(job.isCancelled)
    }
}
