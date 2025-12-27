package me.atri.data.api.response

import kotlinx.serialization.Serializable

@Serializable
data class ProactiveCheckResponse(
    val hasMessage: Boolean,
    val message: ProactiveMessage? = null
)

@Serializable
data class ProactiveMessage(
    val id: String,
    val content: String,
    val contextType: String,
    val timestamp: Long
)

@Serializable
data class ProactiveSettings(
    val enabled: Int,
    val daily_count: Int,
    val quiet_start: Int,
    val quiet_end: Int
)