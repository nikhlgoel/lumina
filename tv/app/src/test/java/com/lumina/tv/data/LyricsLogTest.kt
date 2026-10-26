package com.lumina.tv.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class LyricsLogTest {
    @get:Rule val tmp = TemporaryFolder()

    @Test fun `a lookup is written as one readable block with what was asked and what happened`() {
        val file = File(tmp.root, "lyrics-matches.log")
        val log = LyricsLog(file)
        val trace = log.begin("Espresso (Official Video)", "Sabrina Carpenter - Topic", 175, "media=abc playerLengthAtStart=0ms")
        trace.note("variant 1: artist=\"Sabrina Carpenter\" title=\"Espresso\"")
        trace.note("      #1 \"Espresso\" by \"Sabrina Carpenter\" 175s timed -> CHOSEN")
        trace.outcome("FOUND timed lyrics from LRCLIB (54 lines)")
        log.write(trace)

        val text = file.readText()
        assertTrue(text, text.contains("LOOKUP  title=\"Espresso (Official Video)\"  artist=\"Sabrina Carpenter - Topic\"  length=175s"))
        assertTrue(text.contains("context: media=abc playerLengthAtStart=0ms"))
        assertTrue(text.contains("-> CHOSEN"))
        assertTrue(text.contains("=> FOUND timed lyrics from LRCLIB"))
    }

    @Test fun `an unknown length is said to be unknown, not zero`() {
        val text = LyricsLog(File(tmp.root, "a.log")).begin("Song", "Artist", 0).render("2026-01-01T00:00:00Z")
        assertTrue(text, text.contains("length=unknown"))
        assertFalse(text.contains("length=0"))
    }

    @Test fun `values are quoted so one value is always one token, however messy the title`() {
        assertEquals("\"a \\\"quoted\\\" title\"", LyricsLog.quote("a \"quoted\" title"))
        assertFalse(LyricsLog.quote("line\r\nbreak").contains('\n'))
        assertTrue(LyricsLog.quote("x".repeat(500)).length < 200)
    }

    @Test fun `the file is capped and one older copy is kept`() {
        val file = File(tmp.root, "lyrics-matches.log")
        val log = LyricsLog(file, maxBytes = 2_000)
        repeat(40) { i ->
            val t = log.begin("Song $i", "Artist", 100)
            t.note("x".repeat(100))
            log.write(t)
        }
        assertTrue("the live file stays near the cap", file.length() < 4_000)
        assertTrue("an older copy exists", File(tmp.root, "lyrics-matches.log.1").exists())
    }

    @Test fun `a log that cannot be written never throws`() {
        val blocked = File(tmp.root, "not-a-folder").apply { writeText("a file where a folder should be") }
        LyricsLog(File(blocked, "lyrics.log")).write(LyricsLog(File(tmp.root, "x")).begin("Song", "Artist", 1))
    }
}
