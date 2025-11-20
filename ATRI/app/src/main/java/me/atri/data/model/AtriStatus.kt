package me.atri.data.model

sealed class AtriStatus(val text: String) {
    object Online : AtriStatus("在线 · 心情不错")
    object Waiting : AtriStatus("在线 · 在等你说话")
    object Missing : AtriStatus("在线 · 有点想你了")
    object Thinking : AtriStatus("在线 · 正在思考...")
    object Sleeping : AtriStatus("离线 · 去睡觉了")

    companion object {
        fun calculate(
            isGenerating: Boolean,
            hoursSinceLastChat: Int,
            currentHour: Int
        ): AtriStatus = when {
            isGenerating -> Thinking
            currentHour in 22..23 || currentHour in 0..6 -> Sleeping
            hoursSinceLastChat > 12 -> Missing
            hoursSinceLastChat > 6 -> Waiting
            else -> Online
        }
    }
}
