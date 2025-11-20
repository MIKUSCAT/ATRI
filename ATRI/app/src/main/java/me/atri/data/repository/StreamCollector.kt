package me.atri.data.repository

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.ResponseBody

/**
 * 负责解析 SSE 流并以固定节奏回调 UI，避免 ChatRepository 中出现重复逻辑。
 */
class StreamCollector(
    private val json: Json,
    private val sanitize: (String) -> String
) {

    @Serializable
    private data class StreamChunk(
        val type: String,
        val content: String
    )

    suspend fun collect(
        responseBody: ResponseBody?,
        onStreamResponse: suspend (String, String?, Long?, Long?) -> Unit
    ) {
        if (responseBody == null) return

        val textContent = StringBuilder()
        val thinkingContent = StringBuilder()
        var thinkingStartTime: Long? = null
        var thinkingEndTime: Long? = null
        var lastUpdateTime = System.currentTimeMillis()
        // 0 代表无节流，每次分片都立即推送，流式最丝滑
        val updateInterval = 0L

        fun resolveThinkingBounds(chunkType: String) {
            if (chunkType == "reasoning" && thinkingStartTime == null) {
                thinkingStartTime = System.currentTimeMillis()
            }
            if (chunkType == "text" && thinkingContent.isNotEmpty() && thinkingEndTime == null) {
                thinkingEndTime = System.currentTimeMillis()
            }
        }

        suspend fun emit(force: Boolean = false) {
            val now = System.currentTimeMillis()
            if (force || now - lastUpdateTime >= updateInterval) {
                onStreamResponse(
                    sanitize(textContent.toString()),
                    thinkingContent.toString().takeIf { it.isNotEmpty() },
                    thinkingStartTime,
                    thinkingEndTime
                )
                lastUpdateTime = now
            }
        }

        responseBody.byteStream().bufferedReader().use { reader ->
            while (true) {
                val line = reader.readLine() ?: break
                if (!line.startsWith("data: ")) continue
                val data = line.substring(6).trim()
                if (data == "[DONE]" || data.isEmpty()) continue
                try {
                    val chunk = json.decodeFromString<StreamChunk>(data)
                    when (chunk.type) {
                        "reasoning" -> {
                            resolveThinkingBounds(chunk.type)
                            thinkingContent.append(chunk.content)
                        }
                        "text" -> {
                            resolveThinkingBounds(chunk.type)
                            textContent.append(sanitize(chunk.content))
                        }
                    }
                } catch (_: Exception) {
                    textContent.append(sanitize(data))
                }
                emit()
            }
        }
        emit(force = true)
    }
}
