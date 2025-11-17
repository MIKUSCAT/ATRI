package me.atri.data.api.response

import kotlinx.serialization.Serializable

@Serializable
data class ModelListResponse(
    val models: List<ModelInfoResponse> = emptyList()
)

@Serializable
data class ModelInfoResponse(
    val id: String,
    val label: String,
    val provider: String? = null,
    val note: String? = null
)
