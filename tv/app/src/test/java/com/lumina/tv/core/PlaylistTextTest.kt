package com.lumina.tv.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlaylistTextTest {
    @Test fun `a link in a description loses its markup and keeps its text`() {
        val raw = """Playlist Created with <a href="https://www.tunemymusic.com?source=plcreated">https://www.tunemymusic.com?source=pl…</a> that lets you transfer your playlist"""
        assertEquals(
            "Playlist Created with https://www.tunemymusic.com?source=pl… that lets you transfer your playlist",
            PlaylistLogic.plainText(raw),
        )
    }

    @Test fun `entities are decoded and whitespace collapses`() {
        assertEquals("Rock & Roll <live> \"best\" it's", PlaylistLogic.plainText("Rock &amp; Roll &lt;live&gt;\n\n  &quot;best&quot;&nbsp;it&#39;s"))
    }

    @Test fun `a less-than sign that is not a tag stays`() {
        assertEquals("I <3 this > that", PlaylistLogic.plainText("I <3 this > that"))
    }

    @Test fun `blank or missing is null, never an empty string`() {
        assertNull(PlaylistLogic.plainText(null))
        assertNull(PlaylistLogic.plainText("   "))
        assertNull(PlaylistLogic.plainText("<br/><b></b>"))
    }
}
