package com.lumina.tv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import com.lumina.tv.data.MediaKind

/*
 * How the players show a menu without giving up the picture: a small popover for a list of settings (it sits above the
 * button that opened it and closes with Back or by pressing that button again), and a slim tray along the bottom for a
 * row of songs (Up next, Related). Neither takes more than a strip of the screen.
 */

/** A small floating card for a list of choices. Place it with an alignment and padding above the control bar. */
@Composable
fun Popover(modifier: Modifier = Modifier, width: Dp = 360.dp, content: @Composable ColumnScope.() -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    Column(
        modifier.width(width).heightIn(max = 430.dp)
            .background(Color(0xF517161D), shape)
            .border(1.dp, LuminaColors.HairlineStrong, shape)
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
        content = content,
    )
}

/** What one card in a tray shows. */
class TrayItem(val title: String, val subtitle: String, val image: String?, val kind: MediaKind = MediaKind.AUDIO)

/**
 * A bottom tray: a title line and a row of covers that scrolls sideways. A soft fade at the top lets the picture above it show
 * through. Put it above the control bar (the caller sets the bottom padding).
 */
@Composable
fun PlayerTray(title: String, subtitle: String?, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier.fillMaxWidth()
            .background(Brush.verticalGradient(0f to Color.Transparent, 0.22f to LuminaColors.Bg.copy(alpha = 0.9f), 1f to LuminaColors.Bg.copy(alpha = 0.96f)))
            .padding(start = 56.dp, end = 56.dp, top = 34.dp, bottom = 10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(title, style = LuminaText.DialogTitle.copy(fontSize = 20.sp))
            if (subtitle != null) Text(subtitle, style = LuminaText.Small)
        }
        content()
    }
}

/**
 * The row of covers in a tray. The card at [current] is marked and holds the remote when the tray opens (and the row starts
 * a little before it), so a long queue opens where you are. Select on a card calls [onPick].
 */
@Composable
fun TrayRow(items: List<TrayItem>, current: Int, accent: Color, onPick: (Int) -> Unit, modifier: Modifier = Modifier) {
    val start = current.coerceIn(0, (items.size - 1).coerceAtLeast(0))
    val state = rememberLazyListState(initialFirstVisibleItemIndex = (start - 1).coerceAtLeast(0))
    val focus = remember { FocusRequester() }
    LaunchedEffect(items.size) { if (items.isNotEmpty()) focus.requestWhenReady() }
    LazyRow(modifier, state = state, horizontalArrangement = Arrangement.spacedBy(16.dp), contentPadding = PaddingValues(vertical = 6.dp)) {
        itemsIndexed(items) { i, item ->
            val isCurrent = i == current
            FocusSurface(
                onClick = { onPick(i) }, shape = RoundedCornerShape(14.dp), scaleOnFocus = 1.03f,
                modifier = if (i == start) Modifier.width(138.dp).focusRequester(focus) else Modifier.width(138.dp),
            ) {
                Column(Modifier.padding(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Box(
                        Modifier.size(126.dp).clip(RoundedCornerShape(10.dp))
                            .border(if (isCurrent) 2.dp else 1.dp, if (isCurrent) accent else LuminaColors.Hairline, RoundedCornerShape(10.dp)),
                    ) {
                        Thumb(item.image, item.kind, Modifier.size(126.dp), shape = RoundedCornerShape(0.dp))
                        if (isCurrent) Box(Modifier.align(Alignment.BottomStart).padding(8.dp).background(Color(0xB3000000), RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 4.dp)) {
                            PlayingBars(accent)
                        }
                    }
                    Text(com.lumina.tv.core.Formatting.caption(item.title), style = LuminaText.Row.copy(fontSize = 15.sp, color = if (isCurrent) accent else LuminaColors.Ink), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (item.subtitle.isNotBlank()) Text(com.lumina.tv.core.Formatting.caption(item.subtitle), style = LuminaText.Small.copy(fontSize = 13.sp), maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

/** Three still bars: "this is the one playing". Still on purpose: nothing animates in a tray, so the sound keeps the processor. */
@Composable
private fun PlayingBars(color: Color) {
    Row(horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.Bottom, modifier = Modifier.size(width = 16.dp, height = 14.dp)) {
        for (h in listOf(9.dp, 14.dp, 6.dp)) Box(Modifier.size(width = 3.dp, height = h).background(color, RoundedCornerShape(1.dp)))
    }
}
