package com.lumina.tv.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class UsefulVideosTest {
    private data class V(val title: String, val channel: String = "", val seconds: Long = 600)

    private fun rank(items: List<V>, limit: Int = 24, minGood: Int = 8) =
        UsefulVideos.rank(items, { it.title }, { it.channel }, { it.seconds }, limit, minGood)

    @Test fun `a programming tutorial scores well and a game show episode scores badly`() {
        assertTrue(UsefulVideos.score("Kotlin tutorial for beginners", "Dev Channel") > 0)
        assertTrue(UsefulVideos.score("Indian Game Show | Full Episode 49", "SET India") < 0)
    }

    @Test fun `a plain title with no signal scores zero`() {
        assertEquals(0, UsefulVideos.score("Sunset over the hills", "Nature"))
    }

    @Test fun `ai is matched as a word and not inside another word`() {
        assertTrue(UsefulVideos.score("How AI works") > 0)
        assertEquals(0, UsefulVideos.score("Wait for the train"))
    }

    @Test fun `useful videos come first, entertainment is left out, clips are dropped`() {
        val items = listOf(
            V("Funny prank on my friend"),
            V("System design explained for interviews", "Tech Channel"),
            V("Python for beginners: full course", "Code Academy"),
            V("Quick tip #shorts", seconds = 30),
            V("Taarak Mehta full episode", "Neela Film"),
            V("A calm walk in the forest", "Nature"),
        )
        val out = rank(items, minGood = 2).map { it.title }
        // The Python course has four learning signals (python, beginners, course, "for beginners") against three for the other.
        assertEquals(listOf("Python for beginners: full course", "System design explained for interviews"), out)
    }

    @Test fun `when few are useful the neutral ones fill in, but never entertainment`() {
        val items = listOf(V("Kotlin tutorial"), V("A calm walk in the forest"), V("Funny prank video"))
        val out = rank(items, minGood = 8).map { it.title }
        assertEquals(listOf("Kotlin tutorial", "A calm walk in the forest"), out)
    }

    @Test fun `equally useful videos keep the order they came in`() {
        val items = listOf(V("Rust tutorial A"), V("Rust tutorial B"), V("Rust tutorial C"))
        assertEquals(listOf("Rust tutorial A", "Rust tutorial B", "Rust tutorial C"), rank(items).map { it.title })
    }

    @Test fun `the result is cut to the limit`() {
        val items = (1..30).map { V("Python tutorial part $it") }
        assertEquals(24, rank(items, limit = 24).size)
    }

    @Test fun `queries come from the useful things watched, most often first`() {
        val watched = listOf(
            "Kotlin coroutines tutorial" to "Dev",
            "Kotlin Flow explained" to "Dev",
            "Learn Rust in one hour" to "Dev",
            "Full Episode Indian Game Show" to "SET",
        )
        assertEquals(listOf("kotlin tutorial", "rust tutorial"), UsefulVideos.interestQueries(watched))
    }

    @Test fun `entertainment that was watched does not steer the queries`() {
        val watched = listOf("Taarak Mehta full episode" to "Neela", "Funny prank compilation" to "Fun")
        assertTrue(UsefulVideos.interestQueries(watched).isEmpty())
    }

    @Test fun `nothing watched means no personal queries`() {
        assertTrue(UsefulVideos.interestQueries(emptyList()).isEmpty())
    }

    @Test fun `evergreen topics change from day to day and are never repeated within a day`() {
        val today = UsefulVideos.curated(20_000, 2)
        assertEquals(2, today.distinct().size)
        assertNotEquals(today, UsefulVideos.curated(20_001, 2))
    }

    @Test fun `evergreen topics are all real queries`() {
        for (day in 0 until 30) assertFalse(UsefulVideos.curated(day, 3).any { it.isBlank() })
    }
}
