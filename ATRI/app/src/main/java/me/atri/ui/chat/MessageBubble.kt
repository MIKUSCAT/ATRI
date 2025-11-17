package me.atri.ui.chat

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ProvideTextStyle
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.halilibo.richtext.markdown.Markdown
import com.halilibo.richtext.ui.RichTextScope
import com.halilibo.richtext.ui.material3.Material3RichText
import me.atri.data.db.entity.MessageEntity
import me.atri.data.model.AttachmentType
import me.atri.ui.theme.MessageBubbleAtri
import me.atri.ui.theme.MessageBubbleUser

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MessageBubble(
    message: MessageEntity,
    isLoading: Boolean = false,
    onLongPress: (MessageEntity, Rect?) -> Unit = { _, _ -> },
    onVersionSwitch: (String, Int) -> Unit = { _, _ -> }
) {
    val haptic = LocalHapticFeedback.current
    var bubbleBounds by remember { mutableStateOf<Rect?>(null) }
    val alignment = if (message.isFromAtri) Alignment.Start else Alignment.End

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 40.dp),
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
                    .onGloballyPositioned { bubbleBounds = it.boundsInRoot() }
                    .combinedClickable(
                        onClick = {},
                        onLongClick = {
                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                            onLongPress(message, bubbleBounds)
                        }
                    ),
                shape = RoundedCornerShape(
                    topStart = 28.dp,
                    topEnd = 28.dp,
                    bottomEnd = if (message.isFromAtri) 28.dp else 8.dp,
                    bottomStart = if (message.isFromAtri) 8.dp else 28.dp
                ),
                color = if (message.isFromAtri) MessageBubbleAtri else MessageBubbleUser,
                tonalElevation = 0.dp,
                shadowElevation = 4.dp
            ) {
                Column(
                    modifier = Modifier.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    if (message.isFromAtri && message.thinkingContent != null) {
                        ThinkingContent(
                            thinkingText = message.thinkingContent,
                            thinkingStartTime = message.thinkingStartTime,
                            thinkingEndTime = message.thinkingEndTime,
                            isThinking = isLoading && message.thinkingEndTime == null
                        )
                    }

                    val imageAttachments = message.attachments.filter { it.type == AttachmentType.IMAGE }
                    if (imageAttachments.isNotEmpty()) {
                        imageAttachments.forEach { attachment ->
                            AsyncImage(
                                model = attachment.url,
                                contentDescription = attachment.name,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(top = 4.dp)
                                    .heightIn(max = 220.dp)
                                    .clip(RoundedCornerShape(12.dp))
                            )
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
                        ProvideTextStyle(
                            value = MaterialTheme.typography.bodyMedium.copy(
                                color = MaterialTheme.colorScheme.onSurface
                            )
                        ) {
                            Material3RichText {
                                Markdown(message.content)
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
                                shape = MaterialTheme.shapes.extraSmall,
                                color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(2.dp),
                                    modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp)
                                ) {
                                    IconButton(
                                        onClick = {
                                            val prevIndex = (message.currentVersionIndex - 1)
                                                .coerceIn(0, message.totalVersions - 1)
                                            onVersionSwitch(message.id, prevIndex)
                                        },
                                        enabled = message.currentVersionIndex > 0,
                                        modifier = Modifier.size(20.dp)
                                    ) {
                                        Text(
                                            text = "〈",
                                            style = MaterialTheme.typography.labelLarge,
                                            color = if (message.currentVersionIndex > 0)
                                                MaterialTheme.colorScheme.primary
                                            else
                                                MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.3f)
                                        )
                                    }
                                    Text(
                                        text = "${message.currentVersionIndex + 1}/${message.totalVersions}",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                    IconButton(
                                        onClick = {
                                            val nextIndex = (message.currentVersionIndex + 1)
                                                .coerceIn(0, message.totalVersions - 1)
                                            onVersionSwitch(message.id, nextIndex)
                                        },
                                        enabled = message.currentVersionIndex < message.totalVersions - 1,
                                        modifier = Modifier.size(20.dp)
                                    ) {
                                        Text(
                                            text = "〉",
                                            style = MaterialTheme.typography.labelLarge,
                                            color = if (message.currentVersionIndex < message.totalVersions - 1)
                                                MaterialTheme.colorScheme.primary
                                            else
                                                MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.3f)
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

private fun formatSize(size: Long): String {
    if (size < 1024) return "${size}B"
    val kb = size / 1024.0
    if (kb < 1024) return String.format("%.1fKB", kb)
    val mb = kb / 1024.0
    return String.format("%.2fMB", mb)
}
