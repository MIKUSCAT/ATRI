package me.atri.ui.chat

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

    val (indicatorColor, saturation) = when (status) {
        is AtriStatus.MoodStatus -> {
            val baseColor = when {
                status.p > 0.3 -> colorScheme.primary
                status.p < -0.3 -> colorScheme.error
                else -> colorScheme.outline
            }
            val sat = (0.5f + kotlin.math.abs(status.a.toFloat()) * 0.5f).coerceIn(0.5f, 1f)
            baseColor to sat
        }
        AtriStatus.Thinking -> colorScheme.primary to 0.8f
    }

    Surface(
        shape = RoundedCornerShape(50),
        color = colorScheme.surfaceVariant.copy(alpha = 0.7f),
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
                color = indicatorColor.copy(alpha = saturation),
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
                    color = colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}
