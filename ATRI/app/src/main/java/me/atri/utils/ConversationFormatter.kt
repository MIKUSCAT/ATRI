package me.atri.utils

import me.atri.data.db.entity.MessageEntity
import me.atri.data.model.Attachment
import me.atri.data.model.AttachmentType

object ConversationFormatter {
    fun buildConversationLog(messages: List<MessageEntity>): String {
        if (messages.isEmpty()) return ""
        val zone = java.time.ZoneId.systemDefault()
        val formatter = java.time.format.DateTimeFormatter.ofPattern("HH:mm")
        val builder = StringBuilder()
        val maxChars = 3000
        for (message in messages.takeLast(60)) {
            val time = java.time.Instant.ofEpochMilli(message.timestamp)
                .atZone(zone)
                .toLocalTime()
                .format(formatter)
            val speaker = if (message.isFromAtri) "ATRI" else "你"
            val content = sanitizeMessage(message.content, message.attachments)
            if (content.isBlank()) continue
            builder.append("[").append(time).append(" ").append(speaker).append("] ")
                .append(content)
                .append('\n')
            if (builder.length >= maxChars) break
        }
        return builder.toString().trim()
    }

    private fun sanitizeMessage(
        content: String,
        attachments: List<Attachment>
    ): String {
        val cleaned = content
            .replace(Regex("^\\[\\d{4}-\\d{2}-\\d{2}T[\\d:.]+Z\\s+ATRI\\]\\s*"), "")
            .trim()
        if (cleaned.isNotBlank()) {
            return cleaned
        }
        val hasImage = attachments.any { it.type == AttachmentType.IMAGE }
        val hasDoc = attachments.any { it.type == AttachmentType.DOCUMENT }
        return when {
            hasImage && hasDoc -> "发送了图片和文件"
            hasImage -> "发送了一张图片"
            hasDoc -> "发送了一个文件"
            else -> ""
        }
    }
}
