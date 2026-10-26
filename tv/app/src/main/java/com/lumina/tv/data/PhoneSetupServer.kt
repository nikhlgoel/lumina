package com.lumina.tv.data

import com.lumina.tv.core.Forms
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.security.SecureRandom
import kotlin.concurrent.thread

/**
 * A setup page for a phone or laptop, because typing a playlist link or a 70-character Google ID with a
 * TV remote is miserable and pasting it from a phone is not.
 *
 * Deliberately small and deliberately short-lived:
 * * It exists only while the "Use your phone" screen is open. Nothing listens otherwise.
 * * Every action needs the 4-digit PIN shown on the TV, so someone else on the same Wi-Fi cannot add things.
 *   Five wrong PINs and it stops answering until the screen is reopened (10,000 PINs, 5 tries).
 * * It understands exactly three requests, bounds the size of everything it reads, and times out slow clients.
 * * It only does two things: add a playlist link, and store the person's own Google client ID and secret.
 *   It cannot read the library, the tokens, or anything else.
 *
 * The connection is plain HTTP on the local network. That is acceptable for a PIN and a playlist link;
 * it is *why* the page never offers to send back a password or a token.
 */
class PhoneSetupServer(
    private val actions: Actions,
    private val hostProvider: () -> String? = ::lanAddress,
) {
    interface Actions {
        /**
         * Add a playlist link to the person's playlists; returns a sentence for the person to read. Adding saves it for
         * streaming; [alsoDownload] additionally copies its songs onto the TV.
         */
        suspend fun addPlaylist(link: String, alsoDownload: Boolean): String

        /** Store the Google client ID and secret; returns a sentence for the person to read. */
        fun saveGoogle(clientId: String, clientSecret: String): String

        fun googleConfigured(): Boolean
    }

    /** Where to point a browser, and the PIN to type. */
    data class Running(val url: String, val pin: String)

    @Volatile private var server: ServerSocket? = null
    @Volatile private var pin = ""
    @Volatile private var failures = 0
    @Volatile private var info: Running? = null

    /** Start listening, or return the existing address. Null when there is no network or no free port. */
    @Synchronized
    fun start(): Running? {
        info?.let { return it }
        val host = hostProvider() ?: return null
        val socket = (PORTS).firstNotNullOfOrNull { port ->
            runCatching { ServerSocket(port, BACKLOG, InetAddress.getByName("0.0.0.0")) }.getOrNull()
        } ?: return null
        server = socket
        pin = "%04d".format(SecureRandom().nextInt(10_000))
        failures = 0
        val running = Running("http://$host:${socket.localPort}/", pin)
        info = running
        thread(isDaemon = true, name = "phone-setup") {
            while (!socket.isClosed) {
                val client = try { socket.accept() } catch (e: Exception) { break }
                // One short request at a time. Slow or hostile clients are cut off by the read timeout.
                try { handle(client) } catch (e: Exception) { /* a bad client must never take the server down */ } finally { runCatching { client.close() } }
            }
        }
        return running
    }

    @Synchronized
    fun stop() {
        runCatching { server?.close() }
        server = null
        info = null
        pin = ""
    }

    val isRunning: Boolean get() = info != null

    private fun handle(client: Socket) {
        client.soTimeout = READ_TIMEOUT_MS
        val input = client.getInputStream()
        val requestLine = readLine(input) ?: return
        val parts = requestLine.split(' ')
        if (parts.size < 2) return respond(client, 400, "Bad request.")
        val method = parts[0]
        val target = parts[1]

        var contentLength = 0
        while (true) {
            val header = readLine(input) ?: return
            if (header.isEmpty()) break
            if (header.startsWith("content-length:", ignoreCase = true)) contentLength = header.substringAfter(':').trim().toIntOrNull() ?: -1
        }
        if (contentLength < 0 || contentLength > MAX_BODY) return respond(client, 413, "Too much data.")
        val body = if (contentLength > 0) String(readExactly(input, contentLength), Charsets.UTF_8) else ""

        if (failures >= MAX_FAILURES) return respond(client, 429, "Too many wrong PINs. Close and reopen this screen on the TV to try again.")
        val path = target.substringBefore('?')

        when {
            method == "GET" && path == "/" -> {
                val prefill = Forms.parse(target.substringAfter('?', "")).get("k").orEmpty()
                respond(client, 200, page(prefill, null))
            }
            method == "POST" && (path == "/playlist" || path == "/google") -> {
                val form = Forms.parse(body)
                if (!Forms.constantTimeEquals(form["k"].orEmpty(), pin)) {
                    failures++
                    return respond(client, 403, page("", "That PIN is wrong. Look at the TV for the 4 digits."))
                }
                val message = when (path) {
                    "/playlist" -> runBlocking { withTimeout(ACTION_TIMEOUT_MS) { actions.addPlaylist(form["link"].orEmpty(), form.containsKey("download")) } }
                    else -> actions.saveGoogle(form["client_id"].orEmpty(), form["client_secret"].orEmpty())
                }
                respond(client, 200, page(form["k"].orEmpty(), message))
            }
            else -> respond(client, 404, "Not found.")
        }
    }

    private fun page(pinValue: String, message: String?): String {
        val k = Forms.escapeHtml(pinValue)
        val notice = if (message == null) "" else "<p class=\"msg\">${Forms.escapeHtml(message)}</p>"
        val googleState = if (actions.googleConfigured()) "Saved on the TV. Paste again only to replace it." else "Not set up yet."
        return """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lumina TV setup</title>
<style>
body{margin:0;background:#0b0a10;color:#f3f1f8;font:17px/1.5 system-ui,Segoe UI,Roboto,sans-serif}
main{max-width:560px;margin:0 auto;padding:28px 20px 60px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:18px;margin:30px 0 6px;color:#ffd27a}
p{color:#b8b6c0;margin:6px 0 12px}label{display:block;margin:12px 0 4px;font-weight:600}
input{width:100%;box-sizing:border-box;padding:13px;border-radius:10px;border:1px solid #3a3648;background:#16141f;color:#f3f1f8;font-size:16px}
button{margin-top:14px;padding:13px 22px;border:0;border-radius:10px;background:#f59a4e;color:#0b0a10;font-weight:700;font-size:16px}
.msg{background:#221e2e;border-left:4px solid #ffd27a;padding:12px 14px;border-radius:8px;color:#f3f1f8}
small{color:#8d8a98}
</style></head><body><main>
<h1>Lumina TV setup</h1><p>Type the 4-digit PIN from your TV, then use either form.</p>
$notice
<label for="k0">PIN shown on the TV</label>
<form method="post" action="/playlist"><input id="k0" name="k" inputmode="numeric" maxlength="4" value="$k" autocomplete="off" required>
<h2>Add a playlist</h2><p>Paste a YouTube or YouTube Music playlist link. It is added to your playlists on the TV with its cover and songs, ready to play.</p>
<label for="link">Playlist link</label><input id="link" name="link" type="text" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="https://www.youtube.com/playlist?list=..." required>
<label style="font-weight:400;margin-top:14px"><input type="checkbox" name="download" style="width:auto;margin-right:8px">Also keep every song on the TV (uses storage)</label>
<button type="submit">Add playlist</button></form>
<form method="post" action="/google"><input type="hidden" name="k" value="$k">
<h2>Google sign-in details</h2><p>Only needed to see your <b>private</b> playlists and Liked videos. $googleState</p>
<label for="cid">Client ID</label><input id="cid" name="client_id" autocomplete="off" required>
<label for="cs">Client secret</label><input id="cs" name="client_secret" autocomplete="off" required>
<button type="submit">Save</button><p><small>Create them once in Google Cloud: an OAuth client of type "TVs and Limited Input devices", with the YouTube Data API v3 enabled.</small></p></form>
<script>document.querySelectorAll('form').forEach(function(f){f.addEventListener('submit',function(){var k=document.getElementById('k0').value;f.querySelectorAll('input[name=k]').forEach(function(i){i.value=k});});});</script>
</main></body></html>"""
    }

    private fun respond(client: Socket, code: Int, body: String) {
        val isHtml = body.trimStart().startsWith("<!doctype")
        val bytes = body.toByteArray(Charsets.UTF_8)
        val reason = when (code) { 200 -> "OK"; 400 -> "Bad Request"; 403 -> "Forbidden"; 404 -> "Not Found"; 413 -> "Payload Too Large"; 429 -> "Too Many Requests"; else -> "Error" }
        val head = "HTTP/1.1 $code $reason\r\nContent-Type: ${if (isHtml) "text/html" else "text/plain"}; charset=utf-8\r\n" +
            "Content-Length: ${bytes.size}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n"
        client.getOutputStream().apply { write(head.toByteArray(Charsets.US_ASCII)); write(bytes); flush() }
    }

    private fun readLine(input: InputStream): String? {
        val out = ByteArrayOutputStream()
        while (out.size() < MAX_LINE) {
            val b = input.read()
            if (b < 0) return if (out.size() == 0) null else out.toString(Charsets.ISO_8859_1.name())
            if (b == '\n'.code) return out.toString(Charsets.ISO_8859_1.name()).trimEnd('\r')
            out.write(b)
        }
        return null
    }

    private fun readExactly(input: InputStream, n: Int): ByteArray {
        val buf = ByteArray(n)
        var read = 0
        while (read < n) {
            val r = input.read(buf, read, n - read)
            if (r < 0) break
            read += r
        }
        return buf.copyOf(read)
    }

    companion object {
        private val PORTS = 8765..8775
        private const val BACKLOG = 4
        private const val READ_TIMEOUT_MS = 4000
        private const val ACTION_TIMEOUT_MS = 30_000L
        private const val MAX_BODY = 16 * 1024
        private const val MAX_LINE = 8 * 1024
        private const val MAX_FAILURES = 5

        /** This device's address on the local network, or null when it has none (Wi-Fi off). */
        fun lanAddress(): String? = runCatching {
            NetworkInterface.getNetworkInterfaces().toList()
                .filter { it.isUp && !it.isLoopback && !it.isVirtual }
                .flatMap { it.inetAddresses.toList() }
                .filterIsInstance<Inet4Address>()
                .firstOrNull { it.isSiteLocalAddress }?.hostAddress
        }.getOrNull()
    }
}
