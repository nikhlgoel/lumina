package com.lumina.tv.player

import android.content.Intent
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

/**
 * Exposes the player to the system: the remote's media keys, Alexa ("pause", "next song") and the
 * notification all reach it through the media session. While something plays it also runs as a
 * foreground service, which is what lets music continue after you leave the app.
 */
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null

    override fun onCreate() {
        super.onCreate()
        session = MediaSession.Builder(this, PlayerHolder.player).build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    /** Leaving the app with nothing playing should not leave a service behind; music playing should continue. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        val player = session?.player
        if (player == null || !player.playWhenReady || player.mediaItemCount == 0) stopSelf()
    }

    override fun onDestroy() {
        // The player outlives the service on purpose (see PlayerHolder); only the session is released.
        session?.release()
        session = null
        super.onDestroy()
    }
}
