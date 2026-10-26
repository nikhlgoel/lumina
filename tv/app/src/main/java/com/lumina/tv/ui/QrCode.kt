package com.lumina.tv.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel

/**
 * The modules of a QR code for [text] (true = dark), or null when it cannot be encoded. Kept apart from the drawing so it
 * can be tested without a screen.
 */
fun qrModules(text: String): Array<BooleanArray>? = runCatching {
    val hints = mapOf(EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M, EncodeHintType.MARGIN to 0)
    val m = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0, hints)
    Array(m.height) { y -> BooleanArray(m.width) { x -> m.get(x, y) } }
}.getOrNull()

/**
 * A QR code that a phone's camera reads from across a room: dark modules on a white square with a clear border (the
 * border is part of the code's contract, not decoration), drawn crisp at any size.
 */
@Composable
fun QrCode(text: String, size: Dp = 260.dp, modifier: Modifier = Modifier) {
    val modules = remember(text) { qrModules(text) } ?: return
    Canvas(modifier.size(size).background(Color.White).padding(size / 14)) {
        val n = modules.size
        val cell = this.size.width / n
        for (y in 0 until n) for (x in 0 until n) {
            if (modules[y][x]) drawRect(Color(0xFF111111), Offset(x * cell, y * cell), Size(cell + 0.5f, cell + 0.5f))
        }
    }
}
