package com.lumina.tv.download

import com.lumina.tv.core.ByteRanges
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import kotlin.coroutines.coroutineContext

/** The link stopped working (they expire within hours). The caller should resolve the item again. */
class UrlExpiredException(message: String) : IOException(message)

/** A message that is already fit to show a person, as opposed to a technical error. */
class UserMessage(message: String) : Exception(message)

/**
 * Downloads one file as a series of ranged requests, resuming from whatever is already on disk.
 *
 * It writes to `<name>.part` and renames only when every byte has arrived, so a power cut or an
 * unplugged drive can never leave a half file that looks finished. Nothing about progress is saved
 * anywhere else: the size of the `.part` file *is* the resume point.
 */
class ChunkedDownloader(private val client: OkHttpClient, private val userAgent: String) {

    /** The full size of a file, or -1 if the server will not say. One tiny ranged request. */
    suspend fun probeLength(url: String): Long = withContext(Dispatchers.IO) {
        val request = Request.Builder().url(url).header("User-Agent", userAgent).header("Range", "bytes=0-0").build()
        client.newCall(request).execute().use { response ->
            when (response.code) {
                206 -> totalFromContentRange(response.header("Content-Range")) ?: -1
                200 -> response.body?.contentLength() ?: -1
                403, 410 -> throw UrlExpiredException("HTTP ${response.code}")
                else -> -1
            }
        }
    }

    /**
     * Fetch [url] into [dest]. [onTotalKnown] is told the size once it is known (and may throw to
     * refuse, e.g. when the drive is too small); [onProgress] gets bytes done and total (-1 if unknown).
     */
    suspend fun download(
        url: String,
        dest: File,
        onTotalKnown: (Long) -> Unit,
        onProgress: (done: Long, total: Long) -> Unit,
    ) = withContext(Dispatchers.IO) {
        val part = File(dest.path + ".part")
        part.parentFile?.mkdirs()
        var total = -1L
        var failures = 0
        var finished = false

        while (!finished) {
            coroutineContext.ensureActive()
            // The file on disk is the truth about where we are, including after a chunk that failed
            // half way through: whatever it managed to write is kept and counted.
            val have = part.length()
            val range = if (total > 0) ByteRanges.next(have, total) else ByteRanges.Range(have, have + ByteRanges.DEFAULT_CHUNK - 1)
            if (range == null) {
                finished = true
                continue
            }

            try {
                val request = Request.Builder().url(url).header("User-Agent", userAgent).header("Range", range.header).build()
                client.newCall(request).execute().use { response ->
                    when (response.code) {
                        206 -> {
                            val learned = totalFromContentRange(response.header("Content-Range"))
                            if (total <= 0 && learned != null) {
                                total = learned
                                // A partial file bigger than the whole is leftover junk: begin again.
                                if (have > total) {
                                    part.delete()
                                    return@use
                                }
                                onTotalKnown(total)
                            }
                            val written = append(response, part, have, total, onProgress)
                            // With no known size, a chunk shorter than asked means the file has ended.
                            if (total <= 0 && written < range.length) finished = true
                        }
                        200 -> {
                            // The server ignored the range and is sending everything. Take it from the start.
                            part.delete()
                            val size = response.body?.contentLength() ?: -1
                            if (size > 0) {
                                total = size
                                onTotalKnown(size)
                            }
                            append(response, part, 0, size, onProgress)
                            finished = true
                        }
                        416 -> {
                            // "Range not satisfiable": we already have all of it, or the partial is wrong.
                            val whole = totalFromContentRange(response.header("Content-Range"))
                            when {
                                whole != null && have == whole -> { total = whole; finished = true }
                                // No size to compare against, but the server has nothing past what we hold.
                                whole == null && have > 0 -> finished = true
                                else -> part.delete()
                            }
                        }
                        403, 410 -> throw UrlExpiredException("HTTP ${response.code}")
                        else -> throw IOException("HTTP ${response.code}")
                    }
                }
                failures = 0
            } catch (e: UrlExpiredException) {
                throw e
            } catch (e: IOException) {
                // Network hiccup. Back off and carry on from the bytes already on disk, a few times.
                if (++failures > MAX_FAILURES) throw e
                delay(1000L * failures)
            }
        }

        if (total > 0 && part.length() != total) throw IOException("Download incomplete: ${part.length()} of $total bytes")
        if (dest.exists()) dest.delete()
        if (!part.renameTo(dest)) throw IOException("Could not move the finished file into place")
    }

    /** Appends the body to [part] and returns how many bytes this call wrote. */
    private suspend fun append(response: Response, part: File, startAt: Long, total: Long, onProgress: (Long, Long) -> Unit): Long {
        val body = response.body ?: throw IOException("Empty response")
        var done = startAt
        FileOutputStream(part, startAt > 0).use { out ->
            val buffer = ByteArray(64 * 1024)
            body.byteStream().use { input ->
                while (true) {
                    coroutineContext.ensureActive()
                    val read = input.read(buffer)
                    if (read < 0) break
                    out.write(buffer, 0, read)
                    done += read
                    onProgress(done, total)
                }
            }
        }
        return done - startAt
    }

    companion object {
        private const val MAX_FAILURES = 5

        /** `bytes 0-4194303/12345678` → 12345678; null for `*` (unknown) or junk. */
        fun totalFromContentRange(header: String?): Long? =
            header?.substringAfterLast('/')?.trim()?.toLongOrNull()?.takeIf { it > 0 }
    }
}
