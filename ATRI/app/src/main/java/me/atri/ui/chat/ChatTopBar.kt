package me.atri.ui.chat

import android.graphics.Color as AndroidColor
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import me.atri.data.model.AtriStatus
import me.atri.ui.components.DiaryIcon
import me.atri.ui.theme.AtriTheme

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
    val atriColors = AtriTheme.colors
    val targetPill = when (status) {
        is AtriStatus.LiveStatus -> parseDynamicColor(status.pillColor, atriColors.messageBubbleAtri)
        is AtriStatus.Thinking -> atriColors.messageBubbleAtri
    }
    val targetText = when (status) {
        is AtriStatus.LiveStatus -> parseDynamicColor(status.textColor, contrastTextColor(targetPill))
        is AtriStatus.Thinking -> contrastTextColor(targetPill)
    }

    val pillColor by animateColorAsState(
        targetValue = targetPill,
        animationSpec = tween(600, easing = FastOutSlowInEasing),
        label = "pillColor"
    )
    val textColor by animateColorAsState(
        targetValue = targetText,
        animationSpec = tween(600, easing = FastOutSlowInEasing),
        label = "textColor"
    )

    var pulseKey by remember { mutableIntStateOf(0) }
    LaunchedEffect(status.text) { pulseKey++ }
    val dotScale = remember { Animatable(1f) }
    LaunchedEffect(pulseKey) {
        if (pulseKey > 0) {
            dotScale.snapTo(1.4f)
            dotScale.animateTo(
                targetValue = 1f,
                animationSpec = spring(dampingRatio = 0.45f, stiffness = Spring.StiffnessLow)
            )
        }
    }

    Surface(
        shape = RoundedCornerShape(50),
        color = pillColor,
        tonalElevation = 0.dp,
        modifier = Modifier.animateContentSize(
            animationSpec = tween(400, easing = FastOutSlowInEasing)
        )
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .widthIn(max = 200.dp)
                .padding(horizontal = 12.dp, vertical = 6.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .scale(dotScale.value)
                    .clip(CircleShape)
                    .background(textColor)
            )
            AnimatedContent(
                targetState = status.text,
                transitionSpec = {
                    (slideInVertically(tween(280)) { h -> h / 2 } + fadeIn(tween(280))) togetherWith
                        (slideOutVertically(tween(220)) { h -> -h / 2 } + fadeOut(tween(220)))
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
