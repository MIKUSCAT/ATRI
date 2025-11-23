package me.atri.data.model

data class IntimacyInfo(
    val points: Int,
    val level: Int,
    val levelName: String,
    val nextLevelPoints: Int,
    val progress: Float
)
