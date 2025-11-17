package me.atri.ui.chat

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import me.atri.data.model.AttachmentType
import me.atri.data.model.PendingAttachment

private const val MAX_ATTACHMENTS = 6

@Composable
fun InputBar(
    enabled: Boolean = true,
    isProcessing: Boolean = false,
    reference: ChatUiState.ReferencedMessage? = null,
    onClearReference: () -> Unit = {},
    onToggleReferenceAttachment: (String) -> Unit = {},
    onSendMessage: (String, List<PendingAttachment>) -> Unit
) {
    val context = LocalContext.current
    var text by remember { mutableStateOf("") }
    val attachments = remember { mutableStateListOf<PendingAttachment>() }

    val imagePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetMultipleContents()
    ) { uris ->
        if (!enabled || isProcessing) return@rememberLauncherForActivityResult
        val remaining = (MAX_ATTACHMENTS - attachments.size).coerceAtLeast(0)
        if (remaining == 0) return@rememberLauncherForActivityResult
        val newItems = uris
            .take(remaining)
            .mapNotNull { uri -> context.buildPendingAttachment(uri) }
        attachments.addAll(newItems)
    }


    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp)
    ) {
        if (reference != null && reference.attachments.isNotEmpty()) {
            ReferencePreview(
                reference = reference,
                onClearReference = onClearReference,
                onToggleReferenceAttachment = onToggleReferenceAttachment
            )
        }

        if (attachments.isNotEmpty()) {
            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 8.dp)
            ) {
                items(
                    items = attachments,
                    key = { it.uri.toString() }
                ) { attachment ->
                    AttachmentPreview(
                        attachment = attachment,
                        onRemove = { attachments.remove(attachment) }
                    )
                }
            }
        }
        val inputShape = RoundedCornerShape(32.dp)
        val surfaceColor = MaterialTheme.colorScheme.surface
        val cornerRadiusPx = with(LocalDensity.current) { 32.dp.toPx() }
        val highlightBrush = remember(surfaceColor) {
            val baseAlpha = if (surfaceColor.luminance() > 0.5f) 0.55f else 0.25f
            Brush.verticalGradient(
                colors = listOf(
                    Color.White.copy(alpha = baseAlpha),
                    Color.Transparent
                )
            )
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .shadow(
                    elevation = 24.dp,
                    shape = inputShape,
                    clip = false,
                    ambientColor = Color.Black.copy(alpha = 0.1f),
                    spotColor = Color.Black.copy(alpha = 0.28f)
                )
                .clip(inputShape)
                .background(surfaceColor)
                .border(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.08f), inputShape)
                .drawBehind {
                    drawRoundRect(
                        brush = highlightBrush,
                        size = Size(width = size.width, height = size.height * 0.4f),
                        cornerRadius = CornerRadius(cornerRadiusPx, cornerRadiusPx)
                    )
                }
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                IconButton(
                    onClick = { imagePickerLauncher.launch("image/*") },
                    enabled = enabled && attachments.size < MAX_ATTACHMENTS
                ) {
                    Icon(Icons.Outlined.Add, contentDescription = "添加附件")
                }

                TextField(
                    value = text,
                    onValueChange = { text = it },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text("说点什么吧…") },
                    maxLines = 4,
                    enabled = enabled,
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = androidx.compose.ui.graphics.Color.Transparent,
                        unfocusedContainerColor = androidx.compose.ui.graphics.Color.Transparent,
                        disabledContainerColor = androidx.compose.ui.graphics.Color.Transparent,
                        focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                        unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                        disabledIndicatorColor = androidx.compose.ui.graphics.Color.Transparent
                    )
                )

                val canSend = text.isNotBlank() || attachments.isNotEmpty()
                val buttonEnabled = enabled && canSend && !isProcessing
                val buttonColors = IconButtonDefaults.filledIconButtonColors(
                    containerColor = if (canSend || isProcessing) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
                    contentColor = if (canSend || isProcessing) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                    disabledContainerColor = if (isProcessing) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
                    disabledContentColor = if (isProcessing) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant
                )

                FilledIconButton(
                    onClick = {
                        if (canSend) {
                            onSendMessage(text, attachments.toList())
                            text = ""
                            attachments.clear()
                        }
                    },
                    enabled = buttonEnabled,
                    colors = buttonColors
                ) {
                    if (isProcessing) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            color = MaterialTheme.colorScheme.onPrimary,
                            strokeWidth = 2.dp
                        )
                    } else {
                        Icon(
                            imageVector = Icons.Rounded.ArrowUpward,
                            contentDescription = "发送"
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ReferencePreview(
    reference: ChatUiState.ReferencedMessage,
    onClearReference: () -> Unit,
    onToggleReferenceAttachment: (String) -> Unit
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(bottom = 8.dp),
        shape = RoundedCornerShape(16.dp),
        tonalElevation = 1.dp
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text(
                        text = "引用的图片",
                        style = MaterialTheme.typography.titleSmall
                    )
                    Text(
                        text = "来自 ${formatMessageTime(reference.timestamp)}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                TextButton(onClick = onClearReference) {
                    Text("移除")
                }
            }

            LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                items(reference.attachments, key = { it.attachment.url }) { entry ->
                    ReferencedAttachmentItem(
                        entry = entry,
                        onToggle = { onToggleReferenceAttachment(entry.attachment.url) }
                    )
                }
            }
        }
    }
}

@Composable
private fun ReferencedAttachmentItem(
    entry: ChatUiState.ReferencedAttachment,
    onToggle: () -> Unit
) {
    val borderColor = if (entry.selected) {
        MaterialTheme.colorScheme.primary
    } else {
        MaterialTheme.colorScheme.outlineVariant
    }
    Box(
        modifier = Modifier
            .size(width = 90.dp, height = 90.dp)
            .clip(RoundedCornerShape(12.dp))
            .border(2.dp, borderColor, RoundedCornerShape(12.dp))
            .clickable { onToggle() }
    ) {
        AsyncImage(
            model = entry.attachment.url,
            contentDescription = entry.attachment.name,
            modifier = Modifier.matchParentSize(),
            contentScale = ContentScale.Crop
        )

        if (entry.selected) {
            Icon(
                imageVector = Icons.Outlined.CheckCircle,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(4.dp)
            )
        } else {
            Box(
                modifier = Modifier
                    .matchParentSize()
                    .background(Color.Black.copy(alpha = 0.4f))
            )
            Text(
                text = "未选",
                color = Color.White,
                style = MaterialTheme.typography.labelMedium,
                modifier = Modifier
                    .align(Alignment.Center)
            )
        }
    }
}

@Composable
private fun AttachmentPreview(
    attachment: PendingAttachment,
    onRemove: () -> Unit
) {
    Box(
        modifier = Modifier
            .size(width = 90.dp, height = 90.dp)
    ) {
        if (attachment.type == AttachmentType.IMAGE) {
            AsyncImage(
                model = attachment.uri,
                contentDescription = attachment.name,
                modifier = Modifier
                    .matchParentSize()
                    .clip(RoundedCornerShape(12.dp))
            )
        } else {
            Surface(
                modifier = Modifier
                    .matchParentSize(),
                shape = RoundedCornerShape(12.dp),
                tonalElevation = 1.dp
            ) {
                Column(
                    modifier = Modifier
                        .padding(8.dp),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Description,
                        contentDescription = null
                    )
                    Text(
                        text = attachment.name.take(10),
                        maxLines = 1
                    )
                }
            }
        }

        IconButton(
            onClick = onRemove,
            modifier = Modifier
                .align(Alignment.TopEnd)
                .background(
                    color = androidx.compose.material3.MaterialTheme.colorScheme.surface.copy(alpha = 0.6f),
                    shape = RoundedCornerShape(50)
                )
                .size(24.dp)
        ) {
            Icon(Icons.Outlined.Close, contentDescription = "移除")
        }
    }
}

private fun Context.buildPendingAttachment(uri: Uri): PendingAttachment? {
    val resolver = contentResolver
    val mime = resolver.getType(uri) ?: "application/octet-stream"
    val metaPair: Pair<String, Long?> = resolver.query(uri, null, null, null, null)?.use { cursor ->
        val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
        if (cursor.moveToFirst()) {
            val displayName = if (nameIndex >= 0) cursor.getString(nameIndex) else uri.lastPathSegment ?: "附件"
            val size = if (sizeIndex >= 0) cursor.getLong(sizeIndex) else null
            Pair(displayName, size)
        } else null
    } ?: Pair(uri.lastPathSegment ?: "附件", null)
    val (displayName, size) = metaPair
    val type = if (mime.startsWith("image/")) AttachmentType.IMAGE else AttachmentType.DOCUMENT
    return PendingAttachment(
        uri = uri,
        mime = mime,
        name = displayName,
        sizeBytes = size,
        type = type
    )
}
