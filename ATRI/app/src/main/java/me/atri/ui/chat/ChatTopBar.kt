package me.atri.ui.chat

import android.graphics.Color as AndroidColor
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import me.atri.data.model.AtriStatus
import me.atri.ui.components.DiaryIcon

@Composable
fun ChatTopBar(
    status: AtriStatus,
    currentDateLabel: String,
    onOpenDrawer: () -> Unit,
    onOpenDiary: () -> Unit
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = Color.Transparent,
        tonalElevation = 0.dp
    ) {
        Column(modifier = Modifier.statusBarsPadding()) {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                color = MaterialTheme.colorScheme.surface,
                tonalElevation = 3.dp
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = onOpenDrawer) {
                        Icon(Icons.Outlined.Menu, contentDescription = "打开抽屉")
                    }
                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .padding(horizontal = 12.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(
                            text = currentDateLabel,
                            style = MaterialTheme.typography.titleMedium
                        )
                        Spacer(modifier = Modifier.height(2.dp))
                        StatusPill(status = status)
                    }
                    IconButton(onClick = onOpenDiary) {
                        DiaryIcon()
                    }
                }
            }
        }
    }
}

@Composable
private fun StatusPill(status: AtriStatus) {
    val colorScheme = MaterialTheme.colorScheme

    val pillColor = when (status) {
        is AtriStatus.LiveStatus -> parseDynamicColor(status.pillColor, colorScheme.outline)
        is AtriStatus.Thinking -> Color(0xFF5B8DEF)
    }
    val textColor = contrastTextColor(pillColor)

    Surface(
        shape = RoundedCornerShape(50),
        color = pillColor.copy(alpha = 0.38f),
        tonalElevation = 0.dp
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .widthIn(max = 200.dp)
                .padding(horizontal = 12.dp, vertical = 6.dp)
        ) {
            Surface(
                modifier = Modifier
                    .height(8.dp)
                    .width(8.dp),
                shape = CircleShape,
                color = pillColor.copy(alpha = 0.95f),
                tonalElevation = 0.dp
            ) {}
            AnimatedContent(
                targetState = status.text,
                transitionSpec = {
                    fadeIn(animationSpec = tween(200)) togetherWith
                        fadeOut(animationSpec = tween(150))
                },
                label = "statusText"
            ) { text ->
                Text(
                    text = text,
                    style = MaterialTheme.typography.labelMedium,
                    color = textColor,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

private fun parseDynamicColor(value: String?, fallback: Color): Color {
    val raw = value?.trim().orEmpty()
    if (raw.isEmpty()) return fallback
    return try {
        Color(AndroidColor.parseColor(raw))
    } catch (_: IllegalArgumentException) {
        fallback
    }
}

private fun contrastTextColor(background: Color): Color {
    val luminance = 0.299f * background.red + 0.587f * background.green + 0.114f * background.blue
    return if (luminance > 0.5f) Color(0xFF1A1A2E) else Color(0xFFF0F0F0)
}
