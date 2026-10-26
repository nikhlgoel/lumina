package com.lumina.tv.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Text
import com.lumina.tv.Graph
import com.lumina.tv.data.GoogleAuth
import com.lumina.tv.data.PhoneSetupServer
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.IOException

private sealed interface SignIn {
    /** No Google client yet: walk the person through making one, and wait for it to arrive from their phone. */
    data object Setup : SignIn
    data object Starting : SignIn
    data class Code(val code: GoogleAuth.DeviceCode) : SignIn
    data class Failed(val message: String) : SignIn
    data object Done : SignIn
}

/**
 * Sign in with a Google account, the way Google documents it for a TV: this screen shows a short code,
 * the person enters it on their phone, approves, and this screen carries on by itself. Nothing is typed
 * on the remote, and the password never touches the TV.
 */
@Composable
fun SignInDialog(graph: Graph, onFinished: () -> Unit, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var state by remember { mutableStateOf<SignIn>(if (graph.google.credentials == null) SignIn.Setup else SignIn.Starting) }
    var job by remember { mutableStateOf<Job?>(null) }
    var phone by remember { mutableStateOf<PhoneSetupServer.Running?>(null) }
    val primary = remember { FocusRequester() }

    fun begin() {
        job?.cancel()
        state = SignIn.Starting
        job = scope.launch {
            try {
                val code = graph.google.requestCode()
                state = SignIn.Code(code)
                graph.google.awaitApproval(code)
                state = SignIn.Done
            } catch (e: CancellationException) {
                throw e
            } catch (e: IOException) {
                state = SignIn.Failed(e.message ?: "Couldn't reach Google. Check the connection.")
            }
        }
    }

    LaunchedEffect(Unit) { if (state == SignIn.Starting) begin() }

    // While waiting for the Client ID to arrive, serve the phone page and notice the moment it is saved.
    LaunchedEffect(state) {
        if (state == SignIn.Setup) {
            phone = graph.phoneSetup.start()
            while (graph.google.credentials == null) delay(1000)
            begin()
        }
    }
    DisposableEffect(Unit) {
        onDispose {
            job?.cancel()
            graph.phoneSetup.stop()
        }
    }
    LaunchedEffect(state) { runCatching { primary.requestFocus() } }

    LDialog(onDismiss = onDismiss) {
        when (val s = state) {
            SignIn.Setup -> {
                Text("Set up Google sign-in (once)", style = LuminaText.DialogTitle)
                Text(
                    "Google asks every app to use its own key, so yours stays yours. It is free and takes about ten minutes, on a computer:",
                    style = LuminaText.Body,
                )
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    for (step in listOf(
                        "1.  Open console.cloud.google.com and create a project.",
                        "2.  Turn on “YouTube Data API v3”.",
                        "3.  Credentials → Create OAuth client ID → type “TVs and Limited Input devices”.",
                        "4.  On the consent screen, set it to “In production”, or sign-in expires every week.",
                    )) Text(step, style = LuminaText.Body)
                }
                val p = phone
                if (p != null) {
                    Text("Then, on your phone or laptop (same Wi-Fi), open:", style = LuminaText.Body)
                    Text(p.url, style = LuminaText.DialogTitle.copy(color = LuminaColors.Amber))
                    Text("PIN  ${p.pin}", style = LuminaText.Display.copy(color = LuminaColors.Ink))
                    Text("Paste the Client ID and secret there. This screen continues by itself.", style = LuminaText.Small)
                } else {
                    Text("The TV isn't on Wi-Fi, so the phone page can't open. Connect it and come back.", style = LuminaText.Body.copy(color = LuminaColors.Danger))
                }
                LButton("Close", onDismiss, modifier = Modifier.focusRequester(primary))
            }
            SignIn.Starting -> {
                Text("Contacting Google…", style = LuminaText.DialogTitle)
                LButton("Cancel", onDismiss, modifier = Modifier.focusRequester(primary))
            }
            is SignIn.Code -> {
                Text("Sign in with your phone", style = LuminaText.DialogTitle)
                Text("On your phone or computer, open", style = LuminaText.Body)
                Text(s.code.verificationUrl.removePrefix("https://").removePrefix("http://"), style = LuminaText.Display.copy(color = LuminaColors.Amber))
                Text("and enter this code:", style = LuminaText.Body)
                Text(s.code.userCode, style = LuminaText.Display.copy(letterSpacing = androidx.compose.ui.unit.TextUnit(6f, androidx.compose.ui.unit.TextUnitType.Sp)))
                Text("Sign in, press Allow, and this screen continues by itself. Lumina can only read your playlists; it cannot change anything.", style = LuminaText.Small)
                LButton("Cancel", onDismiss, modifier = Modifier.focusRequester(primary))
            }
            is SignIn.Failed -> {
                Text("Couldn't sign in", style = LuminaText.DialogTitle.copy(color = LuminaColors.Danger))
                Text(s.message, style = LuminaText.Body)
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    LButton("Try again", ::begin, icon = Icons.Filled.Refresh, primary = true, modifier = Modifier.focusRequester(primary))
                    LButton("Close", onDismiss)
                }
            }
            SignIn.Done -> {
                Text("Signed in", style = LuminaText.DialogTitle.copy(color = LuminaColors.Ok))
                Text("Your playlists are on the Playlists screen now.", style = LuminaText.Body)
                LButton("Continue", onFinished, icon = Icons.Filled.Check, primary = true, modifier = Modifier.focusRequester(primary).fillMaxWidth().padding(top = 4.dp))
            }
        }
    }
}
