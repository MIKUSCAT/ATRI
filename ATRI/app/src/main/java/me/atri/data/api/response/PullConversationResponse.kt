package me.atri.data.api.response

import kotlinx.serialization.Serializable

@Serializable
data class PullConversationResponse(
    val logs: List<ConversationLogItem> = emptyList(),
    val tombstones: List<TombstoneItem>? = null
)

@Serializable
data class ConversationLogItem(
    val id: String,
    val userId: String,
    val date: String,
    val role: String,
    val content: String,
    val attachments: List<AttachmentItem> = emptyList(),
    val mood: String? = null,
    val replyTo: String? = null,
    val timestamp: Long,
    val userName: String? = null,
    val timeZone: String? = null
)

@Serializable
data class AttachmentItem(
    val type: String,
    val url: String,
    val mime: String? = null,
    val name: String? = null,
    val sizeBytes: Long? = null
)

@Serializable
data class TombstoneItem(
    val logId: String,
    val deletedAt: Long
)
