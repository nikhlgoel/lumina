package com.lumina.tv.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.Text
import com.lumina.tv.BuildConfig
import com.lumina.tv.Graph
import com.lumina.tv.data.Updater
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** What the updater is doing, in words. Shared by the Settings panel and the prompt. */
private fun describe(state: Updater.State): String = when (state) {
    Updater.State.Idle -> "Lumina checks for updates by itself, in the background."
    Updater.State.Checking -> "Checking for updates…"
    is Updater.State.UpToDate -> "You're up to date."
    is Updater.State.Downloading -> "Downloading ${state.version}… ${(state.fraction * 100).toInt()}%"
    is Updater.State.Ready -> "Version ${state.version} is ready to install."
    is Updater.State.Failed -> state.message
}

/** Installing runs off the main thread (it copies the file to the system installer) and reports a missing permission. */
private suspend fun startInstall(graph: Graph): String? = withContext(Dispatchers.IO) {
    when (graph.updater.install()) {
        Updater.InstallStart.Started -> null
        Updater.InstallStart.NotReady -> "The update isn't ready yet."
        Updater.InstallStart.NeedsPermission -> "Allow Lumina to install apps (the screen that just opened), then choose Install again."
    }
}

/** The Settings panel: the version, what the updater is doing, and the two things a person might want to do. */
@Composable
fun UpdateSettings(graph: Graph) {
    val scope = rememberCoroutineScope()
    val state by graph.updater.state.collectAsStateWithLifecycle()
    var note by remember { mutableStateOf<String?>(null) }
    val busy = state is Updater.State.Checking || state is Updater.State.Downloading
    Panel {
        PanelInfo("Lumina TV ${BuildConfig.VERSION_NAME}", detail = describe(state), divided = false)
        PanelRow(
            "Check for updates", icon = Icons.Filled.Refresh, value = if (busy) "Working…" else null,
            onClick = { if (!busy) scope.launch { graph.updater.check(force = true) } },
        )
        if (state is Updater.State.Ready) {
            PanelRow("Install update", icon = Icons.Filled.SystemUpdate, highlight = true, onClick = { scope.launch { note = startInstall(graph) } })
        }
        note?.let { PanelInfo(it) }
    }
}

/**
 * Asked once per opening of the app, when an update is waiting and nothing is playing full-screen.
 * "Later" only hides it until the app is next opened, which is the "update when I open it again" path.
 */
@Composable
fun UpdatePrompt(graph: Graph, canShow: Boolean) {
    val scope = rememberCoroutineScope()
    val state by graph.updater.state.collectAsStateWithLifecycle()
    var dismissed by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }
    val primary = remember { FocusRequester() }
    val ready = state as? Updater.State.Ready
    if (ready == null || dismissed || !canShow) return
    LaunchedEffect(Unit) { runCatching { primary.requestFocus() } }
    LDialog(onDismiss = { dismissed = true }, width = 720.dp) {
        Text("Update ready", style = LuminaText.DialogTitle)
        Text("Lumina ${ready.version} has been downloaded. Installing takes a few seconds, then Lumina restarts.", style = LuminaText.Body)
        if (ready.notes.isNotBlank()) Text(ready.notes.trim().take(240), style = LuminaText.Small)
        note?.let { Text(it, style = LuminaText.Body.copy(color = LuminaColors.Amber)) }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            LButton("Install and restart", { scope.launch { note = startInstall(graph) } }, icon = Icons.Filled.SystemUpdate, primary = true, modifier = Modifier.focusRequester(primary))
            LButton("Later", { dismissed = true })
        }
    }
}
