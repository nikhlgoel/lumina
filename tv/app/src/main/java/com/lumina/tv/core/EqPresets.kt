package com.lumina.tv.core

/** The equalizer choices offered in Settings. Each is a gentle shape, never a large boost: loud settings distort. */
enum class EqPreset(val label: String, val detail: String) {
    OFF("Off", "The sound exactly as it was recorded."),
    BASS("Bass boost", "A little more weight in the low notes."),
    VOCAL("Vocal", "Brings voices forward; good for talk, podcasts and soft songs."),
    TREBLE("Treble boost", "More sparkle in the high notes; helps dull speakers."),
    VSHAPE("Bass and treble", "Fuller lows and brighter highs, a touch less in the middle."),
}

object EqPresets {
    /**
     * The gain, in millibels (hundredths of a decibel), a preset asks for at a band centred on [centerHz]. The caller
     * clamps it to what the device's equalizer allows. Largest value is 6 dB.
     */
    fun gainMillibels(preset: EqPreset, centerHz: Int): Int = when (preset) {
        EqPreset.OFF -> 0
        EqPreset.BASS -> when {
            centerHz <= 100 -> 600
            centerHz <= 250 -> 450
            centerHz <= 500 -> 200
            else -> 0
        }
        EqPreset.VOCAL -> when {
            centerHz <= 150 -> -200
            centerHz < 600 -> 0
            centerHz <= 3500 -> 300
            centerHz <= 6000 -> 100
            else -> 0
        }
        EqPreset.TREBLE -> when {
            centerHz < 2000 -> 0
            centerHz < 4000 -> 200
            centerHz < 8000 -> 400
            else -> 500
        }
        EqPreset.VSHAPE -> when {
            centerHz <= 250 -> 500
            centerHz < 1000 -> -50
            centerHz < 4000 -> -100
            else -> 400
        }
    }
}
