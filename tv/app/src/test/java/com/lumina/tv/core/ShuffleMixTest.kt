package com.lumina.tv.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

class ShuffleMixTest {
    @Test fun `mix keeps every song once and drops repeats across groups`() {
        val a = listOf("1", "2", "3")
        val b = listOf("3", "4")
        val mixed = ShuffleMix.mix(listOf(a, b), { it }, Random(7))
        assertEquals(setOf("1", "2", "3", "4"), mixed.toSet())
        assertEquals(4, mixed.size)
    }

    @Test fun `mix takes the groups in turn so the start is not all from one`() {
        val a = (1..10).map { "a$it" }
        val b = (1..10).map { "b$it" }
        val first4 = ShuffleMix.mix(listOf(a, b), { it }, Random(3)).take(4)
        assertTrue(first4.any { it.startsWith("a") } && first4.any { it.startsWith("b") })
        assertEquals(2, first4.count { it.startsWith("a") })
    }

    @Test fun `mix of nothing is nothing`() {
        assertTrue(ShuffleMix.mix(emptyList<List<String>>(), { it }).isEmpty())
        assertTrue(ShuffleMix.mix(listOf(emptyList<String>()), { it }).isEmpty())
    }

    @Test fun `a short group does not stop the others being taken in full`() {
        val mixed = ShuffleMix.mix(listOf(listOf("x"), (1..5).map { "y$it" }), { it }, Random(1))
        assertEquals(6, mixed.size)
    }

    @Test fun `country lookup ignores case and falls back to the United States`() {
        assertEquals("India", Countries.byCode("in")?.name)
        assertEquals("US", Countries.defaultFor("ZZ").code)
        assertEquals("IN", Countries.defaultFor("IN").code)
        assertEquals("US", Countries.defaultFor(null).code)
    }
}
