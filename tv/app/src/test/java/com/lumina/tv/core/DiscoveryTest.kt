package com.lumina.tv.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DiscoveryTest {
    private val chart = """{"data":[
        {"id":1,"name":"First Artist","picture":"p1","picture_xl":"https://i/xl1.jpg"},
        {"id":2,"name":"  ","picture_xl":"https://i/blank.jpg"},
        {"id":3,"name":"Third Artist","picture_medium":"https://i/m3.jpg"},
        {"id":4,"name":"No Picture"}
    ],"total":4}"""

    @Test fun `deezer's chart comes back in rank order with the biggest picture`() {
        val list = Discovery.parseDeezerArtists(chart)
        assertEquals(listOf("First Artist", "Third Artist", "No Picture"), list.map { it.name })
        assertEquals(listOf(1, 2, 3), list.map { it.rank })
        assertEquals("https://i/xl1.jpg", list[0].imageUrl)
        assertEquals("https://i/m3.jpg", list[1].imageUrl)
        assertNull(list[2].imageUrl)
    }

    @Test fun `a broken or empty chart is an empty list, never a crash`() {
        assertTrue(Discovery.parseDeezerArtists("").isEmpty())
        assertTrue(Discovery.parseDeezerArtists("{not json").isEmpty())
        assertTrue(Discovery.parseDeezerArtists("""{"error":{"type":"Exception"}}""").isEmpty())
    }

    @Test fun `the artists you hear most come first, across every source`() {
        val saved = listOf("Arijit Singh", "Arijit Singh", "Taylor Swift")
        val liked = listOf("taylor swift", "Arijit Singh", "Queen")
        val played = listOf("Queen - Topic", "Queen")
        // Arijit 3, Taylor 2, Queen 3 ("- Topic" is the same artist): Arijit appeared first, so he leads Queen.
        assertEquals(listOf("Arijit Singh", "Queen", "Taylor Swift"), Discovery.topArtists(listOf(saved, liked, played), limit = 5))
    }

    @Test fun `limit, blanks and Various Artists`() {
        val names = listOf("", "  ", "Various Artists", "Unknown", "A", "A", "B", "C")
        assertEquals(listOf("A", "B"), Discovery.topArtists(listOf(names), limit = 2))
    }

    @Test fun `songs are grouped by artist, once each, most songs first, with a picture`() {
        val groups = Discovery.artistGroups(
            listOf("Queen" to null, "queen - Topic" to "q.jpg", "Adele" to "a.jpg", "Queen" to "q2.jpg", "" to "x.jpg", "Various Artists" to "v.jpg"),
        )
        assertEquals(listOf("Queen", "Adele"), groups.map { it.name })
        assertEquals(listOf(3, 1), groups.map { it.songs })
        assertEquals("q.jpg", groups[0].imageUrl)
    }

    @Test fun `interleave takes one from each list in turn and skips a list that ran out`() {
        assertEquals(listOf("v1", "a1", "m1", "v2", "a2", "v3"), Discovery.interleave(listOf("v1", "v2", "v3"), listOf("a1", "a2"), listOf("m1")))
        assertEquals(listOf(1, 2), Discovery.interleave(listOf(1, 2), emptyList()))
        assertTrue(Discovery.interleave<String>().isEmpty())
    }

    @Test fun `a reaction video or a long mix is not a song`() {
        assertTrue(Discovery.looksLikeSong(214))
        assertTrue(Discovery.looksLikeSong(900))
        assertTrue(Discovery.looksLikeSong(0))
        assertEquals(false, Discovery.looksLikeSong(1293))
        assertEquals(false, Discovery.looksLikeSong(3 * 3600L))
    }

    @Test fun `artists you might like never repeat ones you already know`() {
        val out = Discovery.newArtists(listOf("Queen", "New One", "new one", "Other - Topic", "Mine"), mine = listOf("mine", "Queen - Topic"), limit = 5)
        assertEquals(listOf("New One", "Other"), out)
    }
}
