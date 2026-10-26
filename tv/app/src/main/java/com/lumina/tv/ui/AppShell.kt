package com.lumina.tv.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.material.icons.filled.PlaylistPlay
import androidx.compose.foundation.background
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.clickable
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.runtime.Composable
import kotlinx.coroutines.launch
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.zIndex
import kotlinx.coroutines.delay
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.Icon
import androidx.tv.material3.Text
import com.lumina.tv.Graph
import com.lumina.tv.data.MediaKind

enum class Screen(val label: String, val icon: ImageVector) {
    Home("Home", Icons.Filled.Home),
    Search("Search", Icons.Filled.Search),
    Library("Library", Icons.Filled.LibraryMusic),
    Settings("Settings", Icons.Filled.Settings),
}

/** A full-screen player that sits above whatever screen you were on. */
enum class Overlay { NowPlaying, Video }

@Composable
fun AppShell(graph: Graph, externalQuery: String?, onExternalQueryHandled: () -> Unit) {
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    // Where Lumina opens is a setting (Home, Music or Videos); read once, so changing it takes effect the next time it opens.
    val startPage = remember { graph.settings.startPage }
    remember(graph) { LiveSettings.ambientColour = graph.settings.ambientColour }
    var screen by rememberSaveable { mutableStateOf(if (startPage == 0) Screen.Home else Screen.Library) }
    var overlay by remember { mutableStateOf<Overlay?>(null) }
    var searchSeed by remember { mutableStateOf<String?>(null) }
    var librarySection by rememberSaveable { mutableStateOf(if (startPage == 2) LibrarySection.Videos else LibrarySection.Music) }
    val goLibrary: (LibrarySection) -> Unit = { librarySection = it; screen = Screen.Library }

    // A playlist opened from a card takes the place of the page under the top row; Back or any top button leaves it.
    var playlistRef by remember { mutableStateOf<PlaylistRef?>(null) }
    // An artist's page takes the same place, and Back closes it the same way.
    var artistRef by remember { mutableStateOf<ArtistRef?>(null) }
    var musicTab by rememberSaveable { mutableStateOf(MusicTab.ForYou) }
    // Liked songs is a playlist-like page opened from a tile among the playlists.
    var likedOpen by remember { mutableStateOf(false) }

    // Who is using the app. Whether they are signed in is read from the auth store again whenever the account's
    // playlists change, which happens on every sign-in and sign-out, wherever it was done.
    val accountState by graph.accountPlaylists.flow.collectAsStateWithLifecycle()
    var signedIn by remember { mutableStateOf(graph.google.signedIn) }
    LaunchedEffect(accountState) { signedIn = graph.google.signedIn }
    var nameVersion by remember { mutableStateOf(0) }
    val profile = rememberProfile(graph, signedIn, nameVersion)
    var profileOpen by remember { mutableStateOf(false) }
    var renaming by remember { mutableStateOf(false) }
    var signingIn by remember { mutableStateOf(false) }
    var welcome by remember { mutableStateOf(!graph.settings.onboarded && !graph.google.signedIn) }
    val finishSignIn: () -> Unit = {
        signedIn = graph.google.signedIn
        signingIn = false
        graph.settings.onboarded = true
        welcome = false
        scope.launch { graph.accountPlaylists.load(force = true) }
    }

    val now by graph.player.now.collectAsStateWithLifecycle()
    val error by graph.player.error.collectAsStateWithLifecycle()
    val jobs by graph.downloads.jobs.collectAsStateWithLifecycle()

    // Read the saved library, and pick up anything that was copied into the media folders by hand.
    LaunchedEffect(Unit) {
        graph.library.load()
        graph.library.adoptUntracked(graph.storage.allMediaDirs())
    }

    // A search handed over by the system (voice command) opens Search and runs it.
    LaunchedEffect(externalQuery) {
        if (externalQuery != null) {
            searchSeed = externalQuery
            // Close a full-screen player first (the music carries on): otherwise the results appear underneath it.
            overlay = null
            screen = Screen.Search
            onExternalQueryHandled()
        }
    }

    // Nothing playing any more (stopped, or failed to start): there is nothing for a player screen to show.
    LaunchedEffect(now) { if (now == null) overlay = null }

    // A full-screen player never has a keyboard over it.
    val keyboard = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
    LaunchedEffect(overlay) { if (overlay != null) keyboard?.hide() }

    val openPlayer: (MediaKind) -> Unit = { overlay = if (it == MediaKind.VIDEO) Overlay.Video else Overlay.NowPlaying }

    // Back, in order of what is on top: a full-screen video stops (it cannot play behind other
    // screens); the music screen just steps aside and the music carries on; any other screen goes
    // Home first, and only Home lets Back leave the app.
    BackHandler(enabled = overlay != null) {
        if (overlay == Overlay.Video) graph.player.stop()
        overlay = null
    }
    // Going Home with Back hands the remote to Home: the screen it leaves takes the focused element with it, and the sidebar
    // would otherwise be left holding the remote, open over the page, when the person only asked to go back. Home takes it
    // (where it belongs, on the mosaic) as soon as it is ready; the next key press ends this, so the sidebar stays reachable.
    var backToHome by remember { mutableStateOf(false) }
    BackHandler(enabled = overlay == null && screen != Screen.Home) {
        screen = Screen.Home
        backToHome = true
    }
    // Registered after the one above, so it is asked first: Back closes an open playlist before it leaves the page.
    BackHandler(enabled = overlay == null && playlistRef != null) { playlistRef = null }
    BackHandler(enabled = overlay == null && playlistRef == null && artistRef != null) { artistRef = null }
    BackHandler(enabled = overlay == null && playlistRef == null && artistRef == null && likedOpen) { likedOpen = false }

    // After a full-screen player closes, put focus back on what it was on before — the Play button
    // that was pressed — instead of letting it fall to the first thing on screen (the rail's Home).
    val contentFocus = remember { FocusRequester() }
    var hadOverlay by remember { mutableStateOf(false) }
    LaunchedEffect(overlay) {
        if (overlay != null) {
            hadOverlay = true
        } else if (hadOverlay) {
            hadOverlay = false
            delay(60)
            runCatching { contentFocus.requestFocus() }
        }
    }

    // A drive plugged in while the app is open: say so, and offer to use it, instead of leaving it to be found in Settings.
    val drives by graph.storage.rootsFlow.collectAsStateWithLifecycle()
    var offered by remember { mutableStateOf<com.lumina.tv.data.Storage.Root?>(null) }
    // Remembered on disk, not in screen state: mounting a drive makes the system put the app in the background, and
    // the screen may be rebuilt when it returns, which used to forget the drive had just arrived.
    LaunchedEffect(drives) {
        val fresh = drives.firstOrNull { it.removable && it.id !in graph.settings.askedDrives }
        if (fresh != null) offered = fresh
    }
    fun resolveOffer(drive: com.lumina.tv.data.Storage.Root, use: Boolean) {
        graph.settings.askedDrives = graph.settings.askedDrives + drive.id
        offered = null
        if (use) {
            graph.settings.storageRoot = drive.id
            scope.launch { graph.library.adoptUntracked(graph.storage.allMediaDirs()); graph.library.load() }
        }
    }

    // The page takes its colour from the artwork of what is playing, else your latest saved item.
    val library by graph.library.items.collectAsStateWithLifecycle()

    // Everything that starts playing, saved or streamed, goes into the local history (Home's "Recently played" and Music's
    // History). Recorded here, in one place, so no screen has to remember to do it.
    LaunchedEffect(now?.id) {
        val n = now ?: return@LaunchedEffect
        val url = n.sourceUrl ?: library.firstOrNull { it.id == n.id }?.sourceUrl
        if (graph.settings.saveHistory && !url.isNullOrBlank()) graph.history.record(com.lumina.tv.data.Track(url, n.title, n.artist, 0, n.thumbnail, n.kind))
    }
    val ambientArt = now?.thumbnail ?: library.firstOrNull()?.thumbPath?.let { "file://$it" }
    // While a song plays, the pages leave room for the little player at the bottom instead of sliding under it.
    val miniVisible = overlay == null && now?.kind == MediaKind.AUDIO
    val bottomInset by animateDpAsState(27.dp + if (miniVisible) 84.dp else 0.dp, tween(260), label = "mini-inset")
    // One accent colour for the whole app, taken from the same artwork as the page tint, eased over a second so a
    // new song recolours the focus glow and buttons gently rather than flicking them.
    val artworkTint = rememberArtworkColor(ambientArt)
    val artTint = if (LiveSettings.ambientColour) artworkTint else null
    val accent by androidx.compose.animation.animateColorAsState(artTint?.let(::accentOf) ?: Accent.Default, tween(900), label = "accent")
    androidx.compose.runtime.SideEffect { Accent.color = accent }
    // Which sidebar entry is lit: Home, Search and Settings are pages of their own; Music, Videos, Playlists and
    // Downloads are the four sections of the Library page, so each lights while its section is open.
    val selectedRail: RailItem = when (screen) {
        Screen.Home -> RailItem.Home
        Screen.Search -> RailItem.Search
        Screen.Settings -> RailItem.Settings
        Screen.Library -> when (librarySection) {
            LibrarySection.Music -> RailItem.Music
            LibrarySection.Videos -> RailItem.Videos
            LibrarySection.Playlists -> RailItem.Playlists
            LibrarySection.Downloads -> RailItem.Downloads
        }
    }
    // Opens the page of a sidebar entry. Resting on an entry does only this (the remote stays on the sidebar, so the next
    // press can go to the next entry); pressing Select does this and then hands the remote to the page.
    val openRail: (RailItem) -> Unit = { item ->
        playlistRef = null
        artistRef = null
        likedOpen = false
        when (item) {
            RailItem.Search -> screen = Screen.Search
            RailItem.Home -> screen = Screen.Home
            RailItem.Music -> goLibrary(LibrarySection.Music)
            RailItem.Videos -> goLibrary(LibrarySection.Videos)
            RailItem.Playlists -> goLibrary(LibrarySection.Playlists)
            RailItem.Downloads -> goLibrary(LibrarySection.Downloads)
            RailItem.Settings -> screen = Screen.Settings
        }
    }
    val selectRail: (RailItem) -> Unit = { item ->
        openRail(item)
        // Hand the remote to the page after choosing, which also closes the rail back to icons.
        scope.launch { delay(140); runCatching { contentFocus.requestFocus() } }
    }
    var railFocused by remember { mutableStateOf(false) }
    // The system puts focus on the sidebar by itself at launch, and Home is meant to take it from there. Home only holds off
    // once a key has been pressed while the sidebar had focus, i.e. the person is really using it.
    var railUsed by remember { mutableStateOf(false) }
    // Any key press counts as the remote being in use (the sidebar stays shut at launch until then, and Home stops taking focus).
    AmbientBackground(accent = artTint, modifier = Modifier.onPreviewKeyEvent { railUsed = true; backToHome = false; false }) {
        // 27dp top and bottom, 48dp at the right, and on the left the shut sidebar plus a gap: the safe area TVs need,
        // because many crop the edge of the picture. The sidebar itself is drawn over this, further down.
        Column(Modifier.fillMaxSize().padding(start = RailCollapsedWidth + 12.dp, end = 48.dp, top = 27.dp, bottom = bottomInset)) {
            Box(Modifier.weight(1f).fillMaxWidth().focusRequester(contentFocus).focusRestorer()) {
                val openPlaylist: (PlaylistRef) -> Unit = { playlistRef = it }
                val openArtist: (ArtistRef) -> Unit = { artistRef = it }
                val shownPlaylist = playlistRef
                val shownArtist = artistRef
                if (shownPlaylist != null) {
                    PlaylistScreen(graph, shownPlaylist, open = openPlayer)
                } else if (shownArtist != null) {
                    ArtistScreen(graph, shownArtist, open = openPlayer, openPlaylist = openPlaylist)
                } else if (likedOpen) {
                    LikedScreen(graph, open = openPlayer)
                } else {
                    // A short crossfade, so changing screen reads as a transition and not a cut.
                    Crossfade(targetState = screen, animationSpec = tween(220), label = "screen") { current ->
                        when (current) {
                            Screen.Home -> androidx.compose.runtime.CompositionLocalProvider(LocalRailFocused provides { railFocused && railUsed && !backToHome }) {
                                HomeScreen(
                                    graph, onGoSearch = { screen = Screen.Search }, onGoLibrary = goLibrary,
                                    open = openPlayer, openPlaylist = openPlaylist, openArtist = openArtist, openLiked = { likedOpen = true },
                                )
                            }
                            Screen.Search -> SearchScreen(graph, seed = searchSeed, onSeedHandled = { searchSeed = null }, open = openPlayer)
                            Screen.Library -> LibraryScreen(
                                graph, librarySection, onSection = { librarySection = it }, open = openPlayer, openPlaylist = openPlaylist,
                                musicTab = musicTab, onMusicTab = { musicTab = it }, openArtist = openArtist, openLiked = { likedOpen = true },
                            )
                            Screen.Settings -> SettingsScreen(graph, openProfile = { profileOpen = true })
                        }
                    }
                }
            }
        }
        // The sidebar, over the left edge of the page. Above the content (zIndex) so that when it opens it covers the
        // first cards instead of pushing them.
        SideRail(
            selected = selectedRail, activeDownloads = jobs.count { it.active }, profile = profile,
            onProfile = { profileOpen = true }, onSelect = selectRail, onRest = openRail,
            modifier = Modifier.align(Alignment.CenterStart).zIndex(2f).onFocusChanged { railFocused = it.hasFocus },
            revealed = railUsed,
        )
        val current = now
        if (miniVisible && current != null) {
            MiniPlayer(graph, current, onOpen = { overlay = Overlay.NowPlaying }, modifier = Modifier.align(Alignment.BottomEnd).padding(end = 48.dp, bottom = 27.dp).zIndex(1f))
        }

        ErrorBanner(error, onDismiss = graph.player::clearError, modifier = Modifier.align(Alignment.TopCenter))

        offered?.let { drive ->
            LDialog(onDismiss = { resolveOffer(drive, use = false) }, width = 700.dp) {
                Text("USB drive found", style = LuminaText.DialogTitle)
                Text(
                    "${if (drive.totalBytes > 0) "${com.lumina.tv.core.Formatting.bytes(drive.freeBytes)} free of ${com.lumina.tv.core.Formatting.bytes(drive.totalBytes)}. " else ""}Save new downloads on it?",
                    style = LuminaText.Body,
                )
                Text("Songs and videos already on this stick stay where they are and keep playing. You can change this any time in Settings.", style = LuminaText.Small)
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    LButton("Use this drive", onClick = { resolveOffer(drive, use = true) }, primary = true)
                    LButton("Not now", onClick = { resolveOffer(drive, use = false) })
                }
            }
        }

        if (profileOpen) {
            ProfileDialog(
                profile, onDismiss = { profileOpen = false },
                onSignIn = { profileOpen = false; signingIn = true },
                onRename = { profileOpen = false; renaming = true },
                onSignOut = {
                    graph.google.signOut()
                    graph.accountPlaylists.clear()
                    signedIn = false
                    profileOpen = false
                },
            )
        }
        if (renaming) {
            NameDialog(
                title = "Your name", body = "Your initials are your picture until you sign in with YouTube.",
                initial = graph.settings.profileName.orEmpty(),
                onDone = { graph.settings.profileName = it; nameVersion++; renaming = false },
                onDismiss = { renaming = false },
            )
        }
        if (signingIn) SignInDialog(graph, onFinished = finishSignIn, onDismiss = { signedIn = graph.google.signedIn; signingIn = false })
        // First start only: a name for the picture, or sign in, or skip. Answered once, never asked again.
        if (welcome && !signingIn) {
            NameDialog(
                title = "Welcome to Lumina", body = "What should we call you? Your initials become your picture until you sign in with YouTube.",
                initial = "",
                onDone = { graph.settings.profileName = it; graph.settings.onboarded = true; nameVersion++; welcome = false },
                onDismiss = { graph.settings.onboarded = true; welcome = false },
                extra = { LButton("Sign in with YouTube", { signingIn = true }) },
            )
        }

        // Never over a video or the music screen: an update can wait until the person is not mid-song.
        UpdatePrompt(graph, canShow = overlay == null && now == null)

        // Above everything else, or the pages show through a full-screen player.
        Box(Modifier.fillMaxSize().zIndex(5f)) {
            when (overlay) {
                Overlay.NowPlaying -> now?.let {
                    NowPlayingScreen(
                        graph, it, onClose = { overlay = null },
                        // The same song as a video, from the same moment in it.
                        onWatch = { t, positionMs -> graph.player.playStream(t.copy(kind = MediaKind.VIDEO), positionMs); overlay = Overlay.Video },
                    )
                }
                Overlay.Video -> now?.let { VideoScreen(graph, it, onExit = { graph.player.stop(); overlay = null }, onListen = { t, positionMs -> graph.player.playStream(t.copy(kind = MediaKind.AUDIO), positionMs); overlay = Overlay.NowPlaying }) }
                null -> Unit
            }
        }
    }
}

/** The glass the little player is made of: a translucent panel with a fine light edge. */
private val GlassFill = Color(0xCC2A2933)
private val GlassEdge = Color(0x0FFFFFFF)

/**
 * What is playing, as a small glass capsule at the bottom right: cover, title, a thin progress line and one
 * play/pause button. Select anywhere else on it opens the full music page. It is a corner of the page, not a bar across it.
 */
@Composable
private fun MiniPlayer(graph: Graph, now: com.lumina.tv.player.PlaybackController.Now, onOpen: () -> Unit, modifier: Modifier = Modifier) {
    val ui = rememberPlayerUi(graph.player.player)
    val shape = RoundedCornerShape(40.dp)
    Row(
        modifier
            .width(540.dp)
            .clip(shape)
            .background(GlassFill)
            .border(1.dp, GlassEdge, shape)
            .padding(start = 10.dp, end = 12.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        FocusSurface(onClick = onOpen, modifier = Modifier.weight(1f), shape = RoundedCornerShape(30.dp), scaleOnFocus = 1.0f) {
            Row(Modifier.padding(4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Thumb(now.thumbnail, now.kind, Modifier.size(58.dp), shape = RoundedCornerShape(16.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(now.title, style = LuminaText.Row.copy(fontSize = 17.sp), maxLines = 1)
                    Text(now.artist.ifBlank { if (now.streaming) "Streaming" else "Saved on this device" }, style = LuminaText.Small.copy(fontSize = 14.sp), maxLines = 1)
                    Box(Modifier.fillMaxWidth().height(3.dp).clip(RoundedCornerShape(2.dp)).background(Color.White.copy(alpha = 0.14f))) {
                        Box(Modifier.fillMaxWidth(ui.fraction).height(3.dp).background(LuminaColors.Amber))
                    }
                }
            }
        }
        LIconButton(if (ui.isPlaying) PlayerIcons.Pause else PlayerIcons.Play, if (ui.isPlaying) "Pause" else "Play", onClick = graph.player::togglePlay, size = 54.dp)
    }
}

/** A problem worth knowing about, shown at the top where a TV viewer is already looking, and dismissed by itself. */
@Composable
private fun ErrorBanner(message: String?, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    LaunchedEffect(message) {
        if (message != null) {
            kotlinx.coroutines.delay(9000)
            onDismiss()
        }
    }
    if (message != null) {
        Box(modifier.padding(top = 36.dp).background(LuminaColors.SurfaceHigh, RoundedCornerShape(14.dp)).padding(horizontal = 28.dp, vertical = 16.dp)) {
            Text(message, style = LuminaText.Row.copy(color = LuminaColors.Amber))
        }
    }
}
