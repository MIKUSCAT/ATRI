package me.atri.data.api.request

import kotlinx.serialization.Serializable

@Serializable
data class DiaryRegenerateRequest(
    val userId: String,
    val date: String
)
