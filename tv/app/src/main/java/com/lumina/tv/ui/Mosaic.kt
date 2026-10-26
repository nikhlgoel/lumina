package com.lumina.tv.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import com.lumina.tv.data.MediaKind
import com.lumina.tv.data.Track

/**
 * The pieces of Home's uneven mix of YouTube's video home and YouTube Music's home. Instead of every item being the same
 * card in the same row, tiles here come in different sizes (a wide video, a tall album, a pair of small ones, a list of
 * songs) and sit side by side at irregular heights, with the caption drawn over the picture.
 */
private val TileCorner = 18.dp

/** One picture tile of any size, its title and a line under it drawn over the lower part of the picture. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MosaicTile(
    imageUrl: String?, kind: MediaKind, title: String, subtitle: String?, width: Dp, height: Dp, onClick: () -> Unit,
    modifier: Modifier = Modifier, duration: String? = null, onFocused: (() -> Unit)? = null,
) {
    var focused by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (focused) 1.03f else 1f, tween(180), label = "tile-scale")
    val shape = RoundedCornerShape(TileCorner)
    Box(
        modifier.size(width, height)
            .onFocusChanged { focused = it.isFocused; if (it.isFocused) onFocused?.invoke() }
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .clip(shape)
            .border(BorderStroke(if (focused) 3.dp else 1.dp, if (focused) Color.White else LuminaColors.Hairline), shape)
            .combinedClickable(onClick = onClick),
    ) {
        Thumb(imageUrl, kind, Modifier.fillMaxSize(), shape = RoundedCornerShape(0.dp))
        // Darkens only the lowest part, so the caption reads on any picture and most of the picture stays clean.
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.55f to Color.Transparent, 1f to Color(0xDD0B0A10))))
        // A size smaller than before (17 and 13 sp), so the caption takes less of the picture.
        Column(Modifier.align(Alignment.BottomStart).padding(horizontal = 14.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(com.lumina.tv.core.Formatting.caption(title), style = LuminaText.Row.copy(fontSize = 17.sp, fontWeight = FontWeight.Medium), maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (!subtitle.isNullOrBlank()) Text(com.lumina.tv.core.Formatting.caption(subtitle), style = LuminaText.Small.copy(fontSize = 13.sp, color = LuminaColors.Ink2), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (duration != null) {
            Text(
                duration, style = LuminaText.Small.copy(color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold),
                modifier = Modifier.align(Alignment.TopEnd).padding(10.dp).background(Color.Black.copy(alpha = 0.72f), RoundedCornerShape(6.dp)).padding(horizontal = 8.dp, vertical = 2.dp),
            )
        }
    }
}

/** A song as one compact row: a small cover, the title, the artist. Lit while the remote is on it. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun SongRow(track: Track, onClick: () -> Unit, modifier: Modifier = Modifier, onFocused: (() -> Unit)? = null, rowHeight: Dp = 60.dp, divider: Boolean = true) {
    var focused by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(12.dp)
    val cover = rowHeight - 12.dp
    val length = lengthLabel(track.durationSec)
    Row(
        modifier.fillMaxWidth().height(rowHeight)
            .onFocusChanged { focused = it.isFocused; if (it.isFocused) onFocused?.invoke() }
            .clip(shape)
            // A faint line under the row, starting beside the title (not under the cover), so rows read as separate without boxes.
            .drawBehind {
                if (divider) {
                    val y = size.height - 0.5.dp.toPx()
                    drawLine(Color(0x26F3F1F8), Offset((6.dp + cover + 14.dp).toPx(), y), Offset(size.width - 6.dp.toPx(), y), strokeWidth = 1.dp.toPx())
                }
            }
            .background(if (focused) Color.White.copy(alpha = 0.16f) else Color.Transparent, shape)
            .combinedClickable(onClick = onClick)
            .padding(horizontal = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.size(cover).clip(RoundedCornerShape(8.dp))) { Thumb(track.thumbnailUrl, track.kind, Modifier.fillMaxSize(), shape = RoundedCornerShape(0.dp)) }
        Column(Modifier.weight(1f)) {
            Text(com.lumina.tv.core.Formatting.caption(track.title), style = LuminaText.Row.copy(fontSize = 17.sp, fontWeight = FontWeight.Medium), maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (track.artist.isNotBlank()) Text(com.lumina.tv.core.Formatting.caption(track.artist), style = LuminaText.Small.copy(fontSize = 14.sp), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (length != null) Text(length, style = LuminaText.Small.copy(fontSize = 14.sp), maxLines = 1)
    }
}

/** A titled panel of songs, as many rows as fit the height. Select on a row plays from there. */
@Composable
fun QuickPicksCard(title: String, tracks: List<Track>, width: Dp, height: Dp, onPlay: (Int) -> Unit, modifier: Modifier = Modifier, onFocusSong: (Track) -> Unit = {}) {
    val shape = RoundedCornerShape(TileCorner)
    // Rows of 52 dp share what is left under the title; the last one has no line under it, and any slack is spread evenly
    // between rows instead of left as an empty strip at the bottom.
    val rows = ((height.value - 84f) / 52f).toInt().coerceAtLeast(1)
    val shown = tracks.take(rows)
    Column(
        modifier.size(width, height).clip(shape).background(LuminaColors.Surface, shape).border(1.dp, LuminaColors.Hairline, shape).padding(start = 14.dp, end = 14.dp, top = 16.dp, bottom = 12.dp),
    ) {
        Text(title, style = LuminaText.DialogTitle.copy(fontSize = 20.sp), modifier = Modifier.padding(start = 6.dp, bottom = 8.dp))
        Box(Modifier.fillMaxWidth().height(1.dp).background(Color(0x26F3F1F8)))
        Column(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.SpaceEvenly) {
            shown.forEachIndexed { i, t -> SongRow(t, onClick = { onPlay(i) }, onFocused = { onFocusSong(t) }, rowHeight = 52.dp, divider = i < shown.lastIndex) }
        }
    }
}

/** Whatever a mosaic tile stands for (a video, an album, a playlist): the picture, the words, and what Select does. */
class MosaicItem(
    val image: String?, val kind: MediaKind, val title: String, val subtitle: String?, val duration: String?,
    /** Called when the remote rests on the tile: Home uses it to warm the video's link so Play starts at once. */
    val onFocus: (() -> Unit)? = null,
    val onClick: () -> Unit,
)

@Composable
fun MosaicTile(item: MosaicItem, width: Dp, height: Dp, modifier: Modifier = Modifier) =
    MosaicTile(item.image, item.kind, item.title, item.subtitle, width, height, item.onClick, modifier, item.duration, item.onFocus)

/**
 * Home's first block: a big picture, a tall one, two small ones stacked, and a panel of songs. Sizes chosen so the row fills
 * the width (about 1,550 of the 1,580 dp there is). A missing tile (nothing loaded for it yet) is simply left out.
 */
@Composable
fun MosaicBlockOne(pool: List<MosaicItem>, songs: List<Track>, onPlaySong: (Int) -> Unit, onFocusSong: (Track) -> Unit = {}) {
    Row(Modifier.padding(start = 6.dp, top = 12.dp, bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
        pool.getOrNull(0)?.let { MosaicTile(it, 604.dp, 340.dp) }
        pool.getOrNull(1)?.let { MosaicTile(it, 230.dp, 340.dp) }
        if (pool.size > 2) Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
            pool.getOrNull(2)?.let { MosaicTile(it, 230.dp, 160.dp) }
            pool.getOrNull(3)?.let { MosaicTile(it, 230.dp, 160.dp) }
        }
        if (songs.isNotEmpty()) QuickPicksCard("Quick picks", songs, 420.dp, 340.dp, onPlaySong, onFocusSong = onFocusSong)
        else pool.getOrNull(4)?.let { MosaicTile(it, 420.dp, 340.dp) }
    }
}

/**
 * Home's second block, deliberately lopsided: a square, a wide picture sitting lower, an artist hanging from the top, a tall
 * picture and a small wide one set lower again, so the row has no straight top or bottom edge.
 */
@Composable
fun MosaicBlockTwo(pool: List<MosaicItem>, artist: (@Composable () -> Unit)?) {
    Row(Modifier.padding(start = 6.dp, top = 12.dp, bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(20.dp), verticalAlignment = Alignment.Top) {
        pool.getOrNull(0)?.let { MosaicTile(it, 300.dp, 300.dp) }
        pool.getOrNull(1)?.let { MosaicTile(it, 530.dp, 298.dp, Modifier.padding(top = 22.dp)) }
        if (artist != null) Box(Modifier.padding(top = 4.dp)) { artist() }
        pool.getOrNull(2)?.let { MosaicTile(it, 230.dp, 340.dp) }
        pool.getOrNull(3)?.let { MosaicTile(it, 240.dp, 180.dp, Modifier.padding(top = 56.dp)) }
    }
}
