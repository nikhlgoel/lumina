package com.lumina.tv.download

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.lumina.tv.LuminaApp
import com.lumina.tv.R
import com.lumina.tv.core.Formatting
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Keeps the process alive while downloads run, so they carry on when you go back to the home screen
 * or the TV dims. Android insists on a notification for that; on a television it is mostly invisible.
 * The service stops itself the moment nothing is left to do.
 */
class DownloadService : Service() {
    private var scope: CoroutineScope? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
        // Must be called promptly after being started as a foreground service, or Android kills the app.
        startForeground(NOTIFICATION_ID, notification("Preparing downloads…", 0, 0, true))

        val manager = (application as LuminaApp).graph.downloads
        val s = CoroutineScope(SupervisorJob() + Dispatchers.Main)
        scope = s
        s.launch {
            manager.jobs.collect { jobs ->
                val active = jobs.filter { it.active }
                if (active.isEmpty()) {
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    stopSelf()
                    return@collect
                }
                val first = active.first()
                val speed = active.sumOf { it.speedBps }
                val text = buildString {
                    append(if (active.size == 1) first.track.title else "${active.size} downloads")
                    if (speed > 0) append(" · ${Formatting.speed(speed)}")
                }
                val percent = (first.fraction * 100).toInt()
                notify(notification(text, percent, 100, first.total <= 0))
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int) = START_NOT_STICKY

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        scope?.cancel()
        super.onDestroy()
    }

    private fun notification(text: String, progress: Int, max: Int, indeterminate: Boolean): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(text)
            .setProgress(max, progress, indeterminate)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

    private fun notify(n: Notification) {
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(NOTIFICATION_ID, n)
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(CHANNEL_ID, getString(R.string.channel_downloads), NotificationManager.IMPORTANCE_LOW)
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
    }

    companion object {
        private const val CHANNEL_ID = "downloads"
        private const val NOTIFICATION_ID = 41

        fun start(context: Context) {
            ContextCompat.startForegroundService(context, Intent(context, DownloadService::class.java))
        }
    }
}
