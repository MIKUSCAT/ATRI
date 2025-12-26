package me.atri.data.api.request

import kotlinx.serialization.Serializable

@Serializable
data class ChatRequest(
    val userId: String,
    val content: String,
    // 当前这条“用户消息”的日志 id（用于服务端从 D1 拉取当天历史时去重）
    val logId: String? = null,
    val imageUrl: String? = null,
    val attachments: List<AttachmentPayload> = emptyList(),
    // 新增：默认注入用户名称与客户端本地时间（到秒，含时区）
    val userName: String? = null,
    val clientTimeIso: String? = null,
    val modelKey: String? = null
) {
    @Serializable
    data class AttachmentPayload(
        val type: String,
        val url: String,
        val mime: String? = null,
        val name: String? = null,
        val sizeBytes: Long? = null
    )
}
