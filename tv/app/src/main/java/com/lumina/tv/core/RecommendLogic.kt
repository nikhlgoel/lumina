package com.lumina.tv.core

/**
 * Turning "what YouTube lists next to the things you saved" into one calm row. Pure and generic so the
 * rules are tested without the network: which of your items seed it, and how the answers are combined.
 */
object RecommendLogic {
    const val MAX_SEEDS = 3
    const val FEED_LIMIT = 20

    /** The feed is rebuilt at most this often; the library changes slowly and every rebuild costs page fetches. */
    const val REFRESH_MS = 30L * 60 * 1000

    /**
     * Seeds are the most recently saved items, one per artist where possible, so three songs by the same
     * singer do not produce one singer's catalogue. [recentFirst] is the library, newest first.
     */
    fun <T> pickSeeds(recentFirst: List<T>, artist: (T) -> String, limit: Int = MAX_SEEDS): List<T> {
        val chosen = mutableListOf<T>()
        val seen = mutableSetOf<String>()
        for (item in recentFirst) {
            if (chosen.size == limit) break
            val key = artist(item).trim().lowercase()
            if (key.isEmpty() || seen.add(key)) chosen += item
        }
        // Not enough different artists: fill up with whatever is next, rather than showing a thinner row.
        for (item in recentFirst) {
            if (chosen.size == limit) break
            if (item !in chosen) chosen += item
        }
        return chosen
    }

    /**
     * One result list from several: taken in turn (first of each, then second of each...) so no single seed
     * dominates; anything already saved, or already shown, is dropped.
     */
    fun <T> merge(lists: List<List<T>>, id: (T) -> String, exclude: Set<String>, limit: Int = FEED_LIMIT): List<T> {
        val out = mutableListOf<T>()
        val seen = HashSet(exclude)
        var round = 0
        while (out.size < limit && lists.any { round < it.size }) {
            for (list in lists) {
                val item = list.getOrNull(round) ?: continue
                if (seen.add(id(item))) out += item
                if (out.size == limit) break
            }
            round++
        }
        return out
    }

    fun isDue(lastMs: Long, nowMs: Long): Boolean = lastMs <= 0 || nowMs - lastMs >= REFRESH_MS || nowMs < lastMs
}
