package com.lumina.tv.core

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RebufferGuardTest {
    @Test fun `one or two stalls are only a blip`() {
        val g = RebufferGuard()
        assertFalse(g.stalled(10_000))
        assertFalse(g.stalled(20_000))
    }

    @Test fun `three stalls within a minute and a half step the quality down`() {
        val g = RebufferGuard()
        assertFalse(g.stalled(10_000))
        assertFalse(g.stalled(30_000))
        assertTrue(g.stalled(50_000))
    }

    @Test fun `stalls spread over minutes do not add up`() {
        val g = RebufferGuard()
        assertFalse(g.stalled(0))
        assertFalse(g.stalled(60_000))
        assertFalse(g.stalled(120_000))
        assertFalse(g.stalled(180_000))
    }

    @Test fun `buffering right after a seek or a quality change is not a stall`() {
        val g = RebufferGuard()
        g.userAction(1_000)
        assertFalse(g.stalled(2_000))
        assertFalse(g.stalled(3_000))
        assertFalse(g.stalled(4_000))
    }

    @Test fun `a user action clears stalls already counted`() {
        val g = RebufferGuard()
        assertFalse(g.stalled(10_000))
        assertFalse(g.stalled(20_000))
        g.userAction(25_000)
        assertFalse(g.stalled(40_000))
        assertFalse(g.stalled(50_000))
    }

    @Test fun `after a step down the new quality gets time to settle`() {
        val g = RebufferGuard()
        g.stalled(10_000); g.stalled(20_000)
        assertTrue(g.stalled(30_000))
        // still inside the settling time, so these cannot trigger another step
        assertFalse(g.stalled(35_000)); assertFalse(g.stalled(40_000)); assertFalse(g.stalled(45_000))
    }

    @Test fun `it can step down again later if the trouble continues`() {
        val g = RebufferGuard()
        g.stalled(10_000); g.stalled(20_000); assertTrue(g.stalled(30_000))
        assertFalse(g.stalled(60_000)); assertFalse(g.stalled(70_000))
        assertTrue(g.stalled(80_000))
    }
}
