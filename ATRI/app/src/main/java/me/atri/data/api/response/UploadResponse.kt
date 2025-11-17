package me.atri.data.api.response

import kotlinx.serialization.Serializable

@Serializable
data class UploadResponse(
    val key: String,
    val url: String,
    val mime: String,
    val size: Long? = null,
    val checksum: String? = null
)

