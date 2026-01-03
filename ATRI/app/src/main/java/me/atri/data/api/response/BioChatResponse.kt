package me.atri.data.api.response

import kotlinx.serialization.Serializable

@Serializable
data class BioChatResponse(
    val reply: String? = null,
    val mood: Mood? = null,
    val action: String? = null,
    val intimacy: Int? = null
) {
    @Serializable
    data class Mood(
        val p: Double? = null,
        val a: Double? = null,
        val d: Double? = null
    )
}
