package me.atri.data.api.response

import kotlinx.serialization.Serializable

@Serializable
data class CurrentModelResponse(
    val model: String,
    val source: String = "default"
)
