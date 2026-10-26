package com.lumina.tv.core

import kotlin.random.Random

/** Builds the queue for the Shuffle button out of several lists of candidates. */
object ShuffleMix {
    /**
     * Each group is shuffled, repeats across groups are dropped (the first group to have a song keeps it), and the
     * groups are then taken in turn, so the first songs you hear come from every group and not all from one.
     * [random] is injected so the order is testable.
     */
    fun <T> mix(groups: List<List<T>>, key: (T) -> String, random: Random = Random.Default): List<T> {
        val seen = HashSet<String>()
        val shuffled = groups.map { group -> group.filter { seen.add(key(it)) }.shuffled(random) }
        val total = shuffled.sumOf { it.size }
        val out = ArrayList<T>(total)
        var round = 0
        while (out.size < total) {
            for (group in shuffled) if (round < group.size) out += group[round]
            round++
        }
        return out
    }
}
