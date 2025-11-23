package me.atri.data.prompt

import kotlinx.serialization.Serializable

@Serializable
data class SharedPrompts(
    val chat: ChatPrompts = ChatPrompts(),
    val diary: DiaryPrompts = DiaryPrompts(),
    val summary: SummaryPrompts = SummaryPrompts(),
    val memory: MemoryPrompts = MemoryPrompts(),
    val notify: NotifyPrompts = NotifyPrompts()
)

@Serializable
data class ChatPrompts(
    val base: String = "",
    val guardrails: List<String> = emptyList(),
    val stages: Map<String, String> = emptyMap(),
    val memoryHeader: String = ""
)

@Serializable
data class DiaryPrompts(
    val system: String = "",
    val userTemplate: String = ""
)

@Serializable
data class SummaryPrompts(
    val prompt: String = ""
)

@Serializable
data class MemoryPrompts(
    val extractTemplate: String = ""
)

@Serializable
data class NotifyPrompts(
    val decideTemplate: String = ""
)
