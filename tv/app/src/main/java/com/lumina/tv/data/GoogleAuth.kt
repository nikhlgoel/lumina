package com.lumina.tv.data

import android.content.SharedPreferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.IOException

/**
 * Signing in with a Google account on a TV, the way Google documents it for devices with no keyboard
 * and no browser: the TV shows a short code, the person types it at google.com/device on their phone,
 * and the TV polls until they approve. The password and 2-step check happen on Google's own page —
 * this app never sees them, and cannot: Google refuses sign-in inside an embedded browser anyway.
 *
 * Read-only on purpose. The one scope asked for, `youtube.readonly`, lets the app list the person's
 * playlists and what is in them; it cannot change or delete anything on their account.
 *
 * It needs an OAuth client of type "TVs and Limited Input devices" from the person's own Google Cloud
 * project (free, about ten minutes, steps in the app). That is deliberate: borrowing another app's
 * client id would impersonate it, and would put this person's account at the mercy of that app's quota.
 */
class GoogleAuth(
    private val http: OkHttpClient,
    private val prefs: SharedPreferences,
    private val deviceCodeUrl: String = DEVICE_CODE_URL,
    private val tokenUrl: String = TOKEN_URL,
    private val now: () -> Long = System::currentTimeMillis,
    private val sleep: suspend (Long) -> Unit = { delay(it) },
) {
    data class Credentials(val clientId: String, val clientSecret: String)

    data class DeviceCode(
        val deviceCode: String,
        val userCode: String,
        val verificationUrl: String,
        val expiresInSec: Int,
        val intervalSec: Int,
    )

    /** Something went wrong with sign-in, and [message] is fit to show on the TV. */
    class AuthException(message: String, val code: String? = null) : IOException(message)

    private val refreshLock = Mutex()

    var credentials: Credentials?
        get() {
            val id = prefs.getString(KEY_CLIENT_ID, null)?.takeIf { it.isNotBlank() }
            val secret = prefs.getString(KEY_CLIENT_SECRET, null)?.takeIf { it.isNotBlank() }
            return if (id != null && secret != null) Credentials(id, secret) else null
        }
        set(value) {
            prefs.edit().apply {
                if (value == null) { remove(KEY_CLIENT_ID); remove(KEY_CLIENT_SECRET) } else {
                    putString(KEY_CLIENT_ID, value.clientId.trim()); putString(KEY_CLIENT_SECRET, value.clientSecret.trim())
                }
            }.apply()
        }

    val signedIn: Boolean get() = !prefs.getString(KEY_REFRESH, null).isNullOrBlank()

    /** Step 1: ask Google for a code to show the person. */
    suspend fun requestCode(): DeviceCode = withContext(Dispatchers.IO) {
        val c = credentials ?: throw AuthException("Google access isn't set up yet.", "no_credentials")
        val body = FormBody.Builder().add("client_id", c.clientId).add("scope", SCOPE).build()
        val json = post(deviceCodeUrl, body)
        json.optString("error").takeIf { it.isNotEmpty() }?.let { throw AuthException(explain(it, json.optString("error_description")), it) }
        DeviceCode(
            deviceCode = json.getString("device_code"),
            userCode = json.getString("user_code"),
            verificationUrl = json.optString("verification_url", json.optString("verification_uri", "https://www.google.com/device")),
            expiresInSec = json.optInt("expires_in", 1800),
            intervalSec = json.optInt("interval", 5),
        )
    }

    /**
     * Step 2: wait for the person to approve on their phone. Polls no faster than Google asks, backs off
     * when told to, and gives up when the code expires or the person says no.
     */
    suspend fun awaitApproval(code: DeviceCode) {
        val c = credentials ?: throw AuthException("Google access isn't set up yet.", "no_credentials")
        var interval = code.intervalSec.coerceAtLeast(MIN_INTERVAL_SEC)
        val deadline = now() + code.expiresInSec * 1000L
        while (now() < deadline) {
            sleep(interval * 1000L)
            val json = withContext(Dispatchers.IO) {
                post(
                    tokenUrl,
                    FormBody.Builder()
                        .add("client_id", c.clientId).add("client_secret", c.clientSecret)
                        .add("device_code", code.deviceCode).add("grant_type", GRANT_DEVICE).build(),
                )
            }
            when (val error = json.optString("error")) {
                "" -> { storeTokens(json); return }
                "authorization_pending" -> Unit
                "slow_down" -> interval += 5
                else -> throw AuthException(explain(error, json.optString("error_description")), error)
            }
        }
        throw AuthException("The code expired before it was entered. Start again.", "expired_token")
    }

    /** A usable access token, refreshed if it is about to run out. Throws if nobody is signed in. */
    suspend fun accessToken(): String = refreshLock.withLock {
        val token = prefs.getString(KEY_ACCESS, null)
        if (token != null && now() < prefs.getLong(KEY_EXPIRES, 0) - EXPIRY_SLACK_MS) return token

        val refresh = prefs.getString(KEY_REFRESH, null) ?: throw AuthException("Not signed in.", "not_signed_in")
        val c = credentials ?: throw AuthException("Google access isn't set up yet.", "no_credentials")
        val json = withContext(Dispatchers.IO) {
            post(
                tokenUrl,
                FormBody.Builder()
                    .add("client_id", c.clientId).add("client_secret", c.clientSecret)
                    .add("refresh_token", refresh).add("grant_type", "refresh_token").build(),
            )
        }
        val error = json.optString("error")
        if (error.isNotEmpty()) {
            // The person revoked access (or the project changed): the stored sign-in is no use any more.
            if (error == "invalid_grant") signOut()
            throw AuthException(explain(error, json.optString("error_description")), error)
        }
        storeTokens(json)
        prefs.getString(KEY_ACCESS, null) ?: throw AuthException("Google sent no access token.", "no_token")
    }

    fun signOut() {
        prefs.edit().remove(KEY_ACCESS).remove(KEY_REFRESH).remove(KEY_EXPIRES).apply()
    }

    private fun storeTokens(json: JSONObject) {
        val expires = now() + json.optLong("expires_in", 3600) * 1000L
        prefs.edit().apply {
            putString(KEY_ACCESS, json.getString("access_token"))
            putLong(KEY_EXPIRES, expires)
            // A refresh response does not repeat the refresh token; keep the one already held.
            json.optString("refresh_token").takeIf { it.isNotEmpty() }?.let { putString(KEY_REFRESH, it) }
        }.apply()
    }

    private fun post(url: String, body: FormBody): JSONObject {
        http.newCall(Request.Builder().url(url).post(body).build()).execute().use { response ->
            val text = response.body?.string().orEmpty()
            // Google answers 4xx with a JSON {error: ...} that the caller needs to read, so a non-2xx is not an exception here.
            return runCatching { JSONObject(text) }.getOrElse { throw IOException("Unexpected reply from Google (HTTP ${response.code}).") }
        }
    }

    private fun explain(error: String, description: String): String = when (error) {
        "access_denied" -> "Sign-in was declined on the phone."
        "expired_token" -> "The code expired before it was entered. Start again."
        "invalid_client" -> "Google doesn't recognise this Client ID. It must be a \"TVs and Limited Input devices\" client, and the ID and secret must belong together."
        "invalid_grant" -> "That sign-in is no longer valid. Sign in again."
        "org_internal" -> "That Google Cloud project only allows people from its own organisation."
        "admin_policy_enforced" -> "A Google Workspace admin has blocked this access."
        "rate_limit_exceeded" -> "Google asked to slow down. Try again in a few minutes."
        else -> description.ifBlank { "Google said: $error" }
    }

    companion object {
        const val DEVICE_CODE_URL = "https://oauth2.googleapis.com/device/code"
        const val TOKEN_URL = "https://oauth2.googleapis.com/token"
        const val SCOPE = "https://www.googleapis.com/auth/youtube.readonly"
        private const val GRANT_DEVICE = "urn:ietf:params:oauth:grant-type:device_code"
        private const val MIN_INTERVAL_SEC = 5
        private const val EXPIRY_SLACK_MS = 60_000L
        private const val KEY_CLIENT_ID = "clientId"
        private const val KEY_CLIENT_SECRET = "clientSecret"
        private const val KEY_ACCESS = "accessToken"
        private const val KEY_REFRESH = "refreshToken"
        private const val KEY_EXPIRES = "expiresAtMs"
    }
}
