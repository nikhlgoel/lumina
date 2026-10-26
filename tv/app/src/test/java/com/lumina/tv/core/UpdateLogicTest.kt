package com.lumina.tv.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateLogicTest {
    private val base = "https://github.com/nikhlgoel/lumina/releases/download"
    private val digest = "a".repeat(64)

    private fun asset(name: String, url: String = "$base/v1/$name", size: Long = 30_000_000, digest: String? = null) =
        """{"name":"$name","browser_download_url":"$url","size":$size${digest?.let { ""","digest":"sha256:$it"""" } ?: ""}}"""

    private fun release(vararg assets: String, draft: Boolean = false, pre: Boolean = false, body: String = "") =
        """{"draft":$draft,"prerelease":$pre,"body":"$body","assets":[${assets.joinToString(",")}]}"""

    private fun list(vararg releases: String) = "[${releases.joinToString(",")}]"

    @Test fun `versions compare numerically, not as text`() {
        assertTrue(UpdateLogic.compare("0.10.0", "0.9.0") > 0)
        assertEquals(0, UpdateLogic.compare("1.2", "1.2.0"))
        assertEquals(0, UpdateLogic.compare("v1.2.0", "1.2.0-debug"))
        assertTrue(UpdateLogic.compare("0.1.0", "0.2.0") < 0)
    }

    @Test fun `a newer tv apk is offered`() {
        val c = UpdateLogic.pick(list(release(asset("lumina-tv-0.2.0.apk", digest = digest), body = "Faster")), "0.1.0")
        assertNotNull(c)
        assertEquals("0.2.0", c!!.version)
        assertEquals(digest, c.sha256)
        assertEquals("Faster", c.notes)
    }

    @Test fun `the same or an older version is not an update`() {
        assertNull(UpdateLogic.pick(list(release(asset("lumina-tv-0.1.0.apk"))), "0.1.0"))
        assertNull(UpdateLogic.pick(list(release(asset("lumina-tv-0.1.0.apk"))), "0.3.0"))
    }

    @Test fun `a release without a tv apk is skipped and an older one that has it is still found`() {
        val pcOnly = release(asset("Lumina-Setup-2.0.0.exe"))
        val tv = release(asset("lumina-tv-0.2.0.apk"))
        assertEquals("0.2.0", UpdateLogic.pick(list(pcOnly, tv), "0.1.0")?.version)
    }

    @Test fun `the version comes from the file name, not the tag`() {
        // The PC release is v2.5.0 but carries TV 0.2.0.
        val r = """{"tag_name":"v2.5.0","draft":false,"prerelease":false,"assets":[${asset("lumina-tv-0.2.0.apk")}]}"""
        assertEquals("0.2.0", UpdateLogic.pick("[$r]", "0.1.0")?.version)
    }

    @Test fun `the newest of several is chosen`() {
        val c = UpdateLogic.pick(list(release(asset("lumina-tv-0.2.0.apk")), release(asset("lumina-tv-0.4.0.apk")), release(asset("lumina-tv-0.3.0.apk"))), "0.1.0")
        assertEquals("0.4.0", c?.version)
    }

    @Test fun `drafts, pre-releases and debug builds are never offered`() {
        assertNull(UpdateLogic.pick(list(release(asset("lumina-tv-0.2.0.apk"), draft = true)), "0.1.0"))
        assertNull(UpdateLogic.pick(list(release(asset("lumina-tv-0.2.0.apk"), pre = true)), "0.1.0"))
        assertNull(UpdateLogic.pick(list(release(asset("lumina-tv-0.2.0-debug.apk"))), "0.1.0"))
    }

    @Test fun `a file from anywhere but this repository's releases is refused`() {
        assertNull(UpdateLogic.pick(list(release(asset("lumina-tv-0.2.0.apk", url = "https://evil.example/lumina-tv-0.2.0.apk"))), "0.1.0"))
        assertNull(UpdateLogic.pick(list(release(asset("lumina-tv-0.2.0.apk", url = "http://github.com/nikhlgoel/lumina/releases/download/v1/a.apk"))), "0.1.0"))
        assertNull(UpdateLogic.pick(list(release(asset("lumina-tv-0.2.0.apk", url = "https://github.com/someone-else/lumina/releases/download/v1/a.apk"))), "0.1.0"))
    }

    @Test fun `an absurd size is refused`() {
        assertNull(UpdateLogic.pick(list(release(asset("lumina-tv-0.2.0.apk", size = 900_000_000))), "0.1.0"))
        assertNull(UpdateLogic.pick(list(release(asset("lumina-tv-0.2.0.apk", size = 0))), "0.1.0"))
    }

    @Test fun `a malformed digest is dropped rather than trusted`() {
        assertNull(UpdateLogic.pick(list(release(asset("lumina-tv-0.2.0.apk", digest = "nothex"))), "0.1.0")?.sha256)
    }

    @Test fun `garbage input is not an update and does not throw`() {
        assertNull(UpdateLogic.pick("not json", "0.1.0"))
        assertNull(UpdateLogic.pick("{}", "0.1.0"))
        assertNull(UpdateLogic.pick("[]", "0.1.0"))
    }

    @Test fun `checks are rate limited but survive a wrong clock`() {
        val now = 1_000_000_000_000L
        assertTrue(UpdateLogic.isDue(0, now))
        assertEquals(false, UpdateLogic.isDue(now - 1000, now))
        assertTrue(UpdateLogic.isDue(now - UpdateLogic.CHECK_EVERY_MS, now))
        assertTrue(UpdateLogic.isDue(now + 5000, now))
    }
}
