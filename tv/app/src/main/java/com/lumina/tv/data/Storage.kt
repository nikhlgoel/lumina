package com.lumina.tv.data

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.os.storage.StorageManager
import android.os.storage.StorageVolume
import com.lumina.tv.core.FileNames
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File

/**
 * Where files live. A Fire TV Stick 4K Plus has 8 GB in total and most of it is taken by the system,
 * so a USB drive in the stick is the realistic home for a real library. Each volume the system
 * exposes to this app is a [Root]; the person picks one in Settings.
 *
 * Files go in the app's own folder on that volume, which needs no storage permission. The layout
 * below it is the PC app's USB layout, `LuminaMedia/Music` and `LuminaMedia/Videos`, with the same
 * file names — so a folder copied from this app's folder to a PC (or the reverse) just works.
 */
class Storage(private val context: Context, private val settings: AppSettings) {

    data class Root(
        val id: String,
        val label: String,
        val dir: File,
        val removable: Boolean,
        val freeBytes: Long,
        val totalBytes: Long,
    )

    private val state = MutableStateFlow<List<Root>>(emptyList())

    /** The drives right now, kept current: a drive being plugged in or removed updates this by itself. */
    val rootsFlow: StateFlow<List<Root>> = state.asStateFlow()

    init {
        state.value = roots()
        // Two ways the system tells us, because neither is complete on every device: the volume callback (API 30+,
        // which is what a Fire OS 8 stick runs) and the older mount broadcasts.
        val filter = IntentFilter().apply {
            for (a in listOf(Intent.ACTION_MEDIA_MOUNTED, Intent.ACTION_MEDIA_UNMOUNTED, Intent.ACTION_MEDIA_EJECT, Intent.ACTION_MEDIA_REMOVED, Intent.ACTION_MEDIA_BAD_REMOVAL)) addAction(a)
            addDataScheme("file")
        }
        context.applicationContext.registerReceiver(object : BroadcastReceiver() {
            override fun onReceive(c: Context, i: Intent) = refresh()
        }, filter)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val manager = context.getSystemService(StorageManager::class.java)
            manager.registerStorageVolumeCallback(context.mainExecutor, object : StorageManager.StorageVolumeCallback() {
                override fun onStateChanged(volume: StorageVolume) = refresh()
            })
        }
    }

    /** Re-read the drives. Also what "Look for drives again" does, for the case where a system event is missed. */
    fun refresh() {
        val now = roots()
        if (now != state.value) state.value = now
    }

    /** Every volume that is mounted and writable right now. The first is always the built-in storage. */
    fun roots(): List<Root> {
        val dirs = context.getExternalFilesDirs(null).filterNotNull()
        val usable = dirs.filter { Environment.getExternalStorageState(it) == Environment.MEDIA_MOUNTED }
        return usable.mapIndexed { index, dir ->
            val removable = runCatching { Environment.isExternalStorageRemovable(dir) }.getOrDefault(index > 0)
            val stat = runCatching { StatFs(dir.path) }.getOrNull()
            Root(
                id = if (index == 0) AppSettings.INTERNAL else dir.path,
                label = if (index == 0) "Built-in storage" else "USB / SD drive${if (usable.size > 2) " ${index}" else ""}",
                dir = dir,
                removable = removable || index > 0,
                freeBytes = stat?.availableBytes ?: -1,
                totalBytes = stat?.totalBytes ?: -1,
            )
        }
    }

    /**
     * The chosen root, or built-in storage when it is not there: a drive that was unplugged must
     * never leave downloads with nowhere to go, nor crash on a missing folder.
     */
    fun activeRoot(): Root {
        val all = roots()
        return all.firstOrNull { it.id == settings.storageRoot } ?: all.first()
    }

    /** The folder for music or video on the active root, created on demand. */
    fun mediaDir(kind: MediaKind, root: Root = activeRoot()): File {
        val sub = if (kind == MediaKind.AUDIO) "Music" else "Videos"
        return File(root.dir, "${FileNames.PORTABLE_DIR}/$sub").also { it.mkdirs() }
    }

    /** Both media folders on every root, for finding files that were copied in by hand. */
    fun allMediaDirs(): List<File> = roots().flatMap { r ->
        listOf(MediaKind.AUDIO, MediaKind.VIDEO).map { mediaDir(it, r) }
    }

    /**
     * A destination that does not overwrite anything: the PC app's drive path for this item, with
     * " (2)", " (3)" … before the extension when the name is taken by something else.
     */
    fun destinationFor(kind: MediaKind, title: String, artist: String, extension: String, root: Root = activeRoot()): File {
        val relative = FileNames.targetFor(kind == MediaKind.AUDIO, "x.$extension", title, artist.ifBlank { null })
        val wanted = File(root.dir, relative)
        wanted.parentFile?.mkdirs()
        if (!wanted.exists()) return wanted
        val stem = wanted.name.removeSuffix(".$extension")
        var n = 2
        while (true) {
            val candidate = File(wanted.parentFile, "$stem ($n).$extension")
            if (!candidate.exists()) return candidate
            n++
        }
    }
}
