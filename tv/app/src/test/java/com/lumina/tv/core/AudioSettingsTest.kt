package com.lumina.tv.core

import com.lumina.tv.core.StreamPicker.AudioFormat
import com.lumina.tv.core.StreamPicker.AudioOption
import com.lumina.tv.core.StreamPicker.AudioQuality
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AudioSettingsTest {
    private fun opt(kbps: Int, format: AudioFormat = AudioFormat.OPUS) = AudioOption("u$kbps$format", format, kbps, "x")
    private val ladder = listOf(opt(48), opt(64), opt(128, AudioFormat.M4A), opt(160))

    @Test fun `best takes the highest bitrate`() = assertEquals(160, StreamPicker.bestAudio(ladder, AudioQuality.BEST.maxKbps)?.bitrateKbps)

    @Test fun `balanced takes the highest at or under 128`() = assertEquals(128, StreamPicker.bestAudio(ladder, AudioQuality.BALANCED.maxKbps)?.bitrateKbps)

    @Test fun `saver takes the highest at or under 64`() = assertEquals(64, StreamPicker.bestAudio(ladder, AudioQuality.SAVER.maxKbps)?.bitrateKbps)

    @Test fun `a limit below every stream still plays the smallest one`() =
        assertEquals(128, StreamPicker.bestAudio(listOf(opt(128), opt(160)), 64)?.bitrateKbps)

    @Test fun `the limit applies inside each language track`() {
        val tracks = StreamPicker.audioTracks(
            listOf(
                AudioOption("a", AudioFormat.OPUS, 160, "x", trackId = "en", label = "English", original = true),
                AudioOption("b", AudioFormat.OPUS, 64, "x", trackId = "en", label = "English", original = true),
                AudioOption("c", AudioFormat.OPUS, 160, "x", trackId = "fr", label = "French"),
            ),
            maxKbps = 64,
        )
        assertEquals(64, tracks.first { it.id == "en" }.best.bitrateKbps)
        assertEquals(160, tracks.first { it.id == "fr" }.best.bitrateKbps)
    }

    @Test fun `off asks for nothing anywhere`() {
        for (hz in listOf(60, 230, 910, 3600, 14000)) assertEquals(0, EqPresets.gainMillibels(EqPreset.OFF, hz))
    }

    @Test fun `bass boost lifts the lows and leaves the highs`() {
        assertTrue(EqPresets.gainMillibels(EqPreset.BASS, 60) > 0)
        assertEquals(0, EqPresets.gainMillibels(EqPreset.BASS, 14000))
    }

    @Test fun `no preset asks for more than six decibels`() {
        for (p in EqPreset.entries) for (hz in listOf(60, 230, 910, 3600, 14000)) assertTrue(kotlin.math.abs(EqPresets.gainMillibels(p, hz)) <= 600)
    }
}
