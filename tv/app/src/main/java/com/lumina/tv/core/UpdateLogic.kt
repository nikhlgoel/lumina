package com.lumina.tv.core

import org.json.JSONArray
import org.json.JSONException

/**
 * Deciding whether a GitHub release is an update for this app. Pure, so every rule is tested.
 *
 * The TV app and the PC app share a repository but not a version number, and a release may carry only
 * one of them. So the version is read from the APK's own file name (`lumina-tv-0.2.0.apk`), not from the
 * release tag, and the *list* of recent releases is searched, not only the newest.
 */
object UpdateLogic {
    const val REPO = "nikhlgoel/lumina"

    /** Only files published by this repository's releases are ever downloaded. */
    const val DOWNLOAD_PREFIX = "https://github.com/$REPO/releases/download/"

    /** A sanity cap: this app is ~30 MB, so anything near this is not it. */
    const val MAX_APK_BYTES = 150L * 1024 * 1024

    private val assetName = Regex("^lumina[-_]?tv[-_].*?(\\d+(?:\\.\\d+)*).*\\.apk$", RegexOption.IGNORE_CASE)
    private val hex64 = Regex("^[0-9a-f]{64}$")

    data class Candidate(
        val version: String,
        val apkUrl: String,
        val sizeBytes: Long,
        /** Lower-case hex, when GitHub supplied a digest for the asset. */
        val sha256: String?,
        val notes: String,
    )

    /** Dotted numbers, compared part by part with missing parts as 0 (so 1.2 == 1.2.0). */
    fun compare(a: String, b: String): Int {
        val pa = parts(a)
        val pb = parts(b)
        for (i in 0 until maxOf(pa.size, pb.size)) {
            val c = pa.getOrElse(i) { 0 }.compareTo(pb.getOrElse(i) { 0 })
            if (c != 0) return c
        }
        return 0
    }

    private fun parts(v: String): List<Int> =
        v.trim().removePrefix("v").removePrefix("V").substringBefore('-').substringBefore('+')
            .split('.').map { it.toIntOrNull() ?: 0 }

    /**
     * The newest installable update from a list of releases, or null. Drafts and pre-releases are ignored,
     * as is anything that is not a `lumina-tv` APK from this repository, over the size cap, or not newer.
     */
    fun pick(releasesJson: String, currentVersion: String): Candidate? {
        val releases = try {
            JSONArray(releasesJson)
        } catch (e: JSONException) {
            return null
        }
        var best: Candidate? = null
        for (i in 0 until releases.length()) {
            val release = releases.optJSONObject(i) ?: continue
            if (release.optBoolean("draft") || release.optBoolean("prerelease")) continue
            val assets = release.optJSONArray("assets") ?: continue
            for (j in 0 until assets.length()) {
                val asset = assets.optJSONObject(j) ?: continue
                val name = asset.optString("name")
                if (name.contains("debug", ignoreCase = true)) continue
                val version = assetName.matchEntire(name)?.groupValues?.get(1) ?: continue
                val url = asset.optString("browser_download_url")
                val size = asset.optLong("size", -1)
                if (!url.startsWith(DOWNLOAD_PREFIX) || size <= 0 || size > MAX_APK_BYTES) continue
                if (compare(version, currentVersion) <= 0) continue
                if (best != null && compare(version, best.version) <= 0) continue
                val digest = asset.optString("digest").removePrefix("sha256:").lowercase().takeIf { hex64.matches(it) }
                best = Candidate(version, url, size, digest, release.optString("body").take(600))
            }
        }
        return best
    }

    /** Check at most this often: a couple of GitHub calls a day is polite, and nobody needs minute-level freshness. */
    const val CHECK_EVERY_MS = 12L * 60 * 60 * 1000

    /** Also due when the clock has gone backwards, so a wrong date cannot silence checks for years. */
    fun isDue(lastCheckMs: Long, nowMs: Long): Boolean =
        lastCheckMs <= 0 || nowMs - lastCheckMs >= CHECK_EVERY_MS || nowMs < lastCheckMs
}
