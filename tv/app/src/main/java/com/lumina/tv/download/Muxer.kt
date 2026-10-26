package com.lumina.tv.download

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import java.io.File
import java.nio.ByteBuffer

/**
 * Joins a video-only file and an audio-only file into one playable file, without re-encoding.
 *
 * Sites serve their best pictures with no sound, and the sound as a separate file; saving "1080p"
 * means fetching both and sewing them together. Android's own muxer does that with no extra
 * libraries — but only for combinations it supports: H.264 + AAC into MP4, and VP9 + Opus into WebM.
 * [supports] says which, so the caller can choose streams that will work rather than finding out
 * after downloading.
 */
object Muxer {
    enum class Container(val extension: String) { MP4("mp4"), WEBM("webm") }

    fun supports(videoIsH264: Boolean, videoIsVp9: Boolean, audioIsAac: Boolean, audioIsOpus: Boolean): Container? = when {
        videoIsH264 && audioIsAac -> Container.MP4
        videoIsVp9 && audioIsOpus -> Container.WEBM
        else -> null
    }

    fun mux(video: File, audio: File, out: File, container: Container) {
        val format = if (container == Container.MP4) MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4 else MediaMuxer.OutputFormat.MUXER_OUTPUT_WEBM
        val muxer = MediaMuxer(out.path, format)
        val videoSource = MediaExtractor()
        val audioSource = MediaExtractor()
        var started = false
        try {
            videoSource.setDataSource(video.path)
            audioSource.setDataSource(audio.path)
            val videoTrack = firstTrack(videoSource, "video/") ?: error("No video track in ${video.name}")
            val audioTrack = firstTrack(audioSource, "audio/") ?: error("No audio track in ${audio.name}")
            val videoOut = muxer.addTrack(videoSource.getTrackFormat(videoTrack))
            val audioOut = muxer.addTrack(audioSource.getTrackFormat(audioTrack))

            muxer.start()
            started = true
            copy(videoSource, videoTrack, muxer, videoOut)
            copy(audioSource, audioTrack, muxer, audioOut)
        } finally {
            runCatching { if (started) muxer.stop() }
            runCatching { muxer.release() }
            runCatching { videoSource.release() }
            runCatching { audioSource.release() }
        }
    }

    private fun firstTrack(extractor: MediaExtractor, prefix: String): Int? =
        (0 until extractor.trackCount).firstOrNull { extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith(prefix) == true }

    private fun copy(extractor: MediaExtractor, track: Int, muxer: MediaMuxer, outTrack: Int) {
        extractor.selectTrack(track)
        // Large enough for a 4K keyframe; a frame bigger than this would be truncated, so size it generously.
        val buffer = ByteBuffer.allocate(4 * 1024 * 1024)
        val info = MediaCodec.BufferInfo()
        while (true) {
            buffer.clear()
            val size = extractor.readSampleData(buffer, 0)
            if (size < 0) break
            info.set(0, size, extractor.sampleTime, if (extractor.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
            muxer.writeSampleData(outTrack, buffer, info)
            extractor.advance()
        }
        extractor.unselectTrack(track)
    }
}
