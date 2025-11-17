package me.atri.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

@Composable
fun DiaryIcon(
    modifier: Modifier = Modifier,
    tint: Color = MaterialTheme.colorScheme.onSurface,
    iconSize: Dp = 24.dp
) {
    val density = LocalDensity.current
    Canvas(modifier = modifier.then(Modifier.size(iconSize))) {
        val stroke = with(density) { 1.6.dp.toPx() }
        val radius = with(density) { 3.dp.toPx() }
        val width = size.width
        val height = size.height
        drawRoundRect(
            color = tint,
            topLeft = Offset(stroke / 2, stroke / 2),
            size = Size(width - stroke, height - stroke),
            cornerRadius = CornerRadius(radius, radius),
            style = Stroke(width = stroke)
        )
        val bindingX = width * 0.28f
        drawLine(
            color = tint,
            start = Offset(bindingX, stroke * 2),
            end = Offset(bindingX, height - stroke * 2),
            strokeWidth = stroke
        )
        val pageX = width * 0.68f
        drawLine(
            color = tint,
            start = Offset(pageX, stroke * 3),
            end = Offset(pageX, height - stroke * 3),
            strokeWidth = stroke
        )
        drawLine(
            color = tint,
            start = Offset(pageX + stroke, height * 0.35f),
            end = Offset(width - stroke * 2, height * 0.35f),
            strokeWidth = stroke,
            cap = StrokeCap.Round
        )
        drawLine(
            color = tint,
            start = Offset(pageX + stroke, height * 0.6f),
            end = Offset(width - stroke * 2, height * 0.6f),
            strokeWidth = stroke,
            cap = StrokeCap.Round
        )
    }
}
