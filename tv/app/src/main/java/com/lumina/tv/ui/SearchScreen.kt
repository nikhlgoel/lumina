package com.lumina.tv.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.sp
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.Icon
import androidx.tv.material3.Text
import com.lumina.tv.Graph
import com.lumina.tv.core.Formatting
import com.lumina.tv.data.MediaKind
import com.lumina.tv.data.SearchResults
import com.lumina.tv.data.Track
import com.lumina.tv.download.DownloadManager
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException
import java.net.UnknownHostException

private sealed interface SearchState {
    data object Idle : SearchState
    data object Loading : SearchState
    data class Failed(val message: String) : SearchState
    data class Done(val results: SearchResults) : SearchState
}

@Composable
fun SearchScreen(graph: Graph, seed: String?, onSeedHandled: () -> Unit, open: (MediaKind) -> Unit) {
    val scope = rememberCoroutineScope()
    var query by rememberSaveable { mutableStateOf("") }
    var state by remember { mutableStateOf<SearchState>(SearchState.Idle) }
    var note by remember { mutableStateOf<String?>(null) }
    var running by remember { mutableStateOf<Job?>(null) }
    var recents by remember { mutableStateOf(graph.settings.recentSearches) }
    val keyboard = LocalSoftwareKeyboardController.current
    val field = remember { FocusRequester() }
    val firstResult = remember { FocusRequester() }
    // Leaving Search must take the keyboard with it: it used to stay up over the player.
    androidx.compose.runtime.DisposableEffect(Unit) { onDispose { keyboard?.hide() } }
    var lookedAt by remember { mutableStateOf<Track?>(null) }
    // Resolve what the remote rests on, so pressing Play starts at once.
    LaunchedEffect(lookedAt) {
        val t = lookedAt ?: return@LaunchedEffect
        delay(500)
        graph.repo.prewarm(t)
    }
    // When results arrive, move to the first one, once. Without this focus stayed on the box or fell to the sidebar.
    LaunchedEffect(state is SearchState.Done) {
        if (state is SearchState.Done) {
            delay(120)
            runCatching { firstResult.requestFocus() }
        }
    }

    fun run(text: String) {
        val q = text.trim()
        if (q.isEmpty()) return
        keyboard?.hide()
        note = null
        graph.settings.rememberSearch(q)
        recents = graph.settings.recentSearches
        running?.cancel()
        state = SearchState.Loading
        running = scope.launch {
            state = try {
                SearchState.Done(graph.repo.search(q))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                SearchState.Failed(searchProblem(e))
            }
        }
    }

    val voice = rememberVoiceSearch(
        onResult = { spoken -> query = spoken; run(spoken) },
        onProblem = { note = it },
    )

    // A search arriving from outside (a voice command) fills the box and runs.
    LaunchedEffect(seed) {
        if (seed != null) {
            query = seed
            run(seed)
            onSeedHandled()
        }
    }
    // The page opens with the remote on the box (no keyboard: Select does that). Asked for after the screen change has settled:
    // the shell hands focus to the page 140 ms after Select, while the old screen is still fading out, and that used to
    // win and drop the remote back on the sidebar.
    LaunchedEffect(Unit) { if (seed == null) { delay(320); runCatching { field.requestFocus() } } }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        item {
            Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                SearchField(query, onChange = { query = it }, onSubmit = { run(query) }, focus = field, modifier = Modifier.weight(1f))
                if (voice.available) {
                    LButton(if (voice.listening) "Listening…" else "Speak", onClick = { if (voice.listening) voice.cancel() else voice.start() }, icon = Icons.Filled.Mic)
                }
                LButton("Search", onClick = { run(query) }, icon = Icons.Filled.Search, primary = true, enabled = query.isNotBlank())
            }
            val line = when {
                voice.listening -> if (voice.partial.isBlank()) "Listening — say the name of a song or video…" else "“${voice.partial}”"
                else -> note
            }
            if (line != null) Text(line, style = LuminaText.Body.copy(color = LuminaColors.Amber), modifier = Modifier.padding(top = 10.dp, start = 6.dp))
            if (!voice.available) {
                Text("Voice search isn't available on this device. Press Select on the box to type with the on-screen keyboard.", style = LuminaText.Small, modifier = Modifier.padding(top = 8.dp, start = 6.dp))
            } else if (query.isEmpty() && state is SearchState.Idle) {
                Text("Press Select on the box to type, or choose Speak.", style = LuminaText.Small, modifier = Modifier.padding(top = 8.dp, start = 6.dp))
            }
        }

        when (val s = state) {
            SearchState.Idle -> {
                if (recents.isNotEmpty()) {
                    item { SectionTitle("Recent searches") }
                    items(recents, key = { it }) { r ->
                        FocusSurface(onClick = { query = r; run(r) }, modifier = Modifier.fillMaxWidth()) {
                            Row(Modifier.padding(horizontal = 18.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                                Icon(Icons.Filled.Search, contentDescription = null, tint = LuminaColors.Ink3, modifier = Modifier.size(24.dp))
                                Text(r, style = LuminaText.Row, maxLines = 1)
                            }
                        }
                    }
                    item { LButton("Clear recent searches", onClick = { graph.settings.clearRecentSearches(); recents = emptyList() }, modifier = Modifier.padding(top = 10.dp)) }
                }
            }
            SearchState.Loading -> item { StateMessage("Searching…", "Songs and videos for “$query”") }
            is SearchState.Failed -> item {
                StateMessage("Couldn't search", s.message, actionLabel = "Try again", onAction = { run(query) }, isError = true)
            }
            is SearchState.Done -> {
                val r = s.results
                if (r.songs.isEmpty() && r.videos.isEmpty()) {
                    item { StateMessage("Nothing found for “${r.query}”", "Check the spelling, or try fewer words.") }
                }
                if (r.songs.isNotEmpty()) {
                    item(key = "songs") {
                        ContentRow("Songs") {
                            itemsIndexed(r.songs, key = { _, t -> "s-" + t.url }) { i, t ->
                                PosterCard(
                                    t.thumbnailUrl, t.kind, t.title, t.artist.ifBlank { null },
                                    onClick = { graph.player.playStreamQueue(r.songs, i); open(t.kind) }, onFocused = { lookedAt = t },
                                    modifier = if (i == 0) Modifier.focusRequester(firstResult) else Modifier,
                                    width = CARD_WIDTH, aspect = CARD_ASPECT,
                                )
                            }
                        }
                    }
                }
                if (r.videos.isNotEmpty()) {
                    item(key = "videos") {
                        ContentRow("Videos") {
                            itemsIndexed(r.videos, key = { _, t -> "v-" + t.url }) { i, t ->
                                PosterCard(
                                    t.thumbnailUrl, t.kind, t.title, t.artist.ifBlank { null },
                                    onClick = { graph.player.playStreamQueue(r.videos, i); open(t.kind) }, onFocused = { lookedAt = t },
                                    modifier = if (i == 0 && r.songs.isEmpty()) Modifier.focusRequester(firstResult) else Modifier,
                                    width = CARD_WIDTH_VIDEO, aspect = 16f / 9f, duration = lengthLabel(t.durationSec),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * The search box, in two steps so the remote never gets pulled somewhere it did not choose. Landing on the box (the page opens
 * on it) only lights it: no keyboard. Select starts typing and opens the TV's own on-screen keyboard; the keyboard's Search key
 * submits. When the keyboard is closed again (Back, or its own Done) the remote returns to the box instead of falling to the
 * sidebar, so Down reaches what is below it (the recent searches) and Left still reaches the sidebar when you want it.
 * [focus] is the box's requester: asking for it puts the remote on the box and never opens the keyboard.
 */
@Composable
fun SearchField(
    value: String,
    onChange: (String) -> Unit,
    onSubmit: () -> Unit,
    focus: FocusRequester,
    modifier: Modifier = Modifier,
    placeholder: String = "Search songs and videos",
) {
    val keyboard = LocalSoftwareKeyboardController.current
    val focusManager = LocalFocusManager.current
    val scope = rememberCoroutineScope()
    val typingFocus = remember { FocusRequester() }
    var boxFocused by remember { mutableStateOf(false) }
    var typingFocused by remember { mutableStateOf(false) }
    var typing by remember { mutableStateOf(false) }
    // Set when the remote leaves the box on purpose (Down, or a search was submitted), so it is not pulled back.
    var leaving by remember { mutableStateOf(false) }
    val focused = boxFocused || typingFocused
    fun stopTyping(restore: Boolean) {
        typing = false
        keyboard?.hide()
        if (restore) scope.launch { delay(60); runCatching { focus.requestFocus() } }
    }
    LaunchedEffect(typing) {
        if (typing) {
            leaving = false
            delay(30)
            runCatching { typingFocus.requestFocus() }
            keyboard?.show()
        }
    }
    val shape = RoundedCornerShape(12.dp)
    // A hairline all round, and when the box has the remote a 2 dp line of the accent colour along the bottom: clear from
    // across a room without a thick outline.
    Box(
        modifier
            .height(58.dp)
            .clip(shape)
            .background(if (focused) Color(0xFF1B1A22) else Color(0xFF121117), shape)
            .drawBehind {
                if (focused) drawRect(LuminaColors.Amber, topLeft = androidx.compose.ui.geometry.Offset(0f, size.height - 2.dp.toPx()), size = androidx.compose.ui.geometry.Size(size.width, 2.dp.toPx()))
            }
            .border(BorderStroke(1.dp, LuminaColors.HairlineStrong), shape)
            .padding(horizontal = 20.dp)
            // The box itself holds the remote; the text input inside only takes it once Select is pressed.
            .focusRequester(focus)
            .onFocusChanged { boxFocused = it.isFocused }
            .onPreviewKeyEvent { event ->
                val select = event.key == Key.DirectionCenter || event.key == Key.Enter || event.key == Key.NumPadEnter
                when {
                    // Select on the box = "I want to type" (and again while typing, to bring the keyboard back after it was closed).
                    select && event.type == KeyEventType.KeyUp -> { if (typing) keyboard?.show() else typing = true; true }
                    // A text field swallows Down, so from the box the remote could never reach what is below it.
                    event.key == Key.DirectionDown && event.type == KeyEventType.KeyDown -> {
                        leaving = true
                        focusManager.moveFocus(FocusDirection.Down)
                        true
                    }
                    // Back while typing only stops the typing; the remote stays on the box. (With the keyboard up, the keyboard takes Back first.)
                    typing && event.key == Key.Back -> { if (event.type == KeyEventType.KeyUp) stopTyping(restore = true); true }
                    else -> false
                }
            }
            .focusable(),
        contentAlignment = Alignment.CenterStart,
    ) {
        BasicTextField(
            value = value,
            onValueChange = onChange,
            singleLine = true,
            textStyle = LuminaText.Body.copy(fontSize = 21.sp, color = LuminaColors.Ink),
            cursorBrush = SolidColor(LuminaColors.Amber),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { leaving = true; typing = false; onSubmit() }),
            modifier = Modifier
                .fillMaxWidth()
                .focusRequester(typingFocus)
                .focusProperties { canFocus = typing }
                .onFocusChanged {
                    typingFocused = it.isFocused
                    // Focus fell away without the person moving it (the keyboard closing hands it to the sidebar): take it back.
                    if (!it.isFocused && typing) {
                        typing = false
                        if (!leaving) scope.launch { delay(60); runCatching { focus.requestFocus() } }
                    }
                },
            decorationBox = { inner ->
                if (value.isEmpty()) Text(placeholder, style = LuminaText.Body.copy(fontSize = 21.sp, color = LuminaColors.Ink3))
                inner()
            },
        )
    }
}

private fun searchProblem(e: Throwable): String = when (e) {
    is UnknownHostException -> "There's no internet connection. Check Wi-Fi and try again."
    is ReCaptchaException -> "YouTube asked for a human check. Wait a little and try again."
    else -> e.message?.takeIf { it.isNotBlank() }?.let { "Something went wrong: $it" } ?: "Something went wrong. Try again."
}
