package com.lumina.tv

import android.app.SearchManager
import android.content.Intent
import android.os.Bundle
import android.provider.MediaStore
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.onPreviewKeyEvent
import com.lumina.tv.ui.AppShell
import com.lumina.tv.ui.Splash
import com.lumina.tv.ui.LuminaTheme

class MainActivity : ComponentActivity() {
    /** A search handed to us by the system (a voice command, if the device's assistant supports it). */
    private var externalQuery by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        externalQuery = queryFrom(intent)
        val graph = (application as LuminaApp).graph
        setContent {
            LuminaTheme {
                // The app is built underneath while the opening plays, and takes no key until it has faded away.
                var opening by rememberSaveable { mutableStateOf(graph.settings.openingAnimation) }
                Box(Modifier.fillMaxSize().onPreviewKeyEvent { opening }) {
                    AppShell(graph = graph, externalQuery = externalQuery, onExternalQueryHandled = { externalQuery = null })
                    if (opening) Splash(onDone = { opening = false })
                }
            }
        }
    }

    // singleTask: a second search while the app is already open arrives here, not as a new instance.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        queryFrom(intent)?.let { externalQuery = it }
    }

    private fun queryFrom(intent: Intent?): String? = when (intent?.action) {
        MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH, Intent.ACTION_SEARCH ->
            (intent.getStringExtra(SearchManager.QUERY) ?: intent.getStringExtra(MediaStore.EXTRA_MEDIA_TITLE))?.trim()?.takeIf { it.isNotEmpty() }
        else -> null
    }
}
