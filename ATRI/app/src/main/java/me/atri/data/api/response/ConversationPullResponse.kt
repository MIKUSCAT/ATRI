package me.atri.data.api.response

import kotlinx.serialization.Serializable

@Serializable
data class ConversationPullResponse(
    val logs: List<ConversationLogPayload> = emptyList()
) {
    @Serializable
    data class ConversationLogPayload(
        val id: String = "",
        val role: String = "",
        val content: String = "",
        val attachments: List<AttachmentPayload> = emptyList(),
        val mood: String? = null,
        val timestamp: Long = 0L,
        val userName: String? = null,
        val timeZone: String? = null,
        val replyTo: String? = null,
        val date: String? = null
    )

    @Serializable
    data class AttachmentPayload(
        val type: String = "",
        val url: String = "",
        val mime: String? = null,
        val name: String? = null,
        val sizeBytes: Long? = null
    )
}
