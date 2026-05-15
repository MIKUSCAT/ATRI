package me.atri.data.api.request

import kotlinx.serialization.Serializable

@Serializable
data class DiaryRegenerateCancelRequest(
    val userId: String,
    val taskId: String
)
