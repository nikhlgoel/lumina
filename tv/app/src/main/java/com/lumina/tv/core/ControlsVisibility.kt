package com.lumina.tv.core

/**
 * When a video's controls get out of the way. The rule of the PC player (`idleControls.ts`) and of
 * YouTube and Netflix: while a video plays they fade after a few seconds of stillness, come back on
 * any remote button, and never hide while paused or while a menu is open.
 */
object ControlsVisibility {
    const val IDLE_MS = 3000L

    fun hidden(idle: Boolean, playing: Boolean, menuOpen: Boolean): Boolean = idle && playing && !menuOpen
}
