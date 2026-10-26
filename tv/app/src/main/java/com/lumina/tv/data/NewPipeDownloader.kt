package com.lumina.tv.data

import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Request
import org.schabi.newpipe.extractor.downloader.Response
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException
import java.io.IOException

/**
 * The HTTP layer the extractor library asks the host app to supply. It does no scraping itself; it
 * only carries requests the library builds. Plain OkHttp — nothing here hides who is asking: the
 * requests identify as an ordinary browser, as any client of these sites does.
 */
class NewPipeDownloader(private val client: OkHttpClient) : Downloader() {

    @Throws(IOException::class, ReCaptchaException::class)
    override fun execute(request: Request): Response {
        val builder = okhttp3.Request.Builder().url(request.url()).header("User-Agent", USER_AGENT)

        val body = request.dataToSend()
        when (val method = request.httpMethod()) {
            "GET" -> builder.get()
            "HEAD" -> builder.head()
            // OkHttp refuses a POST with no body, so an absent one becomes an empty one.
            else -> builder.method(method, (body ?: ByteArray(0)).toRequestBody())
        }

        for ((name, values) in request.headers()) {
            builder.removeHeader(name)
            for (value in values) builder.addHeader(name, value)
        }

        client.newCall(builder.build()).execute().use { response ->
            // The site is asking for a human check. Surfacing it as-is lets the UI say so plainly
            // instead of failing in some confusing way further down.
            if (response.code == 429) throw ReCaptchaException("The site asked for a human check", request.url())
            val text = response.body?.string().orEmpty()
            return Response(response.code, response.message, response.headers.toMultimap(), text, response.request.url.toString())
        }
    }

    companion object {
        const val USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0"
    }
}
