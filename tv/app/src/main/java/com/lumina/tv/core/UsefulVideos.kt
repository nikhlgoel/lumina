package com.lumina.tv.core

/**
 * Choosing videos worth a young person's time: tech, programming, AI, study, career and money skills, learned from what has
 * actually been watched on this device. Pure and generic (nothing here knows about the network or the player), so the rules are
 * tested without either.
 *
 * Three jobs:
 *  - [score]: how useful a title and channel look (learning words up, entertainment and clips down);
 *  - [interestQueries]: what to search for next, taken from the tech and learning videos already watched (entertainment that was
 *    watched does not steer it);
 *  - [curated]: a few evergreen topics, rotated by day, so there is something good to show before anything has been watched.
 */
object UsefulVideos {
    /** Single words, matched as whole words. */
    private val GOOD_WORDS = setOf(
        "tutorial", "course", "explained", "learn", "learning", "beginner", "beginners", "guide", "roadmap", "tips", "project", "projects",
        "programming", "coding", "developer", "developers", "software", "engineer", "engineering", "python", "javascript", "typescript",
        "kotlin", "java", "rust", "golang", "react", "android", "linux", "git", "github", "docker", "kubernetes", "api", "database", "sql",
        "algorithm", "algorithms", "computer", "science", "ai", "chatgpt", "llm", "llms", "cybersecurity", "hacking", "networking", "cloud", "aws",
        "startup", "startups", "founder", "entrepreneur", "productivity", "study", "career", "interview", "resume", "internship",
        "freelancing", "skills", "tech", "hardware", "electronics", "arduino", "raspberry", "robotics", "math", "physics", "finance", "investing",
        "automation", "opensource", "devops", "frontend", "backend", "fullstack", "ml",
    )

    /** Phrases, matched anywhere in the lowercased text. */
    private val GOOD_PHRASES = listOf(
        "how to", "how it works", "system design", "data structure", "machine learning", "deep learning", "side hustle", "open source",
        "for beginners", "crash course", "from scratch", "step by step",
    )

    private val BAD_PHRASES = listOf(
        "#shorts", "shorts", "prank", "reaction", "roast", "comedy", "full episode", "full movie", "trailer", "lyrics", "mashup", "remix",
        "asmr", "gossip", "viral", "status video", "whatsapp status", "serial", "bigg boss", "reels", "tiktok", "challenge",
    )

    /** Words too common to be a topic. */
    private val STOP = setOf("with", "this", "that", "from", "your", "what", "when", "will", "have", "just", "into", "about", "best", "video", "full", "free")

    /** Words that mark learning content but are not a topic on their own ("tutorial tutorial"). */
    private val GENERIC = setOf(
        "tutorial", "course", "explained", "learn", "learning", "beginner", "beginners", "guide", "tips", "project", "projects", "skills",
        "tech", "computer", "science", "software", "engineer", "engineering", "developer", "developers", "programming", "coding", "career",
    )

    /** Videos at or under this length are clips (Shorts), not something to learn from. */
    private const val CLIP_SECONDS = 60L

    private val TECH = listOf(
        "programming tutorial for beginners",
        "how AI actually works explained",
        "cybersecurity basics explained",
        "system design explained",
        "developer productivity tips",
        "build a project from scratch coding",
        "linux tips for developers",
        "tech news this week explained",
        "computer science explained simply",
        "best free tools for developers",
        "career advice for software engineers",
        "electronics and hardware explained",
    )

    private val LIFE = listOf(
        "startup advice for founders",
        "how to study faster and remember more",
        "how to build good habits and stay focused",
        "personal finance for young people",
    )

    private fun words(text: String): List<String> = text.lowercase().split(Regex("[^a-z0-9+#]+")).filter { it.isNotEmpty() }

    /** How useful a video looks from its title and channel: positive for learning and tech, negative for clips and entertainment. */
    fun score(title: String, channel: String = ""): Int {
        val text = "$title $channel".lowercase()
        val tokens = words(text).toSet()
        val good = tokens.count { it in GOOD_WORDS } + GOOD_PHRASES.count { it in text }
        val bad = BAD_PHRASES.count { it in text }
        return minOf(good, 4) * 3 - bad * 4
    }

    /**
     * Search queries for what to watch next, from the videos already watched ([watched] is title to channel, newest first).
     * Only videos that scored as useful count, and the most frequent topic words among them become "<word> tutorial", so a night of
     * entertainment does not turn the row into more entertainment. Empty when nothing useful has been watched yet.
     */
    fun interestQueries(watched: List<Pair<String, String>>, limit: Int = 2): List<String> {
        val counts = LinkedHashMap<String, Int>()
        for ((title, channel) in watched.take(60)) {
            if (score(title, channel) <= 0) continue
            for (w in words("$title $channel").toSet()) {
                if (w in GOOD_WORDS && w !in STOP && w.length >= 2 && w !in GENERIC) counts.merge(w, 1, Int::plus)
            }
        }
        return counts.entries.sortedByDescending { it.value }.take(limit).map { "${it.key} tutorial" }
    }

    /**
     * [count] evergreen topics for [day] (days since 1970), a different few each day. The first is always a tech topic; the second is
     * another tech one on even days and a study, habits or money one on odd days, so tech leads without it being the only thing.
     */
    fun curated(day: Int, count: Int = 2): List<String> {
        val t = Math.floorMod(day, TECH.size)
        val out = mutableListOf(TECH[t])
        if (count > 1) out += if (day % 2 == 0) TECH[(t + 5) % TECH.size] else LIFE[Math.floorMod(day, LIFE.size)]
        if (count > 2) out += TECH[(t + 2) % TECH.size]
        return out.distinct().take(count)
    }

    /**
     * Orders candidates by usefulness (stable: ties keep their order), drops clips, and puts entertainment last. When fewer than
     * [minGood] useful ones exist the rest is appended, so the row is never empty just because nothing scored.
     */
    fun <T> rank(items: List<T>, title: (T) -> String, channel: (T) -> String, seconds: (T) -> Long, limit: Int, minGood: Int = 8): List<T> {
        val kept = items.filterNot { seconds(it) in 1..CLIP_SECONDS }
        val scored = kept.mapIndexed { i, t -> Triple(t, score(title(t), channel(t)), i) }
        val good = scored.filter { it.second > 0 }.sortedWith(compareByDescending<Triple<T, Int, Int>> { it.second }.thenBy { it.third })
        val rest = scored.filter { it.second <= 0 && it.second > -4 }.sortedBy { it.third }
        val out = good.map { it.first }.toMutableList()
        if (out.size < minGood) out += rest.map { it.first }
        return out.take(limit)
    }
}
