package me.atri.data.api.response

import kotlinx.serialization.Serializable

@Serializable
data class DiaryEntryDto(
    val id: String,
    val userId: String? = null,
    val date: String,
    val summary: String? = null,
    val content: String? = null,
    val mood: String? = null,
    val status: String = "pending",
    val createdAt: Long? = null,
    val updatedAt: Long? = null
)

@Serializable
data class DiaryListResponse(
    val entries: List<DiaryEntryDto> = emptyList()
)

@Serializable
data class DiaryEntryResponse(
    val status: String,
    val entry: DiaryEntryDto? = null,
    val error: String? = null
)
