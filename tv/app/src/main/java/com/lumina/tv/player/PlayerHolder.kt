package com.lumina.tv.player

import android.content.Context
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.audio.DefaultAudioTrackBufferSizeProvider
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import com.lumina.tv.core.EqPreset
import com.lumina.tv.core.EqPresets
import com.lumina.tv.data.AppSettings
import com.lumina.tv.data.NewPipeDownloader
import okhttp3.OkHttpClient

/**
 * The one player for the whole app. The screen, the media session and the notification all share it,
 * so music keeps playing when the screen changes and the remote's play/pause key reaches whatever is
 * playing. It must be created before anything asks for it ([init], from the app's start-up).
 */
object PlayerHolder {
    private var instance: ExoPlayer? = null
    private var factory: DataSource.Factory? = null

    val player: ExoPlayer get() = checkNotNull(instance) { "PlayerHolder.init was never called" }
    val dataSourceFactory: DataSource.Factory get() = checkNotNull(factory) { "PlayerHolder.init was never called" }

    @Synchronized
    fun init(context: Context, client: OkHttpClient) {
        if (instance != null) return
        val app = context.applicationContext
        // Media requests give up on a dead connection after 8 s to connect and 12 s without data (the app-wide 15 s and 30 s are
        // for pages and downloads), so a stall recovers (ExoPlayer retries by itself) in seconds, not half a minute. It is
        // the same client underneath, so connections are shared.
        val mediaClient = client.newBuilder().connectTimeout(8, java.util.concurrent.TimeUnit.SECONDS).readTimeout(12, java.util.concurrent.TimeUnit.SECONDS).build()
        val http = DefaultDataSource.Factory(app, OkHttpDataSource.Factory(mediaClient).setUserAgent(NewPipeDownloader.USER_AGENT))
        factory = http
        settings = AppSettings(app)
        instance = ExoPlayer.Builder(app, renderers(app, settings!!.audioBufferLarge))
            .setMediaSourceFactory(DefaultMediaSourceFactory(http))
            .setLoadControl(loadControl((app as? com.lumina.tv.LuminaApp)?.memoryPlan ?: com.lumina.tv.core.MemoryPlan.forDevice(0, 0, false)))
            // Handles audio focus for us: pauses for a call or another app, and resumes afterwards.
            .setAudioAttributes(attributes(video = false), true)
            // Pause when headphones are pulled or an HDMI/optical output disappears, instead of blasting the speakers.
            .setHandleAudioBecomingNoisy(true)
            // Keep Wi-Fi and the CPU awake while playing a stream with the screen off.
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()
            .also { player ->
                // Every time the speaker ran out of sound to play (what is heard as a stutter or crackle) is logged, so
                // a claim of "smooth" can be checked with `adb logcat -s LuminaAudio` instead of by ear.
                // The equalizer belongs to one audio session; a new session (a new kind of output) needs it attached again.
                player.addListener(object : androidx.media3.common.Player.Listener {
                    override fun onAudioSessionIdChanged(audioSessionId: Int) { applyEqualizer(settings?.equalizer ?: EqPreset.OFF) }
                })
                player.addAnalyticsListener(object : androidx.media3.exoplayer.analytics.AnalyticsListener {
                    override fun onAudioSinkError(eventTime: androidx.media3.exoplayer.analytics.AnalyticsListener.EventTime, audioSinkError: Exception) {
                        android.util.Log.w("LuminaAudio", "SINK ERROR ${audioSinkError.message} pos=${eventTime.currentPlaybackPositionMs}")
                    }

                    override fun onAudioUnderrun(eventTime: androidx.media3.exoplayer.analytics.AnalyticsListener.EventTime, bufferSize: Int, bufferSizeMs: Long, elapsedSinceLastFeedMs: Long) {
                        android.util.Log.w("LuminaAudio", "UNDERRUN buffer=${bufferSizeMs}ms sinceLastFeed=${elapsedSinceLastFeedMs}ms pos=${eventTime.currentPlaybackPositionMs}")
                    }
                })
            }
    }

    /**
     * What was measured on the Fire TV Stick 4K (`dumpsys media.audio_flinger`): the system mixer runs at 48 kHz, 16-bit
     * stereo out of HDMI, and its underrun counters read zero. So the output hardware is not what breaks, and asking for
     * float or 24-bit output would only be converted back down. What does help is keeping the player's audio thread fed:
     *  - the sound is held a little deeper than the default (0.5-1 s, against 0.25-0.75 s) so a brief stall in the
     *    app's own work is not heard. An earlier version asked for 1.5-3 s and crackling was heard afterwards, so this is
     *    a small step, not a large one;
     *  - the audio goes through the system's own capability detection (HDMI sink), not a fixed format;
     *  - if a hardware decoder refuses a stream the player tries the next decoder instead of failing.
     * Not proven by ear: `adb logcat -s LuminaAudio` lists every underrun and sink error the player sees.
     */
    private fun renderers(app: Context, largeBuffer: Boolean): DefaultRenderersFactory = object : DefaultRenderersFactory(app) {
        override fun buildAudioSink(context: Context, enableFloatOutput: Boolean, enableAudioTrackPlaybackParams: Boolean): AudioSink =
            DefaultAudioSink.Builder(context)
                .setEnableFloatOutput(false)
                .setAudioTrackBufferSizeProvider(
                    DefaultAudioTrackBufferSizeProvider.Builder()
                        .setMinPcmBufferDurationUs(if (largeBuffer) 1_000_000 else 500_000)
                        .setMaxPcmBufferDurationUs(if (largeBuffer) 2_000_000 else 1_000_000)
                        .build(),
                )
                .build()
    }.setEnableDecoderFallback(true)

    /**
     * Start after one second of data (the default waits two and a half, which is felt as "loading"), recover
     * from a stall after three, and keep a deep buffer ahead (30-90 s) so a brief network dip is not heard.
     * Time, not memory size, decides the limit: audio is tiny, and video is bounded by the byte cap.
     */
    private fun loadControl(plan: com.lumina.tv.core.MemoryPlan) = DefaultLoadControl.Builder()
        // How far ahead is capped by memory on a small stick (see MemoryPlan): the same picture and sound, less held in RAM.
        .setBufferDurationsMs(minOf(30_000, plan.bufferMaxMs), plan.bufferMaxMs, 1_000, 3_000)
        .setTargetBufferBytes(plan.bufferBytes)
        .setPrioritizeTimeOverSizeThresholds(true)
        .build()

    private var settings: AppSettings? = null
    private var equalizer: android.media.audiofx.Equalizer? = null

    /**
     * Applies an equalizer preset to what is playing, or removes it. Uses the system's own equalizer on the player's audio
     * session; if the device has none (or refuses), the sound is left as it is and nothing breaks.
     */
    @Synchronized
    fun applyEqualizer(preset: EqPreset) {
        runCatching { equalizer?.release() }
        equalizer = null
        val session = instance?.audioSessionId ?: return
        if (preset == EqPreset.OFF || session == C.AUDIO_SESSION_ID_UNSET) return
        try {
            val eq = android.media.audiofx.Equalizer(0, session)
            val range = eq.bandLevelRange
            for (band in 0 until eq.numberOfBands) {
                val hz = eq.getCenterFreq(band.toShort()) / 1000
                val level = EqPresets.gainMillibels(preset, hz).coerceIn(range[0].toInt(), range[1].toInt())
                eq.setBandLevel(band.toShort(), level.toShort())
            }
            eq.enabled = true
            equalizer = eq
        } catch (e: Throwable) {
            android.util.Log.w("LuminaAudio", "Equalizer unavailable: ${e.message}")
        }
    }

    fun attributes(video: Boolean): AudioAttributes = AudioAttributes.Builder()
        .setUsage(C.USAGE_MEDIA)
        .setContentType(if (video) C.AUDIO_CONTENT_TYPE_MOVIE else C.AUDIO_CONTENT_TYPE_MUSIC)
        .build()
}
