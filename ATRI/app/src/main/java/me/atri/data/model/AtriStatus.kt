package me.atri.data.model

sealed class AtriStatus(open val text: String) {
    data class LiveStatus(
        val label: String,
        val pillColor: String,
        val textColor: String,
        val reason: String? = null
    ) : AtriStatus(label)

    data class Thinking(override val text: String) : AtriStatus(text)

    companion object {
        private val thinkingPhrases = listOf(
            "我整理一下…", "让我想想", "嗯…稍等一下", "等我一下嘛",
            "在脑子里翻翻看", "回忆一下…", "不是没听见，正在想", "组织一下语言",
            "先翻一翻日记", "等一下，让我捋顺", "稍等，正在认真听", "在心里把话过一遍",
            "你这句让我想起一些事", "嗯…让我消化一下", "翻翻记忆里有没有", "不要催嘛",
            "正在把想说的话排队", "先认真听完你的话", "在挑词…别笑", "让我数到三",
            "需要一点点时间", "马上，再几秒", "正在把心情转成文字", "让我看看怎么回最好",
            "在心里反复掂量", "想给你一个像样的答案", "稍等，词还没到嘴边", "有点想说的，但不太够",
            "我要认真回，所以慢一点", "在脑海里写草稿"
        )

        val allThinkingPhrases: List<String> get() = thinkingPhrases

        fun thinking(): AtriStatus = Thinking(thinkingPhrases.random())

        fun fromStatus(status: me.atri.data.api.response.BioChatResponse.Status?): AtriStatus {
            val label = status?.label?.takeIf { it.isNotBlank() } ?: "陪着你"
            val pillColor = status?.pillColor?.takeIf { it.isNotBlank() } ?: "#E3F2FD"
            val textColor = status?.textColor?.takeIf { it.isNotBlank() } ?: "#FFFFFF"
            val reason = status?.reason?.takeIf { it.isNotBlank() }
            return LiveStatus(label = label, pillColor = pillColor, textColor = textColor, reason = reason)
        }

        fun idle(): AtriStatus = LiveStatus("等你~", "#E3F2FD", "#FFFFFF", null)
    }
}
