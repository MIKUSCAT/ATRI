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

@Serializable
data class RegenerateAcceptResponse(
    val taskId: String,
    val status: String
)

@Serializable
data class RegenerateStatusResponse(
    val taskId: String,
    val currentPhase: String? = null,
    val completedPhases: Int = 0,
    val totalPhases: Int = 0,
    val percent: Int = 0,
    val error: String? = null,
    val entry: DiaryEntryDto? = null
)
