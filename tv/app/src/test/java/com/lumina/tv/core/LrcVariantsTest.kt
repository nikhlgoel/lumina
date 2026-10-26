package com.lumina.tv.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LrcVariantsTest {
    @Test fun `a plain title and channel give one first guess`() {
        val v = Lrc.queryVariants("Espresso (Official Video)", "Sabrina Carpenter - Topic")
        assertEquals("Sabrina Carpenter" to "Espresso", v.first())
    }

    @Test fun `artist dash song is tried in both orders`() {
        val v = Lrc.queryVariants("Arijit Singh - Tum Hi Ho", "T-Series")
        assertTrue(("Arijit Singh" to "Tum Hi Ho") in v)
        assertTrue(("Tum Hi Ho" to "Arijit Singh") in v)
    }

    @Test fun `the first of several artists is tried alone`() {
        val v = Lrc.queryVariants("Song", "Ann, Bob & Cat")
        assertTrue(("Ann" to "Song") in v)
    }

    @Test fun `bar separated titles offer the second piece as artist`() {
        val v = Lrc.queryVariants("Tere Bina | Arijit Singh | Movie", "Some Label")
        assertTrue(("Arijit Singh" to "Tere Bina") in v)
    }

    @Test fun `variants have no repeats and never an empty title`() {
        val v = Lrc.queryVariants("Song", "Song")
        assertEquals(v.distinct(), v)
        assertTrue(v.all { it.second.isNotBlank() })
    }

    @Test fun `section labels are not lyrics`() {
        assertEquals(listOf("Line one", "Line two"), Lrc.plainLines("[Chorus]\nLine one\n\n[Jungkook]\nLine two\n"))
    }

    @Test fun `latin detection`() {
        assertTrue(Lrc.mostlyLatin(listOf("tere bina jee na lage")))
        assertFalse(Lrc.mostlyLatin(listOf("तेरे बिना")))
    }
}
