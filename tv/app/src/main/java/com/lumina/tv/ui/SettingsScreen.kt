package com.lumina.tv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Icon
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlaylistPlay
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.ClosedCaption
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.Equalizer
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.Memory
import androidx.compose.material.icons.filled.SortByAlpha
import androidx.compose.material.icons.filled.TextFields
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material.icons.filled.Translate
import androidx.compose.material.icons.filled.Tune
import com.lumina.tv.core.EqPreset
import com.lumina.tv.core.StreamPicker
import androidx.compose.material.icons.filled.HighQuality
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Storage
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material.icons.filled.Usb
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.Text
import com.lumina.tv.BuildConfig
import com.lumina.tv.Graph
import com.lumina.tv.core.Countries
import com.lumina.tv.core.Formatting
import com.lumina.tv.data.AppSettings
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.util.Locale

/** The categories of Settings, shown as a list on the left; the rows of the one that is open fill the right. */
private enum class SettingsTab(val label: String, val icon: ImageVector) {
    Account("Account", Icons.Filled.Person),
    Playlists("Playlists", Icons.Filled.PlaylistPlay),
    Music("Music", Icons.Filled.MusicNote),
    Videos("Videos", Icons.Filled.VideoLibrary),
    Sound("Sound", Icons.Filled.GraphicEq),
    Downloads("Downloads", Icons.Filled.Download),
    Display("Display", Icons.Filled.Tune),
    Privacy("Privacy", Icons.Filled.Lock),
    Updates("Updates", Icons.Filled.SystemUpdate),
    About("About", Icons.Filled.Info),
}

/**
 * The real YouTube TV Settings screen (docs/18 §1.5, checked live): a list down the left, its rows gathered under small
 * grey uppercase headers, and a detail pane on the right. Every row in the pane is built the same way (see PanelRow in
 * PageKit.kt): the same height, an icon tile, a switch for on/off and the value at the right.
 */
private val settingsGroups = listOf(
    "YOU" to listOf(SettingsTab.Account, SettingsTab.Playlists),
    "LISTEN AND WATCH" to listOf(SettingsTab.Music, SettingsTab.Videos, SettingsTab.Sound),
    "THIS DEVICE" to listOf(SettingsTab.Downloads, SettingsTab.Display, SettingsTab.Privacy),
    "SYSTEM" to listOf(SettingsTab.Updates, SettingsTab.About),
)

@Composable
fun SettingsScreen(graph: Graph, openProfile: () -> Unit) {
    var tab by rememberSaveable { mutableStateOf(SettingsTab.Account) }
    Row(Modifier.fillMaxSize()) {
        // Left: the list. Moving the remote down it changes the pane on the right at once, as YouTube's does.
        Column(Modifier.width(400.dp).fillMaxHeight().verticalScroll(rememberScrollState()).padding(end = 24.dp, bottom = 24.dp)) {
            Text("Settings", style = LuminaText.Display.copy(fontSize = 38.sp), modifier = Modifier.padding(start = 6.dp, bottom = 10.dp))
            settingsGroups.forEachIndexed { index, (header, tabs) ->
                Text(
                    header, style = LuminaText.Small.copy(fontSize = 13.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold, letterSpacing = 1.4.sp),
                    modifier = Modifier.padding(start = 20.dp, top = if (index == 0) 2.dp else 18.dp, bottom = 4.dp),
                )
                for (t in tabs) SettingsListRow(t.label, t.icon, selected = t == tab, onFocus = { tab = t })
            }
        }
        Box(Modifier.width(1.dp).fillMaxHeight().background(LuminaColors.Hairline))
        // Right: the detail pane.
        Column(Modifier.weight(1f).fillMaxHeight().verticalScroll(rememberScrollState()).padding(start = 32.dp, top = 6.dp, bottom = 28.dp)) {
            Text(tab.label, style = LuminaText.Title.copy(fontSize = 28.sp), modifier = Modifier.padding(start = 6.dp, bottom = 14.dp))
            when (tab) {
                SettingsTab.Account -> AccountPanel(graph, openProfile)
                SettingsTab.Playlists -> PlaylistsPanel(graph)
                SettingsTab.Music -> MusicPanel(graph)
                SettingsTab.Videos -> PlaybackPanel(graph)
                SettingsTab.Sound -> SoundPanel(graph)
                SettingsTab.Downloads -> StoragePanel(graph)
                SettingsTab.Display -> GeneralPanel(graph)
                SettingsTab.Privacy -> PrivacyPanel(graph)
                SettingsTab.Updates -> UpdateSettings(graph)
                SettingsTab.About -> { AboutPanel(); Box(Modifier.height(18.dp)); StreamingPanel(graph) }
            }
        }
    }
}

/** One row of the Settings list: icon and name, a light pill while the remote is on it, a faint one while it is the open page. */
@Composable
private fun SettingsListRow(label: String, icon: ImageVector, selected: Boolean, onFocus: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(16.dp)
    val ink = if (focused) LuminaColors.Bg else if (selected) LuminaColors.Ink else LuminaColors.Ink2
    Row(
        Modifier.fillMaxWidth().height(54.dp)
            .onFocusChanged { focused = it.isFocused; if (it.isFocused) onFocus() }
            .clip(shape)
            .background(if (focused) Color(0xFFF1F1F1) else if (selected) Color.White.copy(alpha = 0.12f) else Color.Transparent, shape)
            .clickable(onClick = onFocus)
            .padding(horizontal = 20.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Icon(icon, contentDescription = null, tint = ink, modifier = Modifier.size(25.dp))
        Text(label, style = LuminaText.Row.copy(fontSize = 19.sp, color = ink), maxLines = 1)
    }
}

/** Who is using Lumina: the name and the YouTube account, both managed in the account popup (also behind your picture in the sidebar). */
@Composable
private fun AccountPanel(graph: Graph, openProfile: () -> Unit) {
    val signedIn = graph.google.signedIn
    Panel {
        PanelRow(
            "Name", icon = Icons.Filled.Person, value = graph.settings.profileName?.takeIf { it.isNotBlank() } ?: "Guest", chevron = true, divided = false,
            detail = "What Lumina calls you. Also shown behind your picture in the sidebar.", onClick = openProfile,
        )
        PanelRow(
            "YouTube account", icon = Icons.Filled.PlaylistPlay, value = if (signedIn) "Signed in" else "Not signed in", highlight = signedIn, chevron = true,
            detail = if (signedIn) "Your own playlists show on Home and under Playlists. Sign out from here." else "Sign in to see your own playlists, private ones included.", onClick = openProfile,
        )
    }
}

/** Adding and refreshing playlists: the phone page and a refresh of every playlist that was added by link. */
@Composable
private fun PlaylistsPanel(graph: Graph) {
    val scope = rememberCoroutineScope()
    var phone by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    var refreshed by remember { mutableStateOf<String?>(null) }
    if (phone) PhoneDialog(graph, onDismiss = { phone = false })
    Panel {
        PanelRow(
            "Add from your phone", icon = Icons.Filled.PhoneAndroid, chevron = true, divided = false,
            detail = "Shows a code to scan with your phone's camera, then paste a playlist link there.", onClick = { phone = true },
        )
        PanelRow(
            "Refresh added playlists", icon = Icons.Filled.Refresh, value = if (refreshing) "Refreshing…" else refreshed,
            detail = "Looks again at every playlist added by link: new songs, a new name or cover.",
            onClick = {
                if (refreshing) return@PanelRow
                refreshing = true; refreshed = null
                scope.launch {
                    val all = graph.playlistStore.playlists.value
                    var failed = 0
                    for (p in all) try { graph.playlists.sync(p.id) } catch (e: CancellationException) { throw e } catch (e: Throwable) { failed++ }
                    refreshed = if (all.isEmpty()) "None added" else if (failed == 0) "Done" else "$failed failed"
                    refreshing = false
                }
            },
        )
    }
}

/** What Lumina remembers about what you did, and the buttons to forget it. */
@Composable
private fun PrivacyPanel(graph: Graph) {
    val settings = graph.settings
    val scope = rememberCoroutineScope()
    val context = androidx.compose.ui.platform.LocalContext.current
    var save by remember { mutableStateOf(settings.saveHistory) }
    var historyCleared by remember { mutableStateOf<String?>(null) }
    var searchCleared by remember { mutableStateOf<String?>(null) }
    var imagesCleared by remember { mutableStateOf<String?>(null) }
    Panel {
        PanelRow(
            "Save play history", icon = Icons.Filled.History, toggle = save, highlight = save, divided = false,
            detail = "Home's Recently played and Music > History. Stays on this device. Off: nothing new is remembered.",
            onClick = { save = !save; settings.saveHistory = save },
        )
        PanelRow(
            "Clear play history", icon = Icons.Filled.DeleteSweep, value = historyCleared,
            detail = "Forgets what was played. Your songs, likes and playlists stay.",
            onClick = { graph.history.clear(); historyCleared = "Cleared" },
        )
        PanelRow(
            "Clear search history", icon = Icons.Filled.Search, value = searchCleared,
            detail = "Forgets the searches listed under the search box.",
            onClick = { settings.clearRecentSearches(); searchCleared = "Cleared" },
        )
        PanelRow(
            "Clear picture cache", icon = Icons.Filled.Image, value = imagesCleared,
            detail = "Removes the downloaded covers and thumbnails kept for speed. They load again as needed.",
            onClick = {
                scope.launch {
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                        val loader = coil.Coil.imageLoader(context)
                        loader.memoryCache?.clear()
                        loader.diskCache?.clear()
                    }
                    imagesCleared = "Cleared"
                }
            },
        )
    }
}

@Composable
private fun StoragePanel(graph: Graph) {
    val settings = graph.settings
    val roots by graph.storage.rootsFlow.collectAsStateWithLifecycle()
    var active by remember { mutableStateOf(settings.storageRoot) }
    Panel {
        roots.forEachIndexed { i, root ->
            val selected = root.id == active || (root.id == AppSettings.INTERNAL && roots.none { it.id == active })
            PanelRow(
                title = root.label,
                detail = if (root.totalBytes > 0) "${Formatting.bytes(root.freeBytes)} free of ${Formatting.bytes(root.totalBytes)}" else "Size unknown",
                value = if (selected) "In use" else null, highlight = selected,
                icon = if (root.removable) Icons.Filled.Usb else Icons.Filled.Storage,
                divided = i > 0,
                onClick = { settings.storageRoot = root.id; active = root.id },
            )
        }
        PanelRow("Look for drives again", onClick = { graph.storage.refresh() }, icon = Icons.Filled.Refresh, divided = roots.isNotEmpty())
    }
    PanelNote(
        if (roots.size == 1) {
            "Downloads are saved to the selected place. No USB drive found. A Fire TV Stick has no USB port of its own: a drive goes on a micro-USB OTG adapter " +
                "(one with a power input) in the stick's power socket. A drive in the TV's own USB port can't be seen by the stick. If the stick asks how to use a " +
                "new drive, choose Portable storage (not Internal). FAT32 and exFAT drives work best."
        } else {
            "Downloads are saved to the selected place. The built-in storage on a Fire TV Stick is small; a USB drive is the best home for a real library."
        },
    )
}

/** Where the sound is going, as the system reports it: the HDMI sink or a Bluetooth speaker, and the rate it is mixed at. */
private fun outputSummary(context: android.content.Context): String = try {
    val audio = context.getSystemService(android.content.Context.AUDIO_SERVICE) as android.media.AudioManager
    val devices = audio.getDevices(android.media.AudioManager.GET_DEVICES_OUTPUTS)
    val name = when {
        devices.any { it.type == android.media.AudioDeviceInfo.TYPE_BLUETOOTH_A2DP } -> "Bluetooth speaker"
        devices.any { it.type == android.media.AudioDeviceInfo.TYPE_HDMI || it.type == android.media.AudioDeviceInfo.TYPE_HDMI_ARC } -> "HDMI (your TV or receiver)"
        else -> "Built-in output"
    }
    val rate = audio.getProperty(android.media.AudioManager.PROPERTY_OUTPUT_SAMPLE_RATE)?.toIntOrNull()
    if (rate != null) "$name · ${rate / 1000.0} kHz" else name
} catch (e: Throwable) {
    "Not known"
}

@Composable
private fun SoundPanel(graph: Graph) {
    val settings = graph.settings
    val context = androidx.compose.ui.platform.LocalContext.current
    var quality by remember { mutableStateOf(settings.audioQuality) }
    var eq by remember { mutableStateOf(settings.equalizer) }
    var large by remember { mutableStateOf(settings.audioBufferLarge) }
    Panel {
        PanelRow(
            "Streaming audio quality", icon = Icons.Filled.GraphicEq, value = quality.label, chevron = true, divided = false,
            detail = quality.detail,
            onClick = { quality = StreamPicker.AudioQuality.entries.let { it[(it.indexOf(quality) + 1) % it.size] }.also { settings.audioQuality = it } },
        )
        PanelRow(
            "Equalizer", icon = Icons.Filled.Equalizer, value = eq.label, chevron = true, highlight = eq != EqPreset.OFF,
            detail = eq.detail,
            onClick = {
                eq = EqPreset.entries.let { it[(it.indexOf(eq) + 1) % it.size] }.also {
                    settings.equalizer = it
                    com.lumina.tv.player.PlayerHolder.applyEqualizer(it)
                }
            },
        )
        PanelRow(
            "Large audio buffer", icon = Icons.Filled.Memory, toggle = large, highlight = large,
            detail = "Large keeps 1 to 2 seconds of sound ready, so a busy stick or a weak connection breaks up less. Takes effect the next time Lumina opens.",
            onClick = { large = !large; settings.audioBufferLarge = large },
        )
        PanelInfo("Sound goes to", detail = "As reported by the stick. A Fire TV Stick mixes at 48 kHz.", value = remember { outputSummary(context) })
    }
    PanelNote("Songs and videos you download always keep the best quality. Streaming quality applies from the next song.")
}

@Composable
private fun PlaybackPanel(graph: Graph) {
    val settings = graph.settings
    var playHeight by remember { mutableStateOf(settings.playHeight) }
    var downloadHeight by remember { mutableStateOf(settings.downloadHeight) }
    var subtitleLanguage by remember { mutableStateOf(settings.subtitleLanguage) }
    var subtitleSize by remember { mutableStateOf(settings.subtitleSize) }
    Panel {
        PanelRow(
            "Streaming quality", icon = Icons.Filled.HighQuality, value = "Up to ${playHeight}p", chevron = true, divided = false,
            detail = "The tallest picture to stream. 1080p suits most TVs; higher uses more memory and data.",
            onClick = { playHeight = nextHeight(playHeight).also { settings.playHeight = it } },
        )
        PanelRow(
            "Saved video quality", icon = Icons.Filled.VideoLibrary, value = "Up to ${downloadHeight}p", chevron = true,
            detail = "The tallest picture to keep. Saved videos stay smaller so they fit on the stick.",
            onClick = { downloadHeight = nextHeight(downloadHeight).also { settings.downloadHeight = it } },
        )
        PanelRow(
            "Subtitles", icon = Icons.Filled.ClosedCaption,
            value = subtitleLanguage?.let { Locale.forLanguageTag(it).getDisplayLanguage(Locale.ENGLISH).ifBlank { it } } ?: "Off",
            highlight = subtitleLanguage != null,
            detail = if (subtitleLanguage != null) "Used for the next video that has it. Select to turn off." else "Pick a language in a video's Settings; Lumina remembers it here.",
            onClick = { if (subtitleLanguage != null) { settings.subtitleLanguage = null; subtitleLanguage = null } },
        )
        PanelRow(
            "Subtitle size", icon = Icons.Filled.TextFields, value = listOf("Small", "Medium", "Large")[subtitleSize], chevron = true,
            detail = "How big captions are drawn. Takes effect the next time a video opens.",
            onClick = { subtitleSize = (subtitleSize + 1) % 3; settings.subtitleSize = subtitleSize },
        )
    }
}

@Composable
private fun GeneralPanel(graph: Graph) {
    val settings = graph.settings
    var hide by remember { mutableStateOf(settings.controlsHideSeconds) }
    var opening by remember { mutableStateOf(settings.openingAnimation) }
    var ambient by remember { mutableStateOf(settings.ambientColour) }
    var start by remember { mutableStateOf(settings.startPage) }
    val hideOptions = listOf(3, 4, 6, 10, 20)
    val startNames = listOf("Home", "Music", "Videos")
    Panel {
        PanelRow(
            "Open Lumina on", icon = Icons.Filled.Home, value = startNames[start], chevron = true, divided = false,
            detail = "The page Lumina starts on. Takes effect the next time it opens.",
            onClick = { start = (start + 1) % startNames.size; settings.startPage = start },
        )
        PanelRow(
            "Colour from artwork", icon = Icons.Filled.AutoAwesome, toggle = ambient, highlight = ambient,
            detail = "The page and buttons take the colour of what is playing. Off: one steady colour, a little lighter on a slow stick.",
            onClick = { ambient = !ambient; settings.ambientColour = ambient; LiveSettings.ambientColour = ambient },
        )
        PanelRow(
            "Opening animation", icon = Icons.Filled.PlayCircle, toggle = opening, highlight = opening,
            detail = "The short animation when Lumina opens.",
            onClick = { opening = !opening; settings.openingAnimation = opening },
        )
        PanelRow(
            "Hide controls after", icon = Icons.Filled.Timer, value = "$hide s", chevron = true,
            detail = "How long the player's buttons stay up when you are not pressing anything, on the music and video screens.",
            onClick = { hide = hideOptions[(hideOptions.indexOf(hide).let { if (it < 0) 0 else it + 1 }) % hideOptions.size]; settings.controlsHideSeconds = hide },
        )
    }
}

@Composable
private fun MusicPanel(graph: Graph) {
    val settings = graph.settings
    var country by remember { mutableStateOf(settings.contentCountry) }
    var picking by remember { mutableStateOf(false) }
    var translate by remember { mutableStateOf(settings.lyricsTranslate) }
    var latin by remember { mutableStateOf(settings.lyricsLatin) }
    var cleared by remember { mutableStateOf<String?>(null) }
    if (picking) {
        CountryDialog(current = country, onDismiss = { picking = false }) { c ->
            country = c
            settings.contentCountry = c
            org.schabi.newpipe.extractor.NewPipe.setupLocalization(
                org.schabi.newpipe.extractor.localization.Localization("en", c),
                org.schabi.newpipe.extractor.localization.ContentCountry(c),
            )
            picking = false
        }
    }
    Panel {
        PanelRow(
            "Music from", icon = Icons.Filled.Language, value = (Countries.byCode(country) ?: Countries.all[1]).name, chevron = true, divided = false,
            detail = "The Shuffle button on Home mixes hits from this country first, and searches look there.",
            onClick = { picking = true },
        )
        PanelRow(
            "Translate lyrics", icon = Icons.Filled.Translate, toggle = translate, highlight = translate,
            detail = "For a song in another language, show the English meaning under each line of its lyrics.",
            onClick = { translate = !translate; settings.lyricsTranslate = translate },
        )
        PanelRow(
            "Show lyrics in Latin letters", icon = Icons.Filled.SortByAlpha, toggle = latin, highlight = latin,
            detail = "For lyrics in another script (Hindi, Korean, Arabic...), also show how they are read in English letters.",
            onClick = { latin = !latin; settings.lyricsLatin = latin },
        )
        PanelRow(
            "Clear lyrics cache", icon = Icons.Filled.DeleteSweep, value = cleared, chevron = false,
            detail = "Forgets the lyrics and translations kept on this device. The next song looks them up again.",
            onClick = { val n = graph.lyrics.clearCache(); cleared = if (n == 0) "Done" else "Cleared $n" },
        )
    }
}

@Composable
private fun StreamingPanel(graph: Graph) {
    val scope = rememberCoroutineScope()
    var engine by remember { mutableStateOf<String?>(null) }
    var testing by remember { mutableStateOf(false) }
    Panel {
        PanelRow(
            "Test connection", icon = Icons.Filled.Public, divided = false,
            value = if (testing) "Testing…" else null,
            detail = engine ?: "Search once to check the streaming engine is working.",
            detailColor = when {
                engine == null -> LuminaColors.Ink3
                engine!!.startsWith("Working") -> LuminaColors.Ok
                else -> LuminaColors.Danger
            },
            onClick = {
                if (testing) return@PanelRow
                testing = true
                engine = null
                scope.launch {
                    engine = try {
                        val r = graph.repo.search("test")
                        "Working. Found ${r.songs.size} songs and ${r.videos.size} videos."
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Throwable) {
                        "Not working: ${e.message ?: e.javaClass.simpleName}. If it stays like this, the app needs an update."
                    }
                    testing = false
                }
            },
        )
    }
    PanelNote("Sites change how they work from time to time, which can stop searching until Lumina is updated.")
}

@Composable
private fun AboutPanel() {
    Panel {
        PanelInfo("Lumina TV", value = BuildConfig.VERSION_NAME, divided = false)
        PanelInfo("Streaming engine", value = "NewPipe Extractor ${BuildConfig.EXTRACTOR_VERSION}")
        PanelInfo(
            "Free software",
            detail = "GNU GPL v3. Uses NewPipe Extractor (GPL-3.0), Media3 and OkHttp (Apache-2.0) and Coil (Apache-2.0).",
        )
        PanelInfo(
            "Same files as Lumina for PC",
            detail = "Downloads use the same folders and file names, so a drive moves between them.",
        )
    }
}

/** All the countries in a scrolling grid, opening on the current one. */
@Composable
private fun CountryDialog(current: String, onDismiss: () -> Unit, onPick: (String) -> Unit) {
    val all = Countries.all
    val currentIndex = all.indexOfFirst { it.code == current }.coerceAtLeast(0)
    val state = rememberLazyGridState(initialFirstVisibleItemIndex = (currentIndex / 3) * 3)
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { first.requestFocus() } }
    LDialog(onDismiss = onDismiss, width = 980.dp) {
        Text("Music from", style = LuminaText.DialogTitle)
        LazyVerticalGrid(
            columns = GridCells.Fixed(3), state = state, modifier = Modifier.height(480.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(all, key = { it.code }) { c ->
                LButton(
                    c.name, primary = c.code == current, onClick = { onPick(c.code) },
                    modifier = Modifier.fillMaxWidth().then(if (c.code == current) Modifier.focusRequester(first) else Modifier),
                )
            }
        }
    }
}

/** The next height in the list, wrapping around: one row, no menu, six choices. */
private fun nextHeight(current: Int): Int {
    val list = AppSettings.heights
    val i = list.indexOf(current)
    return list[(if (i < 0) 0 else i + 1) % list.size]
}
