package com.lumina.tv.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaylistKindTest {
    @Test fun `liked videos is video however much music is in it`() =
        assertEquals(PlaylistKind.VIDEO, PlaylistKinds.classify(isLikes = true, musicCount = 20, sampled = 20))

    @Test fun `mostly music is music`() = assertEquals(PlaylistKind.MUSIC, PlaylistKinds.classify(false, 12, 20))

    @Test fun `hardly any music is video`() = assertEquals(PlaylistKind.VIDEO, PlaylistKinds.classify(false, 3, 20))

    @Test fun `in between is mixed`() = assertEquals(PlaylistKind.MIXED, PlaylistKinds.classify(false, 8, 20))

    @Test fun `nothing sampled is mixed so it is never hidden`() = assertEquals(PlaylistKind.MIXED, PlaylistKinds.classify(false, 0, 0))

    @Test fun `the music filter hides video playlists only`() {
        assertTrue(PlaylistKinds.shown(PlaylistKind.MUSIC, music = true, videos = false))
        assertTrue(PlaylistKinds.shown(PlaylistKind.MIXED, music = true, videos = false))
        assertFalse(PlaylistKinds.shown(PlaylistKind.VIDEO, music = true, videos = false))
    }

    @Test fun `the videos filter hides music playlists only and all shows everything`() {
        assertFalse(PlaylistKinds.shown(PlaylistKind.MUSIC, music = false, videos = true))
        assertTrue(PlaylistKinds.shown(PlaylistKind.VIDEO, music = false, videos = true))
        assertTrue(PlaylistKinds.shown(PlaylistKind.MUSIC, music = false, videos = false))
        assertTrue(PlaylistKinds.shown(PlaylistKind.VIDEO, music = false, videos = false))
    }
}
