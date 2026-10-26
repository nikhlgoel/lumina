package com.lumina.tv.core

/** What a playlist mostly holds, so Home's Music and Videos filters can show it in the right place. */
enum class PlaylistKind { MUSIC, VIDEO, MIXED }

object PlaylistKinds {
    /** YouTube's own category number for music. */
    const val MUSIC_CATEGORY = "10"

    /** Looking at this many of a playlist's first videos is enough to tell, and costs one request. */
    const val SAMPLE = 20

    /**
     * Music when most of the sampled videos are in YouTube's Music category, video when few are, mixed in between.
     * "Liked videos" is always video: it is everything you liked, music or not, and is not what a person means by
     * a music playlist. A playlist with nothing to sample is mixed, so it is never hidden for want of knowing.
     */
    fun classify(isLikes: Boolean, musicCount: Int, sampled: Int): PlaylistKind = when {
        isLikes -> PlaylistKind.VIDEO
        sampled <= 0 -> PlaylistKind.MIXED
        musicCount * 100 >= sampled * 60 -> PlaylistKind.MUSIC
        musicCount * 100 <= sampled * 25 -> PlaylistKind.VIDEO
        else -> PlaylistKind.MIXED
    }

    /** Whether a playlist of [kind] belongs under Home's filter: [music] or [videos] true picks one; both false is All. */
    fun shown(kind: PlaylistKind, music: Boolean, videos: Boolean): Boolean = when {
        music -> kind != PlaylistKind.VIDEO
        videos -> kind != PlaylistKind.MUSIC
        else -> true
    }
}
