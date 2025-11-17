package me.atri.ui.chat

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.material3.ripple
import me.atri.data.db.entity.MessageEntity
import me.atri.data.model.AttachmentType
import kotlin.math.max

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MessageActionOverlay(
    message: MessageEntity,
    anchorBounds: Rect?,
    onDismiss: () -> Unit,
    onEdit: (String) -> Unit,
    onDelete: () -> Unit,
    onRegenerate: () -> Unit,
    onReference: () -> Unit
) {
    val density = LocalDensity.current
    val configuration = LocalConfiguration.current
    val screenWidthPx = with(density) { configuration.screenWidthDp.dp.toPx() }
    val horizontalMarginPx = with(density) { 24.dp.toPx() }
    val liftPx = with(density) { 96.dp.toPx() }
    val topPx = anchorBounds?.top ?: 0f
    val leftPx = anchorBounds?.left ?: horizontalMarginPx
    val rightPx = anchorBounds?.right ?: (screenWidthPx - horizontalMarginPx)

    val topPadding = if (anchorBounds == null) 0.dp else with(density) {
        max(topPx - liftPx, horizontalMarginPx).toDp()
    }
    val startPadding = if (anchorBounds == null) 24.dp else with(density) {
        max(leftPx - horizontalMarginPx, horizontalMarginPx).toDp()
    }
    val endPadding = if (anchorBounds == null) 24.dp else with(density) {
        max(screenWidthPx - rightPx - horizontalMarginPx, horizontalMarginPx).toDp()
    }

    val surfaceAlignment = when {
        anchorBounds == null -> Alignment.Center
        message.isFromAtri -> Alignment.TopStart
        else -> Alignment.TopEnd
    }

    val context = LocalContext.current
    var showEditDialog by remember { mutableStateOf(false) }
    val hasImageAttachments = remember(message.attachments) {
        message.attachments.any { it.type == AttachmentType.IMAGE }
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        val dismissInteraction = remember { MutableInteractionSource() }
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.25f))
                .clickable(
                    interactionSource = dismissInteraction,
                    indication = null,
                    onClick = onDismiss
                )
        ) {
            val modifier = if (surfaceAlignment == Alignment.Center) {
                Modifier
                    .align(surfaceAlignment)
                    .padding(horizontal = 32.dp)
            } else {
                Modifier
                    .align(surfaceAlignment)
                    .padding(
                        top = topPadding,
                        start = if (message.isFromAtri) startPadding else 24.dp,
                        end = if (!message.isFromAtri) endPadding else 24.dp
                    )
            }

            Surface(
                modifier = modifier,
                shape = MaterialTheme.shapes.large,
                tonalElevation = 8.dp,
                shadowElevation = 12.dp
            ) {
                Column(
                    modifier = Modifier.padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(18.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        MessageActionButton(
                            icon = Icons.Outlined.ContentCopy,
                            label = "复制",
                            onClick = {
                                val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                val clip = ClipData.newPlainText("message", message.content)
                                clipboard.setPrimaryClip(clip)
                                onDismiss()
                            }
                        )
                        if (!message.isFromAtri) {
                            MessageActionButton(
                                icon = Icons.Outlined.Edit,
                                label = "编辑",
                                onClick = { showEditDialog = true }
                            )
                        }
                        MessageActionButton(
                            icon = Icons.Outlined.Refresh,
                            label = "重答",
                            onClick = {
                                onRegenerate()
                                onDismiss()
                            }
                        )
                        MessageActionButton(
                            icon = Icons.Outlined.Image,
                            label = if (hasImageAttachments) "引用图片" else "无可引用",
                            enabled = hasImageAttachments,
                            onClick = {
                                onReference()
                                onDismiss()
                            }
                        )
                        MessageActionButton(
                            icon = Icons.Outlined.Delete,
                            label = "删除",
                            onClick = {
                                onDelete()
                                onDismiss()
                            }
                        )
                    }

                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            text = formatMessageTime(message.timestamp),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center
                        )
                        if (message.totalVersions > 1) {
                            Text(
                                text = "版本 ${message.currentVersionIndex + 1}/${message.totalVersions}",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }
        }
    }

    if (showEditDialog) {
        var editText by remember { mutableStateOf(message.content) }
        AlertDialog(
            onDismissRequest = { showEditDialog = false },
            title = { Text("编辑消息") },
            text = {
                OutlinedTextField(
                    value = editText,
                    onValueChange = { editText = it },
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    onEdit(editText)
                    showEditDialog = false
                }) {
                    Text("确定")
                }
            },
            dismissButton = {
                TextButton(onClick = { showEditDialog = false }) {
                    Text("取消")
                }
            }
        )
    }
}

@Composable
private fun MessageActionButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    enabled: Boolean = true,
    onClick: () -> Unit
) {
    val interactionSource = remember { MutableInteractionSource() }
    Column(
        modifier = Modifier.widthIn(min = 64.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        Box(
            modifier = Modifier
                .size(48.dp)
                .clip(CircleShape)
                .background(
                    if (enabled) MaterialTheme.colorScheme.primary.copy(alpha = 0.15f)
                    else MaterialTheme.colorScheme.surfaceVariant
                )
                .clickable(
                    enabled = enabled,
                    indication = ripple(),
                    interactionSource = interactionSource
                ) {
                    onClick()
                },
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = icon,
                contentDescription = label,
                tint = if (enabled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center
        )
    }
}
