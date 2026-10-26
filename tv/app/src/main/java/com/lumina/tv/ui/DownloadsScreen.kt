package com.lumina.tv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.Text
import com.lumina.tv.Graph
import com.lumina.tv.core.Formatting
import com.lumina.tv.download.DownloadManager.DownloadJob
import com.lumina.tv.download.DownloadManager.State

/** Downloads in the same frame as the rest of Library: actions and an info line on top, then one panel of divided rows. */
@Composable
fun DownloadsScreen(graph: Graph) {
    val jobs by graph.downloads.jobs.collectAsStateWithLifecycle()
    val list = jobs.reversed()
    val active = jobs.count { it.active }
    val finished = jobs.size - active

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 8.dp, bottom = 24.dp)) {
        item {
            Column(Modifier.padding(bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (finished > 0) {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        LButton("Clear finished", onClick = graph.downloads::clearFinished)
                    }
                }
                if (jobs.isNotEmpty()) {
                    Text(
                        listOfNotNull(
                            if (active > 0) "$active downloading" else null,
                            if (finished > 0) "$finished finished" else null,
                            "keeps going if you leave the app",
                        ).joinToString(" · "),
                        style = LuminaText.Small,
                    )
                }
            }
        }
        if (jobs.isEmpty()) {
            item { StateMessage("No downloads", "Search for something and press Download. Progress shows here, and keeps going if you leave the app.") }
        }
        itemsIndexed(list, key = { _, it -> it.key }) { index, job ->
            JobRow(job, graph, panelShape(index, list.size), divided = index > 0)
        }
    }
}

@Composable
private fun JobRow(job: DownloadJob, graph: Graph, shape: Shape, divided: Boolean) {
    Column(Modifier.fillMaxWidth().background(LuminaColors.Surface, shape)) {
        if (divided) PanelDivider()
        Row(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Thumb(job.track.thumbnailUrl, job.kind, Modifier.size(72.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(job.track.title, style = LuminaText.Row, maxLines = 1)
                when (job.state) {
                    State.DOWNLOADING -> {
                        ProgressLine(job.fraction, Modifier.fillMaxWidth())
                        Text(
                            listOfNotNull(
                                "${(job.fraction * 100).toInt()}%",
                                if (job.total > 0) "${Formatting.bytes(job.downloaded)} of ${Formatting.bytes(job.total)}" else Formatting.bytes(job.downloaded),
                                job.speedBps.takeIf { it > 0 }?.let { Formatting.speed(it) },
                            ).joinToString(" · "),
                            style = LuminaText.Small,
                        )
                    }
                    State.QUEUED -> Text("Waiting for a free slot…", style = LuminaText.Small)
                    State.RESOLVING -> Text("Finding the best quality…", style = LuminaText.Small)
                    State.PROCESSING -> Text("Putting the video and sound together…", style = LuminaText.Small)
                    State.DONE -> Text("Saved to your library", style = LuminaText.Small.copy(color = LuminaColors.Ok))
                    State.CANCELLED -> Text("Cancelled", style = LuminaText.Small)
                    State.FAILED -> Text(job.message ?: "Failed", style = LuminaText.Small.copy(color = LuminaColors.Danger), maxLines = 3)
                }
            }
            when {
                job.active -> LButton("Cancel", onClick = { graph.downloads.cancel(job.key) }, icon = Icons.Filled.Close)
                job.state == State.FAILED || job.state == State.CANCELLED -> LButton("Retry", onClick = { graph.downloads.retry(job.key) }, icon = Icons.Filled.Refresh)
            }
        }
    }
}
