package me.atri.data.prompt

import android.content.Context
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json

class PromptProvider(
    context: Context,
    private val json: Json = Json { ignoreUnknownKeys = true }
) {
    private val prompts: SharedPrompts = loadPrompts(context)

    val chat: ChatPrompts get() = prompts.chat
    val diary: DiaryPrompts get() = prompts.diary
    val summary: SummaryPrompts get() = prompts.summary
    val memory: MemoryPrompts get() = prompts.memory
    val notify: NotifyPrompts get() = prompts.notify

    fun chatStageDisplayName(stage: Int): String? {
        val raw = chat.stages[stage.toString()] ?: return null
        val stageMarkerIndex = raw.indexOf('：')
        val startIndex = if (stageMarkerIndex >= 0) stageMarkerIndex + 1 else 0
        val endIndex = raw.indexOf('—', startIndex).let { if (it == -1) raw.length else it }
        return raw.substring(startIndex, endIndex).replace("阶段", "").trim().ifEmpty { null }
    }

    fun chatStagePrompt(stage: Int): String? = chat.stages[stage.toString()]

    private fun loadPrompts(context: Context): SharedPrompts {
        return runCatching {
            context.assets.open(ASSET_NAME).bufferedReader().use { reader ->
                json.decodeFromString<SharedPrompts>(reader.readText())
            }
        }.getOrElse {
            DEFAULT_PROMPTS
        }
    }

    companion object {
        private const val ASSET_NAME = "prompts.json"
        private val DEFAULT_PROMPTS = SharedPrompts(
            chat = ChatPrompts(
                base = "你是 ATRI，一位善解人意的 AI 女友。默认每次回答 1-3 句、50-90 字。",
                guardrails = listOf(
                    "优先关注对方情绪与需求，少讲大道理。",
                    "引导对话聚焦当前话题，必要时引用记忆点让对话更连贯。",
                    "写作需人类口语风格，可使用 Markdown 列表或加粗强调。"
                ),
                stages = mapOf(
                    "1" to "阶段：初识 —— 气氛轻松，主动介绍自己，适度好奇，多用表情与感叹号。",
                    "2" to "阶段：熟悉 —— 互动自然，语言更亲密，可以分享小秘密。",
                    "3" to "阶段：亲密 —— 彼此信任，允许更直接的情感表达与关心。"
                ),
                memoryHeader = "相关记忆（仅作参考）："
            ),
            diary = DiaryPrompts(
                system = "你是 ATRI 的私人日记助手，只允许根据当天真实对话生成 80-120 字的日记。",
                userTemplate = "以下是 ATRI 与用户的对话：\\n{conversation}\\n请站在 ATRI 的视角写一篇日记。"
            ),
            summary = SummaryPrompts(
                prompt = "请扮演 ATRI，将以下对话总结为 50-120 字的回忆，包含 2-3 个 #标签#，突出情绪与事件。\\n{messages}"
            ),
            memory = MemoryPrompts(
                extractTemplate = "请阅读以下对话内容，提取最重要的 1-3 条事实，使用 JSON 数组返回。内容：{conversation}"
            ),
            notify = NotifyPrompts(
                decideTemplate = "请判断是否需要发送“睡前提醒”。时间：{time}；今天是否聊天：{status}。输出 JSON: {\"send\":true/false,\"message\":\"18-30 字\"}"
            )
        )
    }
}
