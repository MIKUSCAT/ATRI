package me.atri.ui.chat

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

enum class ThinkingState {
    COLLAPSED,
    PREVIEW,
    EXPANDED
}

@Composable
fun ThinkingContent(
    thinkingText: String?,
    thinkingStartTime: Long?,
    thinkingEndTime: Long?,
    isThinking: Boolean,
    modifier: Modifier = Modifier
) {
    if (thinkingText.isNullOrEmpty()) return

    var expandState by remember { mutableStateOf(ThinkingState.COLLAPSED) }
    val scrollState = rememberScrollState()

    var duration by remember(thinkingStartTime, thinkingEndTime, isThinking) {
        mutableStateOf(
            if (thinkingEndTime != null && thinkingStartTime != null) {
                thinkingEndTime - thinkingStartTime
            } else if (thinkingStartTime != null) {
                System.currentTimeMillis() - thinkingStartTime
            } else {
                0L
            }
        )
    }

    LaunchedEffect(isThinking) {
        if (isThinking) {
            expandState = ThinkingState.PREVIEW
            while (isThinking && thinkingStartTime != null) {
                duration = System.currentTimeMillis() - thinkingStartTime
                delay(100)
            }
        } else {
            if (expandState == ThinkingState.PREVIEW) {
                expandState = ThinkingState.COLLAPSED
            }
        }
    }

    Surface(
        modifier = modifier,
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.6f),
        contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
        tonalElevation = 2.dp
    ) {
        Column(
            modifier = Modifier
                .padding(12.dp)
                .animateContentSize()
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(
                        onClick = {
                            expandState = when (expandState) {
                                ThinkingState.COLLAPSED -> ThinkingState.EXPANDED
                                ThinkingState.PREVIEW -> ThinkingState.EXPANDED
                                ThinkingState.EXPANDED -> ThinkingState.COLLAPSED
                            }
                        },
                        indication = null,
                        interactionSource = remember { MutableInteractionSource() }
                    ),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "思考中",
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.Medium,
                        color = MaterialTheme.colorScheme.secondary
                    )
                    if (duration > 0) {
                        val durationAlpha by animateFloatAsState(
                            targetValue = if (isThinking) 1f else 0.7f,
                            label = "durationAlpha"
                        )
                        Text(
                            text = "(${duration / 1000}s)",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.secondary.copy(alpha = durationAlpha),
                            fontSize = 12.sp
                        )
                    }
                }
                Icon(
                    imageVector = when (expandState) {
                        ThinkingState.COLLAPSED, ThinkingState.PREVIEW -> Icons.Filled.ExpandMore
                        ThinkingState.EXPANDED -> Icons.Filled.ExpandLess
                    },
                    contentDescription = null,
                    modifier = Modifier.size(20.dp),
                    tint = MaterialTheme.colorScheme.secondary
                )
            }

            if (expandState != ThinkingState.COLLAPSED) {
                Spacer(modifier = Modifier.height(8.dp))
                HorizontalDivider(
                    color = MaterialTheme.colorScheme.secondary.copy(alpha = 0.3f),
                    thickness = 1.dp
                )
                Spacer(modifier = Modifier.height(8.dp))

                SelectionContainer {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .let {
                                if (expandState == ThinkingState.PREVIEW) {
                                    it
                                        .heightIn(max = 120.dp)
                                        .graphicsLayer { alpha = 0.99f }
                                        .drawWithContent {
                                            val fadeHeight = 48f
                                            val brush = Brush.verticalGradient(
                                                startY = 0f,
                                                endY = size.height,
                                                colorStops = arrayOf(
                                                    0.0f to Color.Transparent,
                                                    (fadeHeight / size.height).coerceIn(0f, 1f) to Color.Black,
                                                    (1 - fadeHeight / size.height).coerceIn(0f, 1f) to Color.Black,
                                                    1.0f to Color.Transparent
                                                )
                                            )
                                            drawContent()
                                            drawRect(
                                                brush = brush,
                                                size = Size(size.width, size.height),
                                                blendMode = BlendMode.DstIn
                                            )
                                        }
                                        .verticalScroll(scrollState)
                                } else {
                                    it
                                }
                            }
                    ) {
                        Text(
                            text = thinkingText,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.9f),
                            lineHeight = 20.sp
                        )
                    }
                }
            }
        }
    }
}
