package com.lumina.tv.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.PlaylistPlay
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusRestorer
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Icon
import androidx.tv.material3.Text

/**
 * The left sidebar, modelled on the real YouTube TV app (docs/18 §1.1, checked live on a Fire TV Stick):
 *
 *  - at rest it is a narrow column of bare icons that takes almost no room, so the pictures lead;
 *  - the moment the remote moves onto it, it widens in place and every icon gains its name, and the row the remote is
 *    on becomes a light pill with dark text;
 *  - a hairline divides where you go (Search, Home) from what you keep (Music, Videos, Playlists, Downloads);
 *  - your picture is at the top, and Settings is pinned to the bottom, away from everything else.
 *
 * It is drawn over the page, not beside it: widening it never moves or reflows the cards behind it, which on a stick
 * with 2 GB of memory is the difference between smooth and juddering.
 */
enum class RailItem(val label: String, val icon: ImageVector) {
    Search("Search", Icons.Filled.Search),
    Home("Home", Icons.Filled.Home),
    Music("Music", Icons.Filled.MusicNote),
    Videos("Videos", Icons.Filled.VideoLibrary),
    Playlists("Playlists", Icons.Filled.PlaylistPlay),
    Downloads("Downloads", Icons.Filled.Download),
    Settings("Settings", Icons.Filled.Settings),
}

/** How wide the rail is at rest. The page's left padding is this plus a gap, so the pictures start just beyond it. */
val RailCollapsedWidth = 92.dp
private val RailExpandedWidth = 330.dp

private val PillLight = Color(0xFFF1F1F1)

/**
 * Whether the remote is on the sidebar right now. A page that grabs focus when it opens (Home does) checks this first,
 * so that opening a page by resting on its sidebar entry never pulls the remote off the sidebar.
 */
val LocalRailFocused = androidx.compose.runtime.staticCompositionLocalOf<() -> Boolean> { { false } }

/** How long the remote rests on an entry before its page opens by itself, long enough that scrolling past does not open pages. */
private const val DWELL_MS = 250L

/** Entries whose page opens by resting on them. Search (opens a keyboard) and Settings only open on Select. */
private fun RailItem.opensOnRest() = this != RailItem.Search && this != RailItem.Settings

@Composable
fun SideRail(
    selected: RailItem?,
    activeDownloads: Int,
    profile: Profile,
    onProfile: () -> Unit,
    onSelect: (RailItem) -> Unit,
    modifier: Modifier = Modifier,
    onRest: (RailItem) -> Unit = {},
    /** False until the remote has been used: the system puts focus on the rail at launch, and it must not spring open then. */
    revealed: Boolean = true,
) {
    // Expanded exactly while the remote is anywhere on the rail (and has been used, so launch is not a sidebar opening).
    var hasFocus by remember { mutableStateOf(false) }
    val expanded = hasFocus && revealed
    val width by animateDpAsState(if (expanded) RailExpandedWidth else RailCollapsedWidth, tween(220), label = "rail-width")
    // Nearly opaque, so the page behind never shows through the names.
    val scrim by animateColorAsState(if (expanded) Color(0xFC121218) else Color.Transparent, tween(220), label = "rail-scrim")
    // The remote lands on the page you are on, not on whatever row happens to be level with the card it came from.
    val landing = remember { androidx.compose.ui.focus.FocusRequester() }
    fun landOn(item: RailItem): Modifier = if (item == selected) Modifier.focusRequester(landing) else Modifier
    // Directional focus enters the rail at whichever row is level with the card the remote was on (checked on the
    // stick: it landed on Playlists from the first row of Home). So the moment the rail takes focus, move it to the
    // open page's entry, as YouTube does. Keyed on `expanded` so it happens once per visit, not on every move inside it.
    androidx.compose.runtime.LaunchedEffect(expanded) {
        if (expanded) runCatching { landing.requestFocus() }
    }

    Column(
        modifier
            .fillMaxHeight()
            .width(width)
            .onFocusChanged { hasFocus = it.hasFocus }
            .background(scrim)
            .focusRestorer(landing)
            .padding(start = 12.dp, end = 12.dp, top = 27.dp, bottom = 27.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        RailProfile(profile, expanded, onProfile)
        Spacer(Modifier.height(14.dp))
        RailEntry(RailItem.Search, selected == RailItem.Search, expanded, 0, landOn(RailItem.Search), onRest) { onSelect(RailItem.Search) }
        RailEntry(RailItem.Home, selected == RailItem.Home, expanded, 0, landOn(RailItem.Home), onRest) { onSelect(RailItem.Home) }

        // The line between "where to go" and "what you keep".
        Box(Modifier.padding(vertical = 10.dp, horizontal = 8.dp).fillMaxWidth().height(1.dp).background(Color.White.copy(alpha = 0.16f)))

        RailEntry(RailItem.Music, selected == RailItem.Music, expanded, 0, landOn(RailItem.Music), onRest) { onSelect(RailItem.Music) }
        RailEntry(RailItem.Videos, selected == RailItem.Videos, expanded, 0, landOn(RailItem.Videos), onRest) { onSelect(RailItem.Videos) }
        RailEntry(RailItem.Playlists, selected == RailItem.Playlists, expanded, 0, landOn(RailItem.Playlists), onRest) { onSelect(RailItem.Playlists) }
        RailEntry(RailItem.Downloads, selected == RailItem.Downloads, expanded, activeDownloads, landOn(RailItem.Downloads), onRest) { onSelect(RailItem.Downloads) }

        Spacer(Modifier.weight(1f))
        RailEntry(RailItem.Settings, selected == RailItem.Settings, expanded, 0, landOn(RailItem.Settings), onRest) { onSelect(RailItem.Settings) }
    }
}

/** Your picture, and your name when the rail is open. Select opens the account dialog. */
@Composable
private fun RailProfile(profile: Profile, expanded: Boolean, onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(28.dp)
    Row(
        Modifier.fillMaxWidth().height(56.dp)
            .onFocusChanged { focused = it.isFocused }
            .clip(shape)
            .background(if (focused) PillLight else Color.Transparent, shape)
            .clickable(onClick = onClick)
            .padding(start = 14.dp, end = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Avatar(profile, 40.dp, if (focused) Modifier.border(2.dp, LuminaColors.Bg, CircleShape) else Modifier)
        if (expanded) {
            Text(
                profile.name?.takeIf { it.isNotBlank() } ?: "Sign in",
                style = LuminaText.Row.copy(color = if (focused) LuminaColors.Bg else LuminaColors.Ink), maxLines = 1, softWrap = false,
            )
        }
    }
}

/**
 * One destination. The icon never moves (it sits at the same spot whether the rail is open or shut); only the name
 * appears beside it. The open page's entry carries a short bar of the accent colour at the edge, so you can tell where you
 * are even with the rail shut.
 */
@Composable
private fun RailEntry(item: RailItem, selected: Boolean, expanded: Boolean, badge: Int, landing: Modifier, onRest: (RailItem) -> Unit, onClick: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    // Resting on an entry opens its page without moving the remote off the sidebar (as on YouTube). Leaving before the
    // wait ends cancels it, and the page that is already open is not opened again.
    androidx.compose.runtime.LaunchedEffect(focused, selected) {
        if (focused && !selected && item.opensOnRest()) {
            kotlinx.coroutines.delay(DWELL_MS)
            onRest(item)
        }
    }
    val shape = RoundedCornerShape(28.dp)
    val fill = when {
        focused -> PillLight
        selected && expanded -> Color.White.copy(alpha = 0.13f)
        else -> Color.Transparent
    }
    val ink = when {
        focused -> LuminaColors.Bg
        selected -> LuminaColors.Ink
        else -> LuminaColors.Ink2
    }
    Box(Modifier.fillMaxWidth().height(56.dp)) {
        Row(
            Modifier.matchParentSize()
                .then(landing)
                .onFocusChanged { focused = it.isFocused }
                .clip(shape)
                .background(fill, shape)
                .clickable(onClick = onClick)
                .padding(start = 20.dp, end = 18.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Box {
                Icon(item.icon, contentDescription = item.label, tint = ink, modifier = Modifier.size(28.dp))
                // A small dot on the icon while something is downloading, so it can be seen with the rail shut.
                if (badge > 0 && !expanded) Box(Modifier.align(Alignment.TopEnd).size(10.dp).background(LuminaColors.Amber, CircleShape))
            }
            if (expanded) {
                Text(item.label, style = LuminaText.Row.copy(fontSize = 21.sp, color = ink), maxLines = 1, softWrap = false, modifier = Modifier.weight(1f))
                if (badge > 0) {
                    Text(
                        "$badge", style = LuminaText.Small.copy(color = LuminaColors.Bg, fontSize = 15.sp),
                        modifier = Modifier.background(LuminaColors.Amber, CircleShape).padding(horizontal = 10.dp, vertical = 2.dp),
                    )
                }
            }
        }
        if (selected && !focused) {
            Box(Modifier.align(Alignment.CenterStart).size(width = 4.dp, height = 26.dp).background(LuminaColors.Amber, CircleShape))
        }
    }
}
