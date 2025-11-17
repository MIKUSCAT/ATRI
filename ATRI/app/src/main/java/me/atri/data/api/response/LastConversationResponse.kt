package me.atri.data.api.response

import kotlinx.serialization.Serializable

@Serializable
data class LastConversationResponse(
    val status: String,
    val date: String? = null,
    val daysSince: Int? = null,
    val error: String? = null
)
