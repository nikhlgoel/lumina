package com.lumina.tv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Icon
import androidx.tv.material3.Text

/*
 * The shared page layout. Every page that is not a wall of covers is built from these parts, so Settings, Playlists
 * and Downloads sit in the same frame as Library: a row of tabs or actions on top, an info line, then content that is
 * either a grid of covers or one panel of divided rows. Nothing here is page-specific.
 */

/** The row of tabs or actions at the top of a page: same spacing and position on every page. */
@Composable
fun TabBar(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    Row(
        modifier.padding(top = 12.dp, bottom = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

/** One rounded surface holding a list of [PanelRow]s. Rows draw their own dividers, so the panel only supplies the frame. */
@Composable
fun Panel(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier.fillMaxWidth().background(LuminaColors.Surface, RoundedCornerShape(22.dp)).border(1.dp, LuminaColors.Hairline, RoundedCornerShape(22.dp)).padding(vertical = 8.dp),
        content = content,
    )
}

/** The thin line between two rows of a panel, inset so it does not touch the panel's rounded edge. */
@Composable
fun PanelDivider() {
    Box(Modifier.padding(horizontal = 24.dp).fillMaxWidth().height(1.dp).background(Color(0x1FFFFFFF)))
}

/**
 * One setting or item in a panel: [icon], the [title] with a line of [detail] under it, the current [value] at the
 * right, and an arrow when it opens a list. [divided] draws the divider above it; pass false for the first row.
 * [highlight] shows the value in the accent colour (something in use or switched on).
 */
@Composable
fun PanelRow(
    title: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    detail: String? = null,
    value: String? = null,
    icon: ImageVector? = null,
    chevron: Boolean = false,
    highlight: Boolean = false,
    divided: Boolean = true,
    detailColor: Color = LuminaColors.Ink3,
    /** Non-null for an on/off setting: drawn as a switch at the right, so every on/off looks the same. */
    toggle: Boolean? = null,
) {
    if (divided) PanelDivider()
    FocusSurface(onClick = onClick, modifier = modifier.fillMaxWidth().padding(horizontal = 8.dp), shape = RoundedCornerShape(16.dp), scaleOnFocus = 1f) { focused ->
        // Every row is the same height, so the list never shifts as the remote moves. The explanation shows on the focused row
        // only (a result or a warning, which has its own colour, always shows).
        Row(Modifier.heightIn(min = 76.dp).padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            if (icon != null) {
                Box(Modifier.size(42.dp).background(Color.White.copy(alpha = 0.07f), RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                    Icon(icon, contentDescription = null, tint = if (highlight) LuminaColors.Amber else LuminaColors.Ink2, modifier = Modifier.size(26.dp))
                }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(title, style = LuminaText.Row, maxLines = 1)
                if (detail != null && (focused || detailColor != LuminaColors.Ink3)) Text(detail, style = LuminaText.Small.copy(fontSize = 15.sp, color = detailColor), maxLines = 2)
            }
            if (value != null) Text(value, style = LuminaText.Body.copy(color = if (highlight) LuminaColors.Amber else LuminaColors.Ink2), maxLines = 1)
            if (toggle != null) LSwitch(toggle)
            if (chevron) Icon(Icons.Filled.ChevronRight, contentDescription = null, tint = LuminaColors.Ink3, modifier = Modifier.size(26.dp))
        }
    }
}

/** An on/off switch: a pill with a round knob, in the accent colour when on. Draws only; the row it sits in does the clicking. */
@Composable
fun LSwitch(on: Boolean, modifier: Modifier = Modifier) {
    Box(
        modifier.size(width = 58.dp, height = 32.dp)
            .background(if (on) LuminaColors.Amber else LuminaColors.SurfaceHigh, RoundedCornerShape(16.dp))
            .border(1.dp, if (on) Color.Transparent else LuminaColors.HairlineStrong, RoundedCornerShape(16.dp))
            .padding(4.dp),
        contentAlignment = if (on) Alignment.CenterEnd else Alignment.CenterStart,
    ) {
        Box(Modifier.size(24.dp).background(if (on) LuminaColors.Bg else LuminaColors.Ink2, CircleShape))
    }
}

/** A row that only informs (a version, a licence). It cannot be focused, so keep it for short facts, not things to act on. */
@Composable
fun PanelInfo(title: String, detail: String? = null, value: String? = null, divided: Boolean = true) {
    if (divided) PanelDivider()
    Row(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = LuminaText.Row, maxLines = 1)
            if (detail != null) Text(detail, style = LuminaText.Small)
        }
        if (value != null) Text(value, style = LuminaText.Body.copy(color = LuminaColors.Ink2), maxLines = 1)
    }
}

/** A small heading that names a group on a page ("Your playlists", "Kept on this device"). */
@Composable
fun SectionHeading(text: String, modifier: Modifier = Modifier) {
    Text(text, style = LuminaText.Title, modifier = modifier.padding(start = 4.dp, top = 12.dp, bottom = 2.dp))
}

/** A line of explanation under a panel or a tab bar. */
@Composable
fun PanelNote(text: String, modifier: Modifier = Modifier) {
    Text(text, style = LuminaText.Small, modifier = modifier.padding(start = 8.dp, end = 8.dp, top = 10.dp))
}

/** The corner rounding for item [index] of [count] in a lazy list that is drawn as one panel: round only the outer ends. */
fun panelShape(index: Int, count: Int): Shape {
    val r = 22.dp
    return RoundedCornerShape(
        topStart = if (index == 0) r else 0.dp, topEnd = if (index == 0) r else 0.dp,
        bottomStart = if (index == count - 1) r else 0.dp, bottomEnd = if (index == count - 1) r else 0.dp,
    )
}
