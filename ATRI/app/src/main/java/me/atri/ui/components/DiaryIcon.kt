package me.atri.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
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
        val stroke = with(density) { 2.dp.toPx() }
        val w = size.width
        val h = size.height

        // 三条线的Y坐标
        val line1Y = h * 0.25f
        val line2Y = h * 0.5f
        val line3Y = h * 0.75f

        // ">" 箭头参数
        val arrowLeft = w * 0.08f
        val arrowTip = w * 0.38f  // > 的尖端位置

        // 横线参数
        val lineStartLong = arrowTip      // 第一、三条线从箭头尖端位置开始
        val lineStartShort = arrowTip + w * 0.12f  // 第二条线有空隙
        val lineRight = w * 0.92f         // 三条线右边对齐

        // 第一条线（长）
        drawLine(
            color = tint,
            start = Offset(lineStartLong, line1Y),
            end = Offset(lineRight, line1Y),
            strokeWidth = stroke,
            cap = StrokeCap.Round
        )

        // ">" 上半部分
        drawLine(
            color = tint,
            start = Offset(arrowLeft, line1Y),
            end = Offset(arrowTip, line2Y),
            strokeWidth = stroke,
            cap = StrokeCap.Round
        )

        // 第二条线（短，和箭头有空隙）
        drawLine(
            color = tint,
            start = Offset(lineStartShort, line2Y),
            end = Offset(lineRight, line2Y),
            strokeWidth = stroke,
            cap = StrokeCap.Round
        )

        // ">" 下半部分
        drawLine(
            color = tint,
            start = Offset(arrowTip, line2Y),
            end = Offset(arrowLeft, line3Y),
            strokeWidth = stroke,
            cap = StrokeCap.Round
        )

        // 第三条线（长）
        drawLine(
            color = tint,
            start = Offset(lineStartLong, line3Y),
            end = Offset(lineRight, line3Y),
            strokeWidth = stroke,
            cap = StrokeCap.Round
        )
    }
}
