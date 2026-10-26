package com.lumina.tv.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat

/**
 * Speak a search instead of typing it.
 *
 * Honest about what it can do: the Alexa button on a Fire TV remote belongs to the system and cannot
 * be taken over by an app, so this is a button inside Lumina's own search that uses Android's speech
 * recogniser. Whether a recogniser exists depends on the device — [available] says, and the button is
 * simply not shown when it is false rather than being shown and failing.
 */
class VoiceSearch(
    val available: Boolean,
    val listening: Boolean,
    val partial: String,
    val start: () -> Unit,
    val cancel: () -> Unit,
)

@Composable
fun rememberVoiceSearch(onResult: (String) -> Unit, onProblem: (String) -> Unit): VoiceSearch {
    val context = LocalContext.current
    val available = remember { SpeechRecognizer.isRecognitionAvailable(context) }
    var listening by remember { mutableStateOf(false) }
    var partial by remember { mutableStateOf("") }
    val result by rememberUpdatedState(onResult)
    val problem by rememberUpdatedState(onProblem)

    val recognizer = remember { if (available) SpeechRecognizer.createSpeechRecognizer(context) else null }
    DisposableEffect(recognizer) {
        recognizer?.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) { listening = true; partial = "" }
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() { listening = false }
            override fun onPartialResults(partialResults: Bundle?) {
                partial = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
            }
            override fun onEvent(eventType: Int, params: Bundle?) {}
            override fun onResults(results: Bundle?) {
                listening = false
                val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()
                if (text.isNotEmpty()) result(text) else problem("I didn't catch that. Try again, or type it.")
            }
            override fun onError(error: Int) {
                listening = false
                problem(
                    when (error) {
                        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "I didn't catch that. Try again, or type it."
                        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Voice search needs an internet connection."
                        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission is needed for voice search."
                        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Voice search is busy. Try again in a moment."
                        else -> "Voice search didn't work on this device. Type it instead."
                    },
                )
            }
        })
        onDispose { recognizer?.destroy() }
    }

    fun begin() {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
        runCatching { recognizer?.startListening(intent) }.onFailure { problem("Voice search couldn't start.") }
    }

    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) begin() else problem("Microphone permission is needed for voice search.")
    }

    return VoiceSearch(
        available = available,
        listening = listening,
        partial = partial,
        start = {
            val have = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
            if (have) begin() else permission.launch(Manifest.permission.RECORD_AUDIO)
        },
        cancel = { runCatching { recognizer?.cancel() }; listening = false },
    )
}
