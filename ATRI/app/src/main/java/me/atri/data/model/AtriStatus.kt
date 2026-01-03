package me.atri.data.model

sealed class AtriStatus(open val text: String) {
    data class MoodStatus(
        val p: Double,
        val a: Double,
        val d: Double,
        override val text: String
    ) : AtriStatus(text)

    object Thinking : AtriStatus("我整理一下")

    companion object {
        fun fromMood(
            mood: me.atri.data.api.response.BioChatResponse.Mood?,
            intimacy: Int = 0
        ): AtriStatus {
            val p = mood?.p ?: 0.0
            val a = mood?.a ?: 0.0
            val d = mood?.d ?: 0.0

            val moodText = buildMoodText(p, a, d)
            return MoodStatus(p, a, d, moodText)
        }

        private fun buildMoodText(p: Double, a: Double, d: Double): String {
            return when {
                p > 0.3 && a > 0.3 -> "想聊天！"
                p > 0.3 && a <= 0.3 -> "心情好~"
                p < -0.3 && a > 0.3 -> "有点炸"
                p < -0.3 && a <= -0.2 -> "有点丧"
                p <= 0.3 && p >= -0.3 && a < -0.2 -> "放松~"
                else -> "陪着你"
            }
        }

        fun idle(): AtriStatus = MoodStatus(0.0, 0.0, 0.0, "等你~")
    }
}
