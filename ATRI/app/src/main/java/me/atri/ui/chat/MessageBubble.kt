package me.atri.ui.chat

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ProvideTextStyle
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.halilibo.richtext.markdown.Markdown
import com.halilibo.richtext.ui.RichTextScope
import com.halilibo.richtext.ui.material3.Material3RichText
import me.atri.data.db.entity.MessageEntity
import me.atri.data.model.AttachmentType
import me.atri.ui.theme.AtriTheme

@Composable
fun MessageBubble(
    message: MessageEntity,
    isLoading: Boolean = false,
    onLongPress: (MessageEntity) -> Unit = {},
    onVersionSwitch: (String, Int) -> Unit = { _, _ -> }
) {
    val haptic = LocalHapticFeedback.current
    val alignment = if (message.isFromAtri) Alignment.Start else Alignment.End

    // 只对新消息（3秒内）做入场动画
    val isNewMessage = remember(message.id) {
        System.currentTimeMillis() - message.timestamp < 3000
    }

    var animationStarted by remember { mutableStateOf(!isNewMessage) }
    LaunchedEffect(message.id) {
        if (isNewMessage) {
            animationStarted = true
        }
    }

    val animatedAlpha by animateFloatAsState(
        targetValue = if (animationStarted) 1f else 0f,
        animationSpec = spring(
            dampingRatio = Spring.DampingRatioMediumBouncy,
            stiffness = Spring.StiffnessMedium
        ),
        label = "bubbleAlpha"
    )

    val animatedOffsetX by animateFloatAsState(
        targetValue = if (animationStarted) 0f else if (message.isFromAtri) -60f else 60f,
        animationSpec = spring(
            dampingRatio = Spring.DampingRatioMediumBouncy,
            stiffness = Spring.StiffnessMedium
        ),
        label = "bubbleOffset"
    )

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 40.dp)
            .alpha(animatedAlpha)
            .offset { IntOffset(animatedOffsetX.toInt(), 0) },
        horizontalArrangement = if (message.isFromAtri) Arrangement.Start else Arrangement.End,
        verticalAlignment = Alignment.Top
    ) {
        if (message.isFromAtri) {
            Box(
                modifier = Modifier
                    .width(3.dp)
                    .fillMaxHeight()
                    .padding(top = 8.dp)
                    .background(
                        brush = Brush.verticalGradient(
                            colors = listOf(
                                MaterialTheme.colorScheme.primary.copy(alpha = 0.4f),
                                MaterialTheme.colorScheme.primary
                            )
                        ),
                        shape = RoundedCornerShape(2.dp)
                    )
            )
            Spacer(modifier = Modifier.width(6.dp))
        }

        Column(
            modifier = Modifier.widthIn(max = 360.dp),
            horizontalAlignment = alignment
        ) {
            Surface(
                modifier = Modifier
                    .widthIn(min = 56.dp, max = 360.dp)
                    .pointerInput(message.id) {
                        detectTapGestures(
                            onLongPress = {
                                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                onLongPress(message)
                            }
                        )
                    },
                shape = RoundedCornerShape(
                    topStart = 28.dp,
                    topEnd = 28.dp,
                    bottomEnd = if (message.isFromAtri) 28.dp else 8.dp,
                    bottomStart = if (message.isFromAtri) 8.dp else 28.dp
                ),
                color = if (message.isFromAtri) AtriTheme.colors.messageBubbleAtri else AtriTheme.colors.messageBubbleUser,
                tonalElevation = 0.dp,
                shadowElevation = 0.dp
            ) {
                Column(
                    modifier = Modifier.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    val imageAttachments = message.attachments.filter { it.type == AttachmentType.IMAGE }
                    if (imageAttachments.isNotEmpty()) {
                        imageAttachments.forEach { attachment ->
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(top = 4.dp)
                                    .heightIn(min = 120.dp, max = 220.dp)
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(MaterialTheme.colorScheme.surfaceVariant),
                                contentAlignment = Alignment.Center
                            ) {
                                AsyncImage(
                                    model = attachment.url,
                                    contentDescription = attachment.name,
                                    modifier = Modifier
                                        .fillMaxSize()
                                        .clip(RoundedCornerShape(12.dp)),
                                    onLoading = { },
                                    onError = { },
                                    onSuccess = { }
                                )
                            }
                        }
                    }

                    val documentAttachments = message.attachments.filter { it.type == AttachmentType.DOCUMENT }
                    if (documentAttachments.isNotEmpty()) {
                        Column(
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                            modifier = Modifier.padding(top = 4.dp)
                        ) {
                            documentAttachments.forEach { attachment ->
                                Surface(
                                    tonalElevation = 1.dp,
                                    shape = RoundedCornerShape(10.dp)
                                ) {
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .padding(horizontal = 8.dp, vertical = 4.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                                    ) {
                                        Icon(
                                            imageVector = Icons.Outlined.Description,
                                            contentDescription = null
                                        )
                                        Column {
                                            Text(text = attachment.name ?: "附件")
                                            attachment.sizeBytes?.let { size ->
                                                Text(
                                                    text = formatSize(size),
                                                    style = MaterialTheme.typography.labelSmall
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if (message.content.isNotEmpty()) {
                        val contentText = message.content
                        val hasMarkdown = remember(message.id, contentText) {
                            val markdownHints = listOf("*", "_", "[", "`")
                            markdownHints.any { hint -> contentText.contains(hint) }
                        }
                        ProvideTextStyle(
                            value = MaterialTheme.typography.bodyMedium.copy(
                                color = MaterialTheme.colorScheme.onSurface
                            )
                        ) {
                            if (hasMarkdown) {
                                Material3RichText {
                                    Markdown(contentText)
                                }
                            } else {
                                Text(text = contentText)
                            }
                        }
                    }

                    if (message.totalVersions > 1) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Surface(
                                shape = MaterialTheme.shapes.extraSmall,
                                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
                            ) {
                                Text(
                                    text = "已编辑",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                                )
                            }

                            Surface(
                                shape = RoundedCornerShape(12.dp),
                                color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(0.dp),
                                    modifier = Modifier.padding(horizontal = 2.dp, vertical = 2.dp)
                                ) {
                                    val canPrev = message.currentVersionIndex > 0
                                    val canNext = message.currentVersionIndex < message.totalVersions - 1

                                    Surface(
                                        onClick = {
                                            if (canPrev) {
                                                haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                                onVersionSwitch(message.id, message.currentVersionIndex - 1)
                                            }
                                        },
                                        shape = RoundedCornerShape(10.dp),
                                        color = if (canPrev) MaterialTheme.colorScheme.primary.copy(alpha = 0.1f) else Color.Transparent,
                                        modifier = Modifier.size(28.dp)
                                    ) {
                                        Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                                            Icon(
                                                imageVector = Icons.AutoMirrored.Filled.KeyboardArrowLeft,
                                                contentDescription = "上一版本",
                                                modifier = Modifier.size(18.dp),
                                                tint = if (canPrev) MaterialTheme.colorScheme.primary
                                                    else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.3f)
                                            )
                                        }
                                    }

                                    Text(
                                        text = "${message.currentVersionIndex + 1}/${message.totalVersions}",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        modifier = Modifier.padding(horizontal = 4.dp)
                                    )

                                    Surface(
                                        onClick = {
                                            if (canNext) {
                                                haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                                onVersionSwitch(message.id, message.currentVersionIndex + 1)
                                            }
                                        },
                                        shape = RoundedCornerShape(10.dp),
                                        color = if (canNext) MaterialTheme.colorScheme.primary.copy(alpha = 0.1f) else Color.Transparent,
                                        modifier = Modifier.size(28.dp)
                                    ) {
                                        Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                                            Icon(
                                                imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                                                contentDescription = "下一版本",
                                                modifier = Modifier.size(18.dp),
                                                tint = if (canNext) MaterialTheme.colorScheme.primary
                                                    else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.3f)
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun formatSize(size: Long): String {
    if (size < 1024) return "${size}B"
    val kb = size / 1024.0
    if (kb < 1024) return String.format("%.1fKB", kb)
    val mb = kb / 1024.0
    return String.format("%.2fMB", mb)
}
