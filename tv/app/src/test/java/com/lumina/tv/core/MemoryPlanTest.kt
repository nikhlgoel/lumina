package com.lumina.tv.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MemoryPlanTest {
    @Test fun `a 1 GB stick gets the small caps`() {
        val p = MemoryPlan.forDevice(totalMemMb = 950, memoryClassMb = 192, lowRamFlag = false)
        assertTrue(p.lowMemory)
        assertEquals(20 * 1024 * 1024, p.bufferBytes)
        assertEquals(0.67f, p.backdropScale, 0.001f)
    }

    @Test fun `a 2 GB stick keeps the full caps`() {
        val p = MemoryPlan.forDevice(totalMemMb = 1700, memoryClassMb = 192, lowRamFlag = false)
        assertFalse(p.lowMemory)
        assertEquals(48 * 1024 * 1024, p.bufferBytes)
        assertEquals(1f, p.backdropScale, 0.001f)
    }

    @Test fun `any one sign of a small device is enough`() {
        assertTrue(MemoryPlan.forDevice(4000, 256, lowRamFlag = true).lowMemory)
        assertTrue(MemoryPlan.forDevice(4000, 96, lowRamFlag = false).lowMemory)
    }

    @Test fun `an unknown size is not treated as small`() {
        assertFalse(MemoryPlan.forDevice(0, 0, lowRamFlag = false).lowMemory)
    }

    @Test fun `the small plan reads less ahead and caches fewer pictures than the full plan`() {
        val low = MemoryPlan.forDevice(900, 128, true)
        val full = MemoryPlan.forDevice(2000, 256, false)
        assertTrue(low.bufferBytes < full.bufferBytes && low.imageCachePercent < full.imageCachePercent && low.bufferMaxMs < full.bufferMaxMs)
    }
}
