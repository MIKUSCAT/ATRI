package me.atri.data.api.ws

import kotlinx.serialization.Serializable
import me.atri.data.api.request.ChatRequest
import me.atri.data.api.response.BioChatResponse

@Serializable
data class ChatSocketRequest(
    val type: String,
    val userId: String,
    val content: String? = null,
    val logId: String? = null,
    val imageUrl: String? = null,
    val attachments: List<ChatRequest.AttachmentPayload> = emptyList(),
    val userName: String? = null,
    val clientTimeIso: String? = null,
    val modelKey: String? = null,
    val timeZone: String? = null,
    val after: Long? = null
)

@Serializable
data class ChatSocketResponse(
    val type: String? = null,
    val reply: String? = null,
    val mood: BioChatResponse.Mood? = null,
    val action: String? = null,
    val intimacy: Int? = null,
    val replyLogId: String? = null,
    val replyTimestamp: Long? = null,
    val replyTo: String? = null,
    val message: String? = null
)
