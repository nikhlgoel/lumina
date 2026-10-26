package com.lumina.tv.data

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.lumina.tv.LuminaApp
import java.util.concurrent.TimeUnit

/**
 * Wakes up every few hours, when the network is there, and checks each synced playlist for new songs.
 * It only *starts* the downloads; the download service keeps the app alive until they finish.
 *
 * The system decides the exact moment (it batches work to save power), so "every 6 hours" means "about,
 * and not while the stick is off". Opening the app also syncs if it has been a while.
 */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val graph = (applicationContext as LuminaApp).graph
        return try {
            graph.playlistStore.load()
            graph.library.load()
            graph.playlists.syncAll()
            Result.success()
        } catch (e: Exception) {
            // Transient (no network at that moment): let the system try again later, with its own back-off.
            Result.retry()
        }
    }

    companion object {
        private const val NAME = "playlist-sync"

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<SyncWorker>(6, TimeUnit.HOURS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            // KEEP: scheduling again on every launch must not reset the clock.
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }
}

/**
 * Looks for a new version in the background and downloads it, so by the time the app is opened the update
 * is already waiting. It never installs: that needs the person's yes.
 */
class UpdateWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        (applicationContext as LuminaApp).graph.updater.check(force = false)
        // A failed check is not worth a retry storm; the next scheduled run tries again.
        return Result.success()
    }

    companion object {
        private const val NAME = "app-update"

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<UpdateWorker>(12, TimeUnit.HOURS)
                // Unmetered, so a 30 MB download never eats a mobile hotspot's data; and not on a dying battery.
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.UNMETERED).setRequiresBatteryNotLow(true).build())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }
}
