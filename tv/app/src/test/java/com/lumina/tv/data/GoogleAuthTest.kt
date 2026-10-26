package com.lumina.tv.data

import android.content.SharedPreferences
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.net.HttpURLConnection
import java.net.URL

/** Android's SharedPreferences is a stub on the plain JVM; this one keeps its values in a map. */
class MemoryPrefs : SharedPreferences {
    private val map = HashMap<String, Any?>()
    override fun getAll(): MutableMap<String, *> = HashMap(map)
    override fun getString(key: String, defValue: String?) = map[key] as? String ?: defValue
    override fun getStringSet(key: String, defValues: MutableSet<String>?): MutableSet<String>? = defValues
    override fun getInt(key: String, defValue: Int) = map[key] as? Int ?: defValue
    override fun getLong(key: String, defValue: Long) = map[key] as? Long ?: defValue
    override fun getFloat(key: String, defValue: Float) = map[key] as? Float ?: defValue
    override fun getBoolean(key: String, defValue: Boolean) = map[key] as? Boolean ?: defValue
    override fun contains(key: String) = map.containsKey(key)
    override fun registerOnSharedPreferenceChangeListener(l: SharedPreferences.OnSharedPreferenceChangeListener?) {}
    override fun unregisterOnSharedPreferenceChangeListener(l: SharedPreferences.OnSharedPreferenceChangeListener?) {}
    override fun edit(): SharedPreferences.Editor = object : SharedPreferences.Editor {
        private val pending = HashMap<String, Any?>()
        private val removals = HashSet<String>()
        override fun putString(key: String, value: String?) = apply { pending[key] = value }
        override fun putStringSet(key: String, values: MutableSet<String>?) = apply { pending[key] = values }
        override fun putInt(key: String, value: Int) = apply { pending[key] = value }
        override fun putLong(key: String, value: Long) = apply { pending[key] = value }
        override fun putFloat(key: String, value: Float) = apply { pending[key] = value }
        override fun putBoolean(key: String, value: Boolean) = apply { pending[key] = value }
        override fun remove(key: String) = apply { removals += key }
        override fun clear() = apply { map.clear() }
        override fun commit(): Boolean { apply(); return true }
        override fun apply() {
            removals.forEach { map.remove(it) }
            map.putAll(pending)
        }
    }
}

class GoogleAuthTest {
    private lateinit var server: MockWebServer
    private lateinit var prefs: MemoryPrefs
    private var clock = 1_000_000L
    private val sleeps = mutableListOf<Long>()

    private fun auth() = GoogleAuth(
        http = OkHttpClient(),
        prefs = prefs,
        deviceCodeUrl = server.url("/device/code").toString(),
        tokenUrl = server.url("/token").toString(),
        now = { clock },
        // Time only moves when something waits, so a "30 minute" expiry takes no real time.
        sleep = { ms -> sleeps += ms; clock += ms },
    )

    private fun reply(code: Int, json: String) = server.enqueue(MockResponse().setResponseCode(code).setBody(json))

    @Before fun setUp() {
        server = MockWebServer().also { it.start() }
        prefs = MemoryPrefs()
    }

    @After fun tearDown() = server.shutdown()

    private fun withCredentials(a: GoogleAuth) { a.credentials = GoogleAuth.Credentials("id.apps.googleusercontent.com", "secret-secret") }

    @Test
    fun `asks for a code with the read only youtube scope and returns what to show`() = runBlocking {
        val a = auth().also(::withCredentials)
        reply(200, """{"device_code":"DC","user_code":"ABCD-EFGH","verification_url":"https://www.google.com/device","expires_in":1800,"interval":5}""")
        val code = a.requestCode()
        assertEquals("ABCD-EFGH", code.userCode)
        assertEquals("https://www.google.com/device", code.verificationUrl)
        val sent = server.takeRequest().body.readUtf8()
        assertTrue(sent, sent.contains("client_id=id.apps.googleusercontent.com"))
        assertTrue(sent, sent.contains("youtube.readonly"))
        assertFalse("no write scope may ever be requested", sent.contains("auth%2Fyoutube&") || sent.endsWith("auth%2Fyoutube"))
    }

    @Test
    fun `refuses to start without a client id and says why`() = runBlocking {
        try { auth().requestCode(); fail("should have thrown") } catch (e: GoogleAuth.AuthException) {
            assertEquals("no_credentials", e.code)
        }
    }

    @Test
    fun `waits through pending and slow down, then stores the tokens`() = runBlocking {
        val a = auth().also(::withCredentials)
        reply(428, """{"error":"authorization_pending"}""")
        reply(403, """{"error":"slow_down"}""")
        reply(200, """{"access_token":"AT","refresh_token":"RT","expires_in":3600,"token_type":"Bearer"}""")
        a.awaitApproval(GoogleAuth.DeviceCode("DC", "X", "u", 1800, 5))
        // 5 s, 5 s (pending changes nothing), then slow_down adds 5 s: the third wait is 10 s.
        assertEquals(listOf(5_000L, 5_000L, 10_000L), sleeps)
        assertTrue(a.signedIn)
        assertEquals("AT", prefs.getString("accessToken", null))
        assertEquals("RT", prefs.getString("refreshToken", null))
    }

    @Test
    fun `never polls faster than five seconds even if told to`() = runBlocking {
        val a = auth().also(::withCredentials)
        reply(200, """{"access_token":"AT","refresh_token":"RT","expires_in":3600}""")
        a.awaitApproval(GoogleAuth.DeviceCode("DC", "X", "u", 1800, 1))
        assertEquals(listOf(5_000L), sleeps)
    }

    @Test
    fun `stops with a clear message when the person declines on the phone`() = runBlocking {
        val a = auth().also(::withCredentials)
        reply(403, """{"error":"access_denied"}""")
        try { a.awaitApproval(GoogleAuth.DeviceCode("DC", "X", "u", 1800, 5)); fail() } catch (e: GoogleAuth.AuthException) {
            assertEquals("access_denied", e.code)
            assertTrue(e.message!!.contains("declined"))
        }
        assertFalse(a.signedIn)
    }

    @Test
    fun `gives up when the code expires`() = runBlocking {
        val a = auth().also(::withCredentials)
        repeat(20) { reply(428, """{"error":"authorization_pending"}""") }
        try { a.awaitApproval(GoogleAuth.DeviceCode("DC", "X", "u", 30, 5)); fail() } catch (e: GoogleAuth.AuthException) {
            assertEquals("expired_token", e.code)
        }
    }

    @Test
    fun `reports a wrong client id in words a person can act on`() = runBlocking {
        val a = auth().also(::withCredentials)
        reply(401, """{"error":"invalid_client"}""")
        try { a.awaitApproval(GoogleAuth.DeviceCode("DC", "X", "u", 1800, 5)); fail() } catch (e: GoogleAuth.AuthException) {
            assertTrue(e.message!!, e.message!!.contains("TVs and Limited Input devices"))
        }
    }

    @Test
    fun `returns the stored token while it is fresh and does not call Google`() = runBlocking {
        val a = auth().also(::withCredentials)
        prefs.edit().putString("accessToken", "FRESH").putString("refreshToken", "RT").putLong("expiresAtMs", clock + 3_600_000).apply()
        assertEquals("FRESH", a.accessToken())
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `refreshes an expired token and keeps the refresh token Google does not repeat`() = runBlocking {
        val a = auth().also(::withCredentials)
        prefs.edit().putString("accessToken", "OLD").putString("refreshToken", "RT").putLong("expiresAtMs", clock - 1).apply()
        reply(200, """{"access_token":"NEW","expires_in":3600}""")
        assertEquals("NEW", a.accessToken())
        assertEquals("RT", prefs.getString("refreshToken", null))
        val sent = server.takeRequest().body.readUtf8()
        assertTrue(sent, sent.contains("grant_type=refresh_token") && sent.contains("refresh_token=RT"))
    }

    @Test
    fun `signs out by itself when Google says the access was revoked`() = runBlocking {
        val a = auth().also(::withCredentials)
        prefs.edit().putString("accessToken", "OLD").putString("refreshToken", "RT").putLong("expiresAtMs", clock - 1).apply()
        reply(400, """{"error":"invalid_grant"}""")
        try { a.accessToken(); fail() } catch (e: GoogleAuth.AuthException) { assertEquals("invalid_grant", e.code) }
        assertFalse("a dead sign-in must not look signed in", a.signedIn)
    }

    @Test
    fun `sign out forgets the tokens but keeps the client id`() = runBlocking {
        val a = auth().also(::withCredentials)
        prefs.edit().putString("accessToken", "A").putString("refreshToken", "R").apply()
        a.signOut()
        assertFalse(a.signedIn)
        assertNotNull(a.credentials)
    }

    @Test
    fun `no credentials means none are reported`() {
        assertNull(auth().credentials)
        assertFalse(auth().signedIn)
    }
}

class YouTubeApiTest {
    private lateinit var server: MockWebServer

    @Before fun setUp() { server = MockWebServer().also { it.start() } }
    @After fun tearDown() = server.shutdown()

    private fun api(): YouTubeApi {
        val prefs = MemoryPrefs()
        prefs.edit().putString("clientId", "id.apps.googleusercontent.com").putString("clientSecret", "secret-secret")
            .putString("accessToken", "TOKEN").putString("refreshToken", "RT").putLong("expiresAtMs", Long.MAX_VALUE / 2).apply()
        return YouTubeApi(OkHttpClient(), GoogleAuth(OkHttpClient(), prefs), server.url("/youtube/v3").toString().trimEnd('/'))
    }

    private fun reply(code: Int, json: String) = server.enqueue(MockResponse().setResponseCode(code).setBody(json))

    @Test
    fun `lists liked videos first and then every playlist across pages`() = runBlocking {
        reply(200, """{"items":[{"contentDetails":{"relatedPlaylists":{"likes":"LL"}}}]}""")
        reply(200, """{"items":[{"id":"PL1","snippet":{"title":"Gym"},"contentDetails":{"itemCount":12}}],"nextPageToken":"P2"}""")
        reply(200, """{"items":[{"id":"PL2","snippet":{"title":"Focus"},"contentDetails":{"itemCount":3}}]}""")
        val lists = api().myPlaylists()
        assertEquals(listOf("LL", "PL1", "PL2"), lists.map { it.id })
        assertEquals("Liked videos", lists[0].title)
        assertEquals(12, lists[1].itemCount)
        server.takeRequest()
        val req = server.takeRequest()
        assertEquals("Bearer TOKEN", req.getHeader("Authorization"))
        assertTrue(req.path!!, req.path!!.contains("mine=true"))
    }

    @Test
    fun `drops private and deleted entries and keeps the order`() {
        val json = JSONObject(
            """{"items":[
              {"snippet":{"title":"Song A","videoOwnerChannelTitle":"Artist - Topic","resourceId":{"videoId":"aaa"},"thumbnails":{"medium":{"url":"https://i/m.jpg"},"high":{"url":"https://i/h.jpg"}}},"contentDetails":{"videoId":"aaa"}},
              {"snippet":{"title":"Private video","resourceId":{"videoId":"bbb"}},"contentDetails":{"videoId":"bbb"}},
              {"snippet":{"title":"Deleted video","resourceId":{"videoId":"ccc"}}},
              {"snippet":{"title":"Song D","resourceId":{"videoId":"ddd"}}}
            ],"nextPageToken":"N"}""",
        )
        val (entries, next) = YouTubeApi.parseItems(json)
        assertEquals(listOf("aaa", "ddd"), entries.map { it.videoId })
        assertEquals("https://i/h.jpg", entries[0].thumbnail)
        assertEquals("N", next)
    }

    @Test
    fun `explains a disabled api, an exhausted quota and a revoked sign in`() = runBlocking {
        reply(403, """{"error":{"message":"YouTube Data API v3 has not been used in project 123","errors":[{"reason":"accessNotConfigured"}]}}""")
        try { api().items("PLx"); fail() } catch (e: YouTubeApi.ApiException) { assertTrue(e.message!!, e.message!!.contains("isn't switched on")) }
        reply(403, """{"error":{"errors":[{"reason":"quotaExceeded"}]}}""")
        try { api().items("PLx"); fail() } catch (e: YouTubeApi.ApiException) { assertTrue(e.message!!, e.message!!.contains("daily limit")) }
        reply(404, """{"error":{"errors":[{"reason":"playlistNotFound"}]}}""")
        try { api().items("PLx"); fail() } catch (e: YouTubeApi.ApiException) { assertTrue(e.message!!, e.message!!.contains("wasn't found")) }
    }
}

class PhoneSetupServerTest {
    private class Recorder : PhoneSetupServer.Actions {
        val added = mutableListOf<Pair<String, Boolean>>()
        var google: Pair<String, String>? = null
        override suspend fun addPlaylist(link: String, alsoDownload: Boolean): String { added += link to alsoDownload; return "Added <b>it</b>" }
        override fun saveGoogle(clientId: String, clientSecret: String): String { google = clientId to clientSecret; return "Saved." }
        override fun googleConfigured() = google != null
    }

    private val actions = Recorder()
    private val server = PhoneSetupServer(actions, hostProvider = { "127.0.0.1" })

    @After fun tearDown() = server.stop()

    private fun request(method: String, url: String, body: String? = null): Pair<Int, String> {
        val c = URL(url).openConnection() as HttpURLConnection
        c.requestMethod = method
        c.connectTimeout = 3000
        c.readTimeout = 5000
        if (body != null) { c.doOutput = true; c.outputStream.use { it.write(body.toByteArray()) } }
        val code = c.responseCode
        val text = (if (code < 400) c.inputStream else c.errorStream)?.bufferedReader()?.readText().orEmpty()
        return code to text
    }

    @Test
    fun `serves the page and accepts a playlist with the right pin`() {
        val run = server.start()!!
        val (code, html) = request("GET", run.url)
        assertEquals(200, code)
        assertTrue(html.contains("Lumina TV setup"))
        val (c2, page) = request("POST", run.url + "playlist", "k=${run.pin}&link=https%3A%2F%2Fyoutube.com%2Fplaylist%3Flist%3DPLabc&download=on")
        assertEquals(200, c2)
        assertEquals(listOf("https://youtube.com/playlist?list=PLabc" to true), actions.added)
        assertTrue("the reply must be escaped, not markup", page.contains("Added &lt;b&gt;it&lt;/b&gt;"))
    }

    @Test
    fun `an unticked box means saved for streaming only, no download`() {
        val run = server.start()!!
        request("POST", run.url + "playlist", "k=${run.pin}&link=x")
        assertEquals(false, actions.added.single().second)
    }

    @Test
    fun `a whole shared message with the link inside arrives with its line break`() {
        val run = server.start()!!
        val shared = "Check out my playlist\nhttps://www.youtube.com/playlist?list=PLabcdefghijklmnop\n"
        request("POST", run.url + "playlist", "k=${run.pin}&link=" + java.net.URLEncoder.encode(shared, "UTF-8"))
        assertEquals(shared, actions.added.single().first)
    }

    @Test
    fun `the address a QR code carries opens the page with the PIN already filled in`() {
        val run = server.start()!!
        val (code, html) = request("GET", run.url + "?k=${run.pin}")
        assertEquals(200, code)
        assertTrue(html.contains("value=\"${run.pin}\""))
    }

    @Test
    fun `the page offers adding first and downloading as an unticked extra`() {
        val run = server.start()!!
        val (_, html) = request("GET", run.url)
        assertTrue(html.contains("added to your playlists"))
        assertFalse("the download box must not start ticked", Regex("name=\"download\"[^>]*checked").containsMatchIn(html))
    }

    @Test
    fun `refuses a wrong pin and does not act`() {
        val run = server.start()!!
        val (code, _) = request("POST", run.url + "playlist", "k=0000x&link=x")
        assertEquals(403, code)
        assertTrue(actions.added.isEmpty())
    }

    @Test
    fun `locks after five wrong pins even for the right one`() {
        val run = server.start()!!
        repeat(5) { request("POST", run.url + "playlist", "k=nope&link=x") }
        val (code, _) = request("POST", run.url + "playlist", "k=${run.pin}&link=x")
        assertEquals(429, code)
        assertTrue(actions.added.isEmpty())
    }

    @Test
    fun `refuses an oversized body and unknown paths`() {
        val run = server.start()!!
        assertEquals(413, request("POST", run.url + "playlist", "k=${run.pin}&link=" + "x".repeat(20_000)).first)
        assertEquals(404, request("GET", run.url + "secrets").first)
        assertEquals(404, request("POST", run.url + "library", "k=${run.pin}").first)
    }

    @Test
    fun `stores the google details only with the pin`() {
        val run = server.start()!!
        request("POST", run.url + "google", "k=wrong&client_id=a&client_secret=b")
        assertNull(actions.google)
        request("POST", run.url + "google", "k=${run.pin}&client_id=abc.apps.googleusercontent.com&client_secret=shhh")
        assertEquals("abc.apps.googleusercontent.com" to "shhh", actions.google)
    }

    @Test
    fun `stops listening when closed and gives a fresh pin when reopened`() {
        val first = server.start()!!
        server.stop()
        assertFalse(server.isRunning)
        val second = server.start()!!
        assertTrue(second.url.startsWith("http://127.0.0.1:"))
        assertEquals(200, request("GET", second.url).first)
        assertNotNull(first.pin)
    }
}
