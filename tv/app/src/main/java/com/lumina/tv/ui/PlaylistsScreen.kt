package com.lumina.tv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.PlaylistPlay
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Sync
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
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.Icon
import androidx.tv.material3.Text
import com.lumina.tv.Graph
import com.lumina.tv.core.Formatting
import com.lumina.tv.core.PlaylistLogic
import com.lumina.tv.data.AccountPlaylistsRepo
import com.lumina.tv.data.FetchedPlaylist
import com.lumina.tv.data.MediaKind
import com.lumina.tv.data.PhoneSetupServer
import com.lumina.tv.data.PlaylistSource
import com.lumina.tv.data.SyncedPlaylist
import com.lumina.tv.data.YouTubeApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.IOException

private sealed interface PlaylistDialog {
    data object AddLink : PlaylistDialog
    data class Checking(val what: String) : PlaylistDialog
    data class Opening(val what: String) : PlaylistDialog
    data class Confirm(val id: String, val source: PlaylistSource, val fetched: FetchedPlaylist) : PlaylistDialog

    /** A playlist was just added: say so, and offer to open it. */
    data class Added(val ref: PlaylistRef, val songs: Int, val downloading: Boolean) : PlaylistDialog
    data object Phone : PlaylistDialog
    data object SignIn : PlaylistDialog
    data class Problem(val message: String) : PlaylistDialog
}

/**
 * Your playlists. Add one by link (typed here, or pasted from a phone) and it appears here and on Home with its cover,
 * name and songs, ready to play from the internet. Copying its songs onto the stick is a separate, optional choice. Sign in
 * with YouTube to see the playlists you made yourself as well.
 */
@Composable
fun PlaylistsScreen(graph: Graph, open: (MediaKind) -> Unit, openPlaylist: (PlaylistRef) -> Unit, openLiked: () -> Unit) {
    val scope = rememberCoroutineScope()
    val liked by graph.taste.liked.collectAsStateWithLifecycle()
    val synced by graph.playlistStore.playlists.collectAsStateWithLifecycle()
    var signedIn by remember { mutableStateOf(graph.google.signedIn) }
    val account by graph.accountPlaylists.flow.collectAsStateWithLifecycle()
    var dialog by remember { mutableStateOf<PlaylistDialog?>(null) }
    var syncing by remember { mutableStateOf<String?>(null) }

    fun loadAccount() { scope.launch { graph.accountPlaylists.load(force = true) } }
    LaunchedEffect(signedIn) { if (signedIn) graph.accountPlaylists.load() else graph.accountPlaylists.clear() }

    /** Look inside a playlist, then ask what to do about what is already in it. */
    fun check(id: String, source: PlaylistSource, label: String) {
        dialog = PlaylistDialog.Checking(label)
        scope.launch {
            dialog = try {
                PlaylistDialog.Confirm(id, source, graph.playlists.preview(id, source, MediaKind.AUDIO))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                PlaylistDialog.Problem("Couldn't open that playlist. ${e.message.orEmpty()}".trim())
            }
        }
    }

    /** Start a playlist playing from the internet at once: no download, no menu. */
    fun playNow(id: String, source: PlaylistSource, label: String) {
        dialog = PlaylistDialog.Opening(label)
        scope.launch {
            try {
                val fetched = graph.playlists.preview(id, source, MediaKind.AUDIO)
                if (fetched.tracks.isEmpty()) {
                    dialog = PlaylistDialog.Problem("That playlist has nothing playable in it.")
                } else {
                    graph.player.playStreamQueue(fetched.tracks, 0)
                    dialog = null
                    open(MediaKind.AUDIO)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                dialog = PlaylistDialog.Problem("Couldn't open that playlist. ${e.message.orEmpty()}".trim())
            }
        }
    }

    var optionsId by remember { mutableStateOf<String?>(null) }
    val opened = synced.firstOrNull { it.id == optionsId }

    LazyVerticalGrid(
        columns = GridCells.Adaptive(240.dp),
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(top = 8.dp, bottom = 24.dp, start = 4.dp, end = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(20.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        // One grid for everything: Liked songs first, then your account's playlists, then the ones added by link, and the
        // tile that adds one more. Adding by link (and the phone page) lives in that tile's popup, not in extra buttons up here.
        if (signedIn) item(span = { GridItemSpan(maxLineSpan) }) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                LIconButton(Icons.Filled.Refresh, "Refresh your playlists", ::loadAccount, size = 49.dp)
                Text("Hold Select on a playlist for more", style = LuminaText.Small)
            }
        }
        item(key = "liked") { LikedCard(liked.size, onClick = openLiked) }

        if (signedIn) {
            when (val a = account) {
                AccountPlaylistsRepo.State.Idle -> Unit
                AccountPlaylistsRepo.State.Loading -> item(span = { GridItemSpan(maxLineSpan) }) { Shimmer(Modifier.fillMaxWidth().height(84.dp)) }
                is AccountPlaylistsRepo.State.Failed -> item(span = { GridItemSpan(maxLineSpan) }) { StateMessage("Couldn't load your playlists", a.message, "Try again", ::loadAccount, isError = true) }
                is AccountPlaylistsRepo.State.Loaded -> {
                    if (a.lists.isEmpty()) {
                        item(span = { GridItemSpan(maxLineSpan) }) { Text("No playlists on this account yet.", style = LuminaText.Body) }
                    } else {
                        items(a.lists, key = { "account-" + it.id }) { l ->
                            val kept = synced.firstOrNull { it.id == l.id }
                            PlaylistTile(
                                imageUrl = l.thumbnail,
                                title = l.title,
                                detail = if (l.itemCount >= 0) "${l.itemCount} songs" else "Your likes",
                                badge = if (kept != null) "On this device" else null,
                                onClick = { openPlaylist(PlaylistRef(l.id, PlaylistSource.ACCOUNT, l.title, l.thumbnail, l.itemCount)) },
                                onLongClick = { if (kept != null) optionsId = kept.id else check(l.id, PlaylistSource.ACCOUNT, l.title) },
                            )
                        }
                    }
                }
            }
        }

        // Playlists added by link (a friend's, a shared one): saved here with their cover, name and songs, and played from
        // the internet. Playlists of your own account are listed above, so only the others appear here.
        val accountIds = ((account as? AccountPlaylistsRepo.State.Loaded)?.lists.orEmpty()).map { it.id }.toSet()
        val byLink = synced.filter { it.id !in accountIds }
        items(byLink, key = { "link-" + it.id }) { p ->
            PlaylistTile(
                imageUrl = p.thumbnailUrl,
                title = p.title,
                detail = "${p.itemCount} ${if (p.mode == MediaKind.AUDIO) "songs" else "videos"}",
                badge = when {
                    syncing == p.id -> "Syncing…"
                    p.lastError != null && p.download -> "Sync problem"
                    p.download -> "On this device"
                    else -> null
                },
                onClick = { openPlaylist(PlaylistRef(p.id, p.source, p.title, p.thumbnailUrl, p.itemCount)) },
                onLongClick = { optionsId = p.id },
            )
        }
        item(key = "add-by-link") { AddLinkTile { dialog = PlaylistDialog.AddLink } }

        // Signing in is only offered while you are not: once you are, the page is just your playlists.
        if (!signedIn) item(span = { GridItemSpan(maxLineSpan) }) { SignInCard { dialog = PlaylistDialog.SignIn } }
    }

    opened?.let { p ->
        PlaylistOptionsDialog(
            p = p, busy = syncing == p.id, onDismiss = { optionsId = null },
            onPlay = { optionsId = null; playNow(p.id, p.source, p.title) },
            onSync = {
                syncing = p.id
                scope.launch { try { graph.playlists.sync(p.id) } finally { syncing = null } }
            },
            onMode = { scope.launch { graph.playlistStore.update(p.id) { it.copy(mode = if (it.mode == MediaKind.AUDIO) MediaKind.VIDEO else MediaKind.AUDIO) } } },
            // Copying songs onto the stick is a choice made here, not something adding a playlist does.
            onDownload = {
                optionsId = null
                scope.launch { graph.playlists.setDownload(p.id, on = !p.download, downloadExisting = true) }
            },
            onStop = { optionsId = null; scope.launch { graph.playlists.remove(p.id) } },
        )
    }

    when (val d = dialog) {
        null -> Unit
        PlaylistDialog.AddLink -> AddLinkDialog(
            onDismiss = { dialog = null },
            onPhone = { dialog = PlaylistDialog.Phone },
            onLink = { text ->
                when (val parsed = PlaylistLogic.parse(text)) {
                    is PlaylistLogic.Parsed.Ok -> if (synced.any { it.id == parsed.id }) dialog = PlaylistDialog.Problem("That playlist is already in your playlists.") else check(parsed.id, PlaylistSource.PUBLIC, "that playlist")
                    PlaylistLogic.Parsed.Mix -> dialog = PlaylistDialog.Problem("That's a YouTube Mix. It's generated fresh every time, so there's nothing fixed to keep in sync. Use a normal playlist.")
                    PlaylistLogic.Parsed.Invalid -> dialog = PlaylistDialog.Problem("That doesn't look like a playlist link. It should contain list= or start with PL.")
                }
            },
        )
        is PlaylistDialog.Checking -> LDialog(onDismiss = { dialog = null }) {
            Text("Looking inside ${d.what}…", style = LuminaText.DialogTitle)
            ThinProgress()
        }
        is PlaylistDialog.Opening -> LDialog(onDismiss = { dialog = null }, width = 560.dp) {
            Text("Opening ${d.what}…", style = LuminaText.DialogTitle, maxLines = 2)
            ThinProgress()
        }
        is PlaylistDialog.Confirm -> ConfirmDialog(
            graph = graph, c = d, onDismiss = { dialog = null },
            onSave = {
                dialog = null
                scope.launch {
                    graph.playlists.save(d.id, d.source, MediaKind.AUDIO, d.fetched)
                    dialog = PlaylistDialog.Added(PlaylistRef(d.id, d.source, d.fetched.title, d.fetched.thumbnailUrl, d.fetched.tracks.size), d.fetched.tracks.size, downloading = false)
                }
            },
            onKeep = {
                dialog = null
                scope.launch {
                    graph.playlists.add(d.id, d.source, MediaKind.AUDIO, d.fetched, true)
                    dialog = PlaylistDialog.Added(PlaylistRef(d.id, d.source, d.fetched.title, d.fetched.thumbnailUrl, d.fetched.tracks.size), d.fetched.tracks.size, downloading = true)
                }
            },
        )
        is PlaylistDialog.Added -> LDialog(onDismiss = { dialog = null }, width = 560.dp) {
            val open = remember { FocusRequester() }
            LaunchedEffect(Unit) { delay(80); runCatching { open.requestFocus() } }
            Text("Added", style = LuminaText.DialogTitle)
            Text(
                "${d.ref.title} · ${Formatting.count(d.songs, "song")}" + if (d.downloading) " · downloading" else "",
                style = LuminaText.Body, maxLines = 2,
            )
            LButton("Open it", { dialog = null; openPlaylist(d.ref) }, icon = PlayerIcons.Play, primary = true, modifier = Modifier.focusRequester(open))
        }
        PlaylistDialog.Phone -> PhoneDialog(graph, onDismiss = { dialog = null })
        PlaylistDialog.SignIn -> SignInDialog(graph, onFinished = { signedIn = graph.google.signedIn; dialog = null }, onDismiss = { signedIn = graph.google.signedIn; dialog = null })
        is PlaylistDialog.Problem -> LDialog(onDismiss = { dialog = null }) {
            val ok = remember { FocusRequester() }
            LaunchedEffect(Unit) { runCatching { ok.requestFocus() } }
            Text(d.message, style = LuminaText.DialogTitle)
            LButton("OK", { dialog = null }, primary = true, modifier = Modifier.focusRequester(ok))
        }
    }
}

/** Shown only while signed out. */
@Composable
private fun SignInCard(onSignIn: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(LuminaColors.Surface, RoundedCornerShape(18.dp)).padding(22.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Sign in with YouTube", style = LuminaText.Row)
            Text("See your own playlists, private ones and Liked videos too, and play them here. Takes a code on your phone.", style = LuminaText.Small)
        }
        LButton("Sign in", onSignIn, primary = true)
    }
}

@Composable
private fun PlaylistTile(imageUrl: String?, title: String, detail: String, badge: String?, onClick: () -> Unit, onLongClick: () -> Unit) {
    PosterCard(
        imageUrl = imageUrl, kind = MediaKind.AUDIO, title = title, subtitle = detail, onClick = onClick, onLongClick = onLongClick,
        badge = badge, width = Dp.Unspecified,
    )
}

/** What can be done with a playlist kept on this device: reached by holding Select on its cover, like deleting in Library. */
@Composable
private fun PlaylistOptionsDialog(p: SyncedPlaylist, busy: Boolean, onDismiss: () -> Unit, onPlay: () -> Unit, onSync: () -> Unit, onMode: () -> Unit, onDownload: () -> Unit, onStop: () -> Unit) {
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { first.requestFocus() } }
    LDialog(onDismiss = onDismiss, width = 700.dp) {
        Text(p.title, style = LuminaText.DialogTitle, maxLines = 2)
        Text(
            "${p.itemCount} ${if (p.mode == MediaKind.AUDIO) "songs" else "videos"}" +
                (if (p.download) " · kept on this device" else " · plays from the internet"),
            style = LuminaText.Body,
        )
        p.lastError?.let { Text(it, style = LuminaText.Small.copy(color = LuminaColors.Danger), maxLines = 2) }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            LButton("Play", onPlay, icon = PlayerIcons.Play, primary = true, modifier = Modifier.focusRequester(first))
            LButton(if (p.download) "Stop keeping songs" else "Keep songs", onDownload, icon = PlayerIcons.Download)
            LButton(if (busy) "Refreshing…" else "Refresh", onSync, icon = Icons.Filled.Sync, dimmed = busy)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (p.download) LButton(if (p.mode == MediaKind.AUDIO) "Keep as video" else "Keep as music", onMode)
            LButton("Remove", onStop, icon = Icons.Filled.Delete)
        }
    }
}

/** The last tile of "Added by link": the way to add one more, in the same place the others are. */
@Composable
private fun AddLinkTile(onClick: () -> Unit) {
    FocusSurface(onClick = onClick, modifier = Modifier.fillMaxWidth().aspectRatio(CARD_ASPECT).border(1.dp, LuminaColors.HairlineStrong, RoundedCornerShape(14.dp)), shape = RoundedCornerShape(14.dp), scaleOnFocus = 1.035f) {
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Filled.Add, contentDescription = null, tint = LuminaColors.Ink, modifier = Modifier.size(52.dp))
            Text("Add by link", style = LuminaText.Row)
            Text("paste, or send from your phone", style = LuminaText.Small, maxLines = 1)
        }
    }
}

@Composable
private fun AddLinkDialog(onDismiss: () -> Unit, onPhone: () -> Unit, onLink: (String) -> Unit) {
    var text by remember { mutableStateOf("") }
    val field = remember { FocusRequester() }
    val keyboard = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    // The box is ready to receive text the moment the dialog opens, and the TV's keyboard is up with it. A phone used as
    // a remote types into the keyboard that is on screen, so without this it had nowhere to put what was pasted.
    LaunchedEffect(Unit) { runCatching { field.requestFocus() }; delay(250); keyboard?.show() }
    // Short on purpose: the TV's keyboard covers the bottom of the screen, and a taller box lost its title off the top.
    LDialog(onDismiss = onDismiss, width = 760.dp) {
        Text("Add a playlist", style = LuminaText.DialogTitle)
        SearchField(text, { text = it }, { if (text.isNotBlank()) onLink(text) }, field, Modifier.fillMaxWidth(), placeholder = "Paste a YouTube or YouTube Music playlist link")
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            LButton("Add", { onLink(text) }, primary = true, enabled = text.isNotBlank())
            LButton("Paste", { clipboard.getText()?.text?.trim()?.takeIf { it.isNotEmpty() }?.let { text = it } })
            LButton("From phone", onPhone, icon = Icons.Filled.PhoneAndroid)
        }
    }
}

@Composable
private fun ConfirmDialog(graph: Graph, c: PlaylistDialog.Confirm, onDismiss: () -> Unit, onSave: () -> Unit, onKeep: () -> Unit) {
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) { delay(80); runCatching { first.requestFocus() } }
    val seconds = c.fetched.tracks.sumOf { it.durationSec }
    val bytes = PlaylistLogic.estimateAudioBytes(seconds)
    val free = graph.storage.activeRoot().freeBytes
    // Audio size is a fair estimate (original streams are about 128 kbps).
    val tooBig = free > 0 && bytes >= free * 7 / 10
    val count = c.fetched.tracks.size
    // A playlist of your own account is already in your playlists; the only question left is whether to copy its songs.
    val own = c.source == PlaylistSource.ACCOUNT

    // The cover, the name and how big it is; then the two choices. The size belongs to the optional download only.
    LDialog(onDismiss = onDismiss, width = 680.dp) {
        Row(horizontalArrangement = Arrangement.spacedBy(20.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(96.dp).clip(RoundedCornerShape(12.dp)).border(1.dp, LuminaColors.Hairline, RoundedCornerShape(12.dp))) {
                Thumb(c.fetched.thumbnailUrl, MediaKind.AUDIO, Modifier.fillMaxSize(), shape = RoundedCornerShape(0.dp))
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(c.fetched.title, style = LuminaText.DialogTitle.copy(fontSize = 24.sp), maxLines = 2)
                Text(
                    Formatting.count(count, "song") + if (seconds > 0) " · ${Formatting.durationShort(seconds)}" else "",
                    style = LuminaText.Body,
                )
            }
        }
        if (tooBig) Text("Keeping every song would nearly fill the drive. Add a USB drive in Settings first.", style = LuminaText.Small.copy(color = LuminaColors.Danger))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (!own) LButton("Add to my playlists", onSave, icon = Icons.Filled.Add, primary = true, modifier = Modifier.focusRequester(first))
            LButton(
                "Keep songs · ${Formatting.bytes(bytes)}",
                onKeep, icon = PlayerIcons.Download, enabled = !tooBig, primary = own && !tooBig, modifier = if (own) Modifier.focusRequester(first) else Modifier,
            )
        }
    }
}

@Composable
internal fun PhoneDialog(graph: Graph, onDismiss: () -> Unit) {
    var running by remember { mutableStateOf<PhoneSetupServer.Running?>(null) }
    var tried by remember { mutableStateOf(false) }
    val synced by graph.playlistStore.playlists.collectAsStateWithLifecycle()
    val start = remember { synced.size }
    LaunchedEffect(Unit) {
        running = graph.phoneSetup.start()
        tried = true
    }
    DisposableEffect(Unit) { onDispose { graph.phoneSetup.stop() } }

    LDialog(onDismiss = onDismiss, width = 720.dp) {
        Text("Add from your phone", style = LuminaText.DialogTitle)
        val r = running
        if (r != null) {
            // The QR code carries the address AND the PIN, so scanning it opens the page ready to paste into: nothing to type.
            Row(horizontalArrangement = Arrangement.spacedBy(28.dp), verticalAlignment = Alignment.CenterVertically) {
                QrCode(r.url + "?k=" + r.pin, size = 200.dp)
                Column(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.weight(1f)) {
                    Text("Scan with your phone's camera", style = LuminaText.Row)
                    Text("Paste a playlist link on the page that opens. Same Wi-Fi.", style = LuminaText.Body)
                    Text("Or open ${r.url} · PIN ${r.pin}", style = LuminaText.Small)
                }
            }
            if (synced.size > start) Text("✓ Added: ${synced.last().title}", style = LuminaText.Row.copy(color = LuminaColors.Ok))
        } else if (tried) {
            Text("The TV isn't on a network. Connect to Wi-Fi and try again.", style = LuminaText.Body.copy(color = LuminaColors.Danger))
        }
    }
}
