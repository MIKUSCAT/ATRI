package me.atri.data.api.response

import kotlinx.serialization.Serializable

@Serializable
data class BioChatResponse(
    val reply: String? = null,
    val status: Status? = null,
    val action: String? = null,
    val intimacy: Int? = null,
    val replyLogId: String? = null,
    val replyTimestamp: Long? = null,
    val replyTo: String? = null
) {
    @Serializable
    data class Status(
        val label: String? = null,
        val pillColor: String? = null,
        val textColor: String? = null
    )
}
