package com.lumina.tv.data

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** A playlist can be saved for streaming only; older saved playlists keep downloading; the song list survives a restart. */
class SavedPlaylistsTest {
    @get:Rule val tmp = TemporaryFolder()

    private fun playlist(download: Boolean, description: String? = null) = SyncedPlaylist(
        "PLabc", "Friend's list", PlaylistSource.PUBLIC, MediaKind.AUDIO, 1_000L, 433, emptySet(), null, "https://i/x.jpg",
        download = download, description = description,
    )

    @Test fun `a saved playlist keeps its download choice and its description`() {
        val back = PlaylistStore.parse(PlaylistStore.serialize(listOf(playlist(download = false, description = "Songs for the road"))))
        assertEquals(1, back.size)
        assertFalse(back[0].download)
        assertEquals("Songs for the road", back[0].description)
        assertEquals(433, back[0].itemCount)
    }

    @Test fun `a playlist saved before downloading was optional still downloads`() {
        // The exact shape the previous version wrote: no "download" and no "description".
        val old = """{"version":1,"playlists":[{"id":"PLold","title":"Old","source":"PUBLIC","mode":"AUDIO","lastSyncMs":5,"itemCount":12,"excludedIds":["a"],"lastError":null,"thumbnailUrl":null}]}"""
        val p = PlaylistStore.parse(old).single()
        assertTrue("an old playlist was download-synced and must stay that way", p.download)
        assertNull(p.description)
        assertEquals(setOf("a"), p.excludedIds)
    }

    @Test fun `the song list of a 433-song playlist comes back whole and in order`() = runBlocking {
        val cache = PlaylistTracksCache(tmp.newFolder("tracks"))
        val tracks = (1..433).map { Track("https://www.youtube.com/watch?v=vid$it-xxxxx", "Song $it", "Artist ${it % 7}", 180L + it, "https://i/$it.jpg", MediaKind.AUDIO) }
        cache.write("PLabc", tracks)
        val back = cache.read("PLabc")
        assertEquals(433, back.size)
        assertEquals(tracks.first(), back.first())
        assertEquals(tracks.last(), back.last())
        assertEquals(tracks.map { it.title }, back.map { it.title })
    }

    @Test fun `an unknown or damaged cache reads as empty and never throws`() = runBlocking {
        val dir = tmp.newFolder("tracks2")
        val cache = PlaylistTracksCache(dir)
        assertTrue(cache.read("nothing-here").isEmpty())
        java.io.File(dir, "PLbad.json").writeText("{ not json")
        assertTrue(cache.read("PLbad").isEmpty())
    }

    @Test fun `removing a playlist removes its song list`() = runBlocking {
        val cache = PlaylistTracksCache(tmp.newFolder("tracks3"))
        cache.write("PLabc", listOf(Track("https://www.youtube.com/watch?v=aaaaaaa", "A", "B", 1, null, MediaKind.AUDIO)))
        cache.delete("PLabc")
        assertTrue(cache.read("PLabc").isEmpty())
    }
}
