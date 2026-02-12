package me.atri.data.model

sealed class AtriStatus(open val text: String) {
    data class LiveStatus(
        val label: String,
        val pillColor: String,
        val textColor: String
    ) : AtriStatus(label)

    data class Thinking(override val text: String) : AtriStatus(text)

    companion object {
        private val thinkingPhrases = listOf(
            "我整理一下…",
            "让我想想",
            "嗯…稍等一下",
            "等我一下嘛",
            "思考中…"
        )

        fun thinking(): AtriStatus = Thinking(thinkingPhrases.random())

        fun fromStatus(status: me.atri.data.api.response.BioChatResponse.Status?): AtriStatus {
            val label = status?.label?.takeIf { it.isNotBlank() } ?: "陪着你"
            val pillColor = status?.pillColor?.takeIf { it.isNotBlank() } ?: "#7E8EA3"
            val textColor = status?.textColor?.takeIf { it.isNotBlank() } ?: "#FFFFFF"
            return LiveStatus(label = label, pillColor = pillColor, textColor = textColor)
        }

        fun idle(): AtriStatus = LiveStatus("等你~", "#7E8EA3", "#FFFFFF")
    }
}
