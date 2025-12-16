package me.atri.data.api.request

import kotlinx.serialization.Serializable

/**
 * 前端上传对话日志时使用的请求体，与 Worker 契约保持一致。
 */
@Serializable
data class ConversationLogRequest(
    val logId: String? = null,
    val userId: String,
    val role: String,
    val content: String,
    val timestamp: Long,
    val attachments: List<ChatRequest.AttachmentPayload> = emptyList(),
    val mood: String? = null,
    val userName: String? = null,
    val timeZone: String? = null,
    val date: String? = null
)

@Serializable
data class ConversationDeleteRequest(
    val userId: String,
    val ids: List<String>
)
