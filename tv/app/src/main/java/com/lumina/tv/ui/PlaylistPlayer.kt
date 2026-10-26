package com.lumina.tv.ui

import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.tv.material3.Text
import com.lumina.tv.Graph
import com.lumina.tv.data.MediaKind
import com.lumina.tv.data.PlaylistSource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * Starts a YouTube playlist playing straight from the internet: no download first, no menu. It looks inside the
 * playlist, queues every song and opens the music page. While it looks, [opening] holds the playlist's name so the
 * screen can say so; if it cannot, [problem] holds a message fit to show.
 */
class PlaylistPlayer(private val graph: Graph, private val scope: CoroutineScope, private val open: (MediaKind) -> Unit) {
    var opening by mutableStateOf<String?>(null)
        private set
    var problem by mutableStateOf<String?>(null)
    private var job: Job? = null

    fun play(id: String, source: PlaylistSource, title: String) {
        job?.cancel()
        opening = title
        job = scope.launch {
            try {
                val fetched = graph.playlists.preview(id, source, MediaKind.AUDIO)
                if (fetched.tracks.isEmpty()) {
                    problem = "That playlist has nothing playable in it."
                } else {
                    graph.player.playStreamQueue(fetched.tracks, 0)
                    open(MediaKind.AUDIO)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                problem = "Couldn't open that playlist. ${e.message.orEmpty()}".trim()
            } finally {
                opening = null
            }
        }
    }

    /** Back pressed while it was still looking: stop looking. */
    fun cancel() { job?.cancel(); opening = null }
}

@Composable
fun rememberPlaylistPlayer(graph: Graph, open: (MediaKind) -> Unit): PlaylistPlayer {
    val scope = rememberCoroutineScope()
    return remember(graph) { PlaylistPlayer(graph, scope, open) }
}

/** The two small panels a [PlaylistPlayer] may need: "Opening..." while it looks, and a message when it cannot. */
@Composable
fun PlaylistPlayerDialogs(player: PlaylistPlayer) {
    player.opening?.let { name ->
        LDialog(onDismiss = player::cancel, width = 560.dp) {
            Text("Opening $name…", style = LuminaText.DialogTitle, maxLines = 2)
            Shimmer(Modifier.fillMaxWidth().height(20.dp))
        }
    }
    player.problem?.let { message ->
        LDialog(onDismiss = { player.problem = null }) {
            val ok = remember { FocusRequester() }
            LaunchedEffect(Unit) { runCatching { ok.requestFocus() } }
            Text(message, style = LuminaText.DialogTitle)
            LButton("OK", { player.problem = null }, primary = true, modifier = Modifier.focusRequester(ok))
        }
    }
}
