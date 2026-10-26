package com.lumina.tv.core

/**
 * Splitting a download into ranged requests.
 *
 * Streaming hosts throttle a single long request but serve many short ranged ones at full speed, so
 * a file is fetched as a series of chunks. Because each chunk is independent, a download that was
 * interrupted resumes from the size of the partial file on disk — no state needs saving.
 */
object ByteRanges {
    /** Big enough to amortise a request, small enough that a stall wastes little. */
    const val DEFAULT_CHUNK = 4L * 1024 * 1024

    /** An inclusive byte range, as HTTP `Range: bytes=start-end` means it. */
    data class Range(val start: Long, val endInclusive: Long) {
        val length: Long get() = endInclusive - start + 1
        val header: String get() = "bytes=$start-$endInclusive"
    }

    /**
     * The next range to fetch when `have` bytes of `total` are already on disk, or null when the
     * file is complete. An unknown total (<= 0) is not rangeable and yields null — the caller must
     * fall back to one plain request.
     */
    fun next(have: Long, total: Long, chunk: Long = DEFAULT_CHUNK): Range? {
        if (total <= 0 || have < 0 || have >= total || chunk <= 0) return null
        return Range(have, minOf(have + chunk, total) - 1)
    }

    /** The first byte to ask for when resuming. A partial file longer than the whole is corrupt, so restart. */
    fun resumeFrom(partialLength: Long, total: Long): Long = when {
        partialLength <= 0 -> 0
        total > 0 && partialLength > total -> 0
        else -> partialLength
    }
}
