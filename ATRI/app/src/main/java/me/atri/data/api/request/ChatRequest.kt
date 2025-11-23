package me.atri.data.api.request

import kotlinx.serialization.Serializable

@Serializable
data class ChatRequest(
    val userId: String,
    val content: String,
    val imageUrl: String? = null,
    val attachments: List<AttachmentPayload> = emptyList(),
    val recentMessages: List<MessageContext>,
    val currentStage: Int,
    // 新增：默认注入用户名称与客户端本地时间（到秒，含时区）
    val userName: String? = null,
    val clientTimeIso: String? = null,
    val modelKey: String? = null
) {
    @Serializable
    data class MessageContext(
        val content: String,
        val isFromAtri: Boolean,
        // 新增：消息时间戳（毫秒），便于服务端在提示中追加确切时间
        val timestampMs: Long? = null,
        val attachments: List<AttachmentPayload> = emptyList()
    )

    @Serializable
    data class AttachmentPayload(
        val type: String,
        val url: String,
        val mime: String? = null,
        val name: String? = null,
        val sizeBytes: Long? = null
    )
}
