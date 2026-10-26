package com.lumina.tv.core

/**
 * How much memory Lumina lets itself use for things that are only there for speed (picture cache, how much video is read
 * ahead, the size of the painted backdrop), decided from the device's RAM. Nothing here changes what is shown: covers are
 * decoded at the same size, video is the same quality, and the backdrop is the same picture; only the amount held in
 * memory at once is smaller on a small stick, and anything dropped is loaded again when needed.
 *
 * A 1 GB Fire TV Stick leaves the app a small share of RAM once Fire OS has taken its own, so those caps matter most there.
 */
data class MemoryPlan(
    /** Share of the app's memory class that decoded pictures may occupy. */
    val imageCachePercent: Double,
    /** Most bytes of video the player reads ahead. */
    val bufferBytes: Int,
    /** Most seconds of media the player reads ahead. */
    val bufferMaxMs: Int,
    /** The painted page background is drawn this fraction of the screen size and stretched, which it is soft enough to allow. */
    val backdropScale: Float,
    val lowMemory: Boolean,
) {
    companion object {
        private const val LOW_TOTAL_MB = 1536
        private const val LOW_CLASS_MB = 128

        /**
         * [totalMemMb] is the device's RAM, [memoryClassMb] the heap the system allows the app, and [lowRamFlag] the
         * system's own "this is a low-RAM device" flag. Any one of the three marks a small device.
         */
        fun forDevice(totalMemMb: Int, memoryClassMb: Int, lowRamFlag: Boolean): MemoryPlan {
            val low = lowRamFlag || (totalMemMb in 1..LOW_TOTAL_MB) || (memoryClassMb in 1..LOW_CLASS_MB)
            return if (low) MemoryPlan(0.08, 20 * 1024 * 1024, 45_000, 0.67f, true)
            else MemoryPlan(0.15, 48 * 1024 * 1024, 90_000, 1f, false)
        }
    }
}
