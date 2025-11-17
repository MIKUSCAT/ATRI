package me.atri.data.repository

import android.content.Context
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import me.atri.data.api.AtriApiService
import me.atri.data.api.request.ChatRequest
import me.atri.data.api.request.ConversationDeleteRequest
import me.atri.data.api.request.ConversationLogRequest
import me.atri.data.db.dao.MessageDao
import me.atri.data.db.dao.MessageVersionDao
import me.atri.data.db.entity.MessageEntity
import me.atri.data.db.entity.MessageVersionEntity
import me.atri.data.datastore.PreferencesStore
import me.atri.data.model.Attachment
import me.atri.data.model.AttachmentContract
import me.atri.data.model.AttachmentType
import me.atri.data.model.PendingAttachment
import kotlin.text.RegexOption
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody
import okio.buffer
import okio.source
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import me.atri.data.model.LastConversationInfo

class ChatRepository(
    private val messageDao: MessageDao,
    private val messageVersionDao: MessageVersionDao,
    private val apiService: AtriApiService,
    private val preferencesStore: PreferencesStore,
    private val memoryDao: me.atri.data.db.dao.MemoryDao,
    private val context: Context
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val streamCollector = StreamCollector(json) { cleanTimestampPrefix(it) }
    companion object {
        // 与 worker/src/index.ts 中的 TIMESTAMP 前缀清理逻辑保持一致
        private val ATRI_TIMESTAMP_PREFIX_REGEX = Regex(
            pattern = "^\\[\\d{4}-\\d{2}-\\d{2}T[\\d:.]+Z\\s+ATRI\\]\\s*",
            options = setOf(RegexOption.MULTILINE)
        )
        private val GENERIC_TIMESTAMP_PREFIX_REGEX = Regex(
            pattern = "^\\[[^]]+\\]\\s*",
            options = setOf(RegexOption.MULTILINE)
        )
    }

    fun observeMessages(): Flow<List<MessageEntity>> = messageDao.observeAll()

    private val zoneId: ZoneId = ZoneId.systemDefault()
    private val isoFormatter: DateTimeFormatter = DateTimeFormatter.ISO_LOCAL_DATE

    suspend fun sendMessage(
        content: String,
        attachments: List<PendingAttachment>,
        reusedAttachments: List<Attachment> = emptyList(),
        onStreamResponse: suspend (String, String?, Long?, Long?) -> String?
    ): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val userId = preferencesStore.ensureUserId()
            val userNameForLog = preferencesStore.userName.first().takeIf { it.isNotBlank() }
            val uploadedAttachments = uploadPendingAttachments(userId, attachments)
            val finalUserAttachments = mergeAttachmentLists(
                primary = uploadedAttachments,
                secondary = reusedAttachments
            )

            val userMessage = MessageEntity(
                content = content,
                isFromAtri = false,
                timestamp = System.currentTimeMillis(),
                attachments = finalUserAttachments
            )
            messageDao.insert(userMessage)
            markConversationTouched(userMessage.timestamp)
            logConversationSafely(
                logId = userMessage.id,
                userId = userId,
                userName = userNameForLog,
                role = "user",
                content = userMessage.content,
                timestamp = userMessage.timestamp,
                attachments = finalUserAttachments
            )

            val recentAll = messageDao.getRecentMessages(20).sortedBy { it.timestamp }
            val recentMessages = if (recentAll.isNotEmpty()) recentAll.dropLast(1) else recentAll
            val request = buildChatRequest(
                userId = userId,
                content = content,
                attachments = finalUserAttachments,
                recentMessages = recentMessages
            )

            var atriFinalText = ""
            var atriMessageId: String? = null
            executeChatRequest(request) { streamedText, thinkingText, thinkingStart, thinkingEnd ->
                atriFinalText = streamedText
                val idFromCallback = onStreamResponse(streamedText, thinkingText, thinkingStart, thinkingEnd)
                if (!idFromCallback.isNullOrBlank()) {
                    atriMessageId = idFromCallback
                }
            }
            if (atriFinalText.isNotBlank() && !atriMessageId.isNullOrBlank()) {
                val atriMessage = messageDao.getMessageById(atriMessageId!!)
                logConversationSafely(
                    logId = atriMessageId,
                    userId = userId,
                    userName = null,
                    role = "atri",
                    content = atriFinalText,
                    timestamp = atriMessage?.timestamp ?: System.currentTimeMillis(),
                    attachments = atriMessage?.attachments ?: emptyList()
                )
            }
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
    suspend fun insertAtriMessage(content: String): String {
        val entity = MessageEntity(
            content = content,
            isFromAtri = true,
            timestamp = System.currentTimeMillis()
        )
        messageDao.insert(entity)
        markConversationTouched(entity.timestamp)
        return entity.id
    }

    suspend fun regenerateResponse(
        onStreamResponse: suspend (String, String?, Long?, Long?) -> String?,
        contextMessages: List<MessageEntity>? = null,
        userContent: String? = null,
        userAttachments: List<Attachment>? = null
    ): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val userId = preferencesStore.ensureUserId()
            val recentMessages = contextMessages ?: messageDao.getRecentMessages(20).sortedBy { it.timestamp }
            val lastUserMessage = recentMessages.lastOrNull { !it.isFromAtri }

            val finalContent = userContent ?: lastUserMessage?.content
                ?: return@withContext Result.failure(Exception("No user message found"))
            val finalAttachments = userAttachments ?: lastUserMessage?.attachments ?: emptyList()

            val request = buildChatRequest(
                userId = userId,
                content = finalContent,
                attachments = finalAttachments,
                recentMessages = recentMessages
            )

            var atriFinalText = ""
            var atriMessageId: String? = null
            executeChatRequest(request) { streamedText, thinkingText, thinkingStart, thinkingEnd ->
                atriFinalText = streamedText
                val idFromCallback = onStreamResponse(streamedText, thinkingText, thinkingStart, thinkingEnd)
                if (!idFromCallback.isNullOrBlank()) {
                    atriMessageId = idFromCallback
                }
            }
            if (atriFinalText.isNotBlank() && !atriMessageId.isNullOrBlank()) {
                val atriMessage = messageDao.getMessageById(atriMessageId!!)
                logConversationSafely(
                    logId = atriMessageId,
                    userId = userId,
                    userName = null,
                    role = "atri",
                    content = atriFinalText,
                    timestamp = atriMessage?.timestamp ?: System.currentTimeMillis(),
                    attachments = atriMessage?.attachments ?: emptyList()
                )
            }
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
    suspend fun editMessage(
        id: String,
        newContent: String,
        newAttachments: List<Attachment>? = null,
        thinkingContent: String? = null,
        thinkingStartTime: Long? = null,
        thinkingEndTime: Long? = null,
        syncRemote: Boolean = false
    ) = withContext(Dispatchers.IO) {
        val message = messageDao.getMessageById(id) ?: return@withContext
        val attachmentsToUse = newAttachments ?: message.attachments

        val updated = saveMessageVersion(
            message = message,
            newContent = newContent,
            newAttachments = attachmentsToUse,
            thinkingContent = thinkingContent,
            thinkingStartTime = thinkingStartTime,
            thinkingEndTime = thinkingEndTime
        )

        if (syncRemote) {
            val userId = preferencesStore.ensureUserId()
            val userNameForLog = if (updated.isFromAtri) null else preferencesStore.userName.first().takeIf { it.isNotBlank() }
            logConversationSafely(
                logId = updated.id,
                userId = userId,
                userName = userNameForLog,
                role = if (updated.isFromAtri) "atri" else "user",
                content = updated.content,
                timestamp = updated.timestamp,
                attachments = updated.attachments
            )
        }
    }

    suspend fun deleteMessage(id: String, syncRemote: Boolean = false) = withContext(Dispatchers.IO) {
        messageDao.softDelete(id)
        if (syncRemote) {
            deleteConversationLogs(listOf(id))
        }
    }

    suspend fun undoDelete(id: String) {
        messageDao.undoDelete(id)
    }

    suspend fun toggleImportant(id: String, important: Boolean) {
        messageDao.updateImportant(id, important)
    }

    suspend fun regenerateMessage(messageId: String, newContent: String) = withContext(Dispatchers.IO) {
        val message = messageDao.getRecentMessages(1000).find { it.id == messageId } ?: return@withContext
        if (!message.isFromAtri) return@withContext

        saveMessageVersion(
            message = message,
            newContent = newContent,
            newAttachments = message.attachments
        )
    }

    suspend fun deleteConversationLogs(ids: List<String>) = withContext(Dispatchers.IO) {
        if (ids.isEmpty()) return@withContext
        val userId = preferencesStore.ensureUserId()
        runCatching {
            val response = apiService.deleteConversationLogs(
                ConversationDeleteRequest(
                    userId = userId,
                    ids = ids
                )
            )
            if (!response.isSuccessful) {
                throw IllegalStateException("conversation delete failed: ${response.code()}")
            }
            response.body()?.close()
        }.onFailure {
            println("对话日志删除失败: ${it.message}")
        }
    }

    private suspend fun saveMessageVersion(
        message: MessageEntity,
        newContent: String,
        newAttachments: List<Attachment>,
        thinkingContent: String? = null,
        thinkingStartTime: Long? = null,
        thinkingEndTime: Long? = null
    ): MessageEntity {
        val existingVersions = messageVersionDao.getVersions(message.id)
        if (existingVersions.isEmpty()) {
            messageVersionDao.insert(
                MessageVersionEntity(
                    messageId = message.id,
                    content = message.content,
                    attachments = message.attachments,
                    timestamp = message.timestamp,
                    versionIndex = 0
                )
            )
        }

        val newVersionIndex = message.totalVersions
        val maxVersions = 5

        val updatedMessage = if (newVersionIndex < maxVersions) {
            messageVersionDao.insert(
                MessageVersionEntity(
                    messageId = message.id,
                    content = newContent,
                    attachments = newAttachments,
                    versionIndex = newVersionIndex
                )
            )

            message.copy(
                content = newContent,
                attachments = newAttachments,
                currentVersionIndex = newVersionIndex,
                totalVersions = newVersionIndex + 1,
                thinkingContent = thinkingContent,
                thinkingStartTime = thinkingStartTime,
                thinkingEndTime = thinkingEndTime
            )
        } else {
            message.copy(
                content = newContent,
                attachments = newAttachments,
                thinkingContent = thinkingContent,
                thinkingStartTime = thinkingStartTime,
                thinkingEndTime = thinkingEndTime
            )
        }

        messageDao.update(updatedMessage)
        return updatedMessage
    }

    suspend fun switchMessageVersion(messageId: String, versionIndex: Int) = withContext(Dispatchers.IO) {
        val message = messageDao.getRecentMessages(1000).find { it.id == messageId } ?: return@withContext
        val version = messageVersionDao.getVersion(messageId, versionIndex) ?: return@withContext

        messageDao.update(
            message.copy(
                content = version.content,
                attachments = version.attachments,
                currentVersionIndex = versionIndex
            )
        )
    }

    suspend fun getMessageVersions(messageId: String): List<MessageVersionEntity> =
        withContext(Dispatchers.IO) {
            messageVersionDao.getVersions(messageId)
        }

    private suspend fun buildChatRequest(
        userId: String? = null,
        content: String,
        attachments: List<Attachment>,
        recentMessages: List<MessageEntity>
    ): ChatRequest {
        val ensuredUserId = userId ?: preferencesStore.ensureUserId()
        val userName = preferencesStore.userName.first()
        val preferredModel = preferencesStore.modelName.first().takeIf { it.isNotBlank() }
        val messageCount = messageDao.getMessageCount()
        val requestContent = augmentContentWithDayContext(content)
        val compatImage = attachments.firstOrNull { it.type == AttachmentType.IMAGE }?.url

        return ChatRequest(
            userId = ensuredUserId,
            content = requestContent,
            imageUrl = compatImage,
            attachments = attachments.map { it.toPayload() },
            recentMessages = recentMessages.map { it.toMessageContext() },
            currentStage = calculateStage(messageCount),
            userName = userName.takeIf { it.isNotBlank() },
            clientTimeIso = currentClientTimeIso(),
            modelKey = preferredModel
        )
    }

    private suspend fun executeChatRequest(
        request: ChatRequest,
        onStreamResponse: suspend (String, String?, Long?, Long?) -> Unit
    ) {
        val response = apiService.sendMessage(request)
        if (response.isSuccessful) {
            streamCollector.collect(response.body(), onStreamResponse)
        } else {
            throw Exception("API Error: ${response.code()}")
        }
    }

    private fun calculateStage(messageCount: Int): Int = when {
        messageCount < 80 -> 1      // 阶段1：初遇（1-80条，约3-4天）
        messageCount < 200 -> 2     // 阶段2：熟识（81-200条，约7-10天）
        messageCount < 400 -> 3     // 阶段3：亲近（201-400条，约2-3周）
        messageCount < 700 -> 4     // 阶段4：心动（401-700条，约1个月）
        else -> 5                   // 阶段5：挚爱（700+条，长期陪伴）
    }

    // 问时即取：当用户问“昨天/前天/某日我说了什么”时，自动附带当日消息记录
    private suspend fun augmentContentWithDayContext(originalContent: String): String {
        val zone = java.time.ZoneId.systemDefault()
        val day = detectDayQuery(originalContent, zone) ?: return originalContent
        val messages = messageDao.getMessagesInRange(day.startMs, day.endMs)
        val userOnly = messages.filterNot { it.isFromAtri }
        if (userOnly.isEmpty()) return originalContent

        val timeFormatter = java.time.format.DateTimeFormatter.ofPattern("HH:mm:ss")
        val historyLines = userOnly.joinToString("\n") { message ->
            val timeText = java.time.Instant.ofEpochMilli(message.timestamp)
                .atZone(zone)
                .toLocalTime()
                .format(timeFormatter)
            "[$timeText 你] ${message.content}"
        }
        val prefix = "以下是你在${day.humanLabel}的发言记录（时间升序，仅用户消息）：\n"
        return prefix + historyLines + "\n\n问题：" + originalContent
    }

    private data class DayRange(val startMs: Long, val endMs: Long, val humanLabel: String)

    private fun detectDayQuery(text: String, zone: java.time.ZoneId): DayRange? {
        val lower = text.lowercase()
        val today = java.time.LocalDate.now(zone)

        val day: java.time.LocalDate? = when {
            "昨天" in lower -> today.minusDays(1)
            "前天" in lower -> today.minusDays(2)
            "今天" in lower -> today
            else -> {
                val ymd = Regex("(\\d{4})-(\\d{1,2})-(\\d{1,2})").find(text)?.let {
                    val (y, m, d) = it.destructured
                    runCatching { java.time.LocalDate.of(y.toInt(), m.toInt(), d.toInt()) }.getOrNull()
                }
                ymd ?: run {
                    val ymdCn = Regex("(\\d{4})年(\\d{1,2})月(\\d{1,2})日").find(text)?.let {
                        val (y, m, d) = it.destructured
                        runCatching { java.time.LocalDate.of(y.toInt(), m.toInt(), d.toInt()) }.getOrNull()
                    }
                    ymdCn ?: run {
                        val mdCn = Regex("(\\d{1,2})月(\\d{1,2})日").find(text)?.let {
                            val (m, d) = it.destructured
                            runCatching { java.time.LocalDate.of(today.year, m.toInt(), d.toInt()) }.getOrNull()
                        }
                        mdCn
                    }
                }
            }
        }

        day ?: return null
        val startMs = day.atStartOfDay(zone).toInstant().toEpochMilli()
        val endMs = day.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli() - 1

        val humanLabel = when (day) {
            today -> "今天"
            today.minusDays(1) -> "昨天"
            today.minusDays(2) -> "前天"
            else -> day.toString()
        }
        return DayRange(startMs, endMs, humanLabel)
    }

    private fun currentClientTimeIso(): String =
        java.time.OffsetDateTime.now()
            .format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssXXX"))

    private fun MessageEntity.toMessageContext(): ChatRequest.MessageContext =
        ChatRequest.MessageContext(
            content = cleanTimestampPrefix(content),
            isFromAtri = isFromAtri,
            timestampMs = timestamp,
            attachments = attachments.map { attachment ->
                attachment.toPayload()
            }
        )
    private fun cleanTimestampPrefix(content: String): String {
        // 清理形如 [2025-11-11T14:06:12.034Z ATRI] 的前缀，与 worker 的正则保持一致
        return content
            .replace(ATRI_TIMESTAMP_PREFIX_REGEX, "")
            .replace(GENERIC_TIMESTAMP_PREFIX_REGEX, "")
    }

    private suspend fun uploadPendingAttachments(
        userId: String,
        pending: List<PendingAttachment>
    ): List<Attachment> {
        if (pending.isEmpty()) return emptyList()
        val result = mutableListOf<Attachment>()
        for (attachment in pending) {
            val fileName = attachment.name.ifBlank { "attachment-${System.currentTimeMillis()}" }
            val mime = attachment.mime.ifBlank {
                context.contentResolver.getType(attachment.uri) ?: "application/octet-stream"
            }
            val mediaType = mime.toMediaTypeOrNull()
            val body = ContentUriRequestBody(context, attachment.uri, mediaType)
            val response = apiService.uploadAttachment(
                fileName = fileName,
                mime = mime,
                size = attachment.sizeBytes,
                userId = userId,
                body = body
            )
            if (!response.isSuccessful) {
                val errorBody = response.errorBody()?.string()
                throw IllegalStateException("涓婁紶闄勪欢澶辫触: ${response.code()} $errorBody")
            }
            val payload = response.body() ?: throw IllegalStateException("上传附件失败：响应为空")
            result.add(
                Attachment(
                    type = attachment.type,
                    url = payload.url,
                    mime = payload.mime,
                    name = attachment.name,
                    sizeBytes = payload.size ?: attachment.sizeBytes
                )
            )
        }
        return result
    }

    private fun Attachment.toPayload(): ChatRequest.AttachmentPayload {
        val normalizedType = when (type) {
            AttachmentType.IMAGE -> AttachmentContract.TYPE_IMAGE
            AttachmentType.DOCUMENT -> AttachmentContract.TYPE_DOCUMENT
        }
        return ChatRequest.AttachmentPayload(
            type = normalizedType,
            url = url,
            mime = mime,
            name = name,
            sizeBytes = sizeBytes
        )
    }

    private suspend fun logConversationSafely(
        logId: String? = null,
        userId: String,
        userName: String?,
        role: String,
        content: String,
        timestamp: Long,
        attachments: List<Attachment>
    ) {
        if (content.isBlank()) return
        val date = Instant.ofEpochMilli(timestamp)
            .atZone(zoneId)
            .toLocalDate()
            .format(isoFormatter)
        val request = ConversationLogRequest(
            logId = logId,
            userId = userId,
            role = role,
            content = content,
            timestamp = timestamp,
            attachments = attachments.map { it.toPayload() },
            userName = userName,
            timeZone = zoneId.id,
            date = date
        )
        runCatching {
            val response = apiService.logConversation(request)
            if (!response.isSuccessful) {
                throw IllegalStateException("conversation log failed: ${response.code()}")
            }
            response.body()?.close()
        }.onFailure {
            println("对话日志写入失败: ${it.message}")
        }
    }

    private class ContentUriRequestBody(
        private val context: Context,
        private val uri: Uri,
        private val mediaType: okhttp3.MediaType?
    ) : RequestBody() {
        override fun contentType(): okhttp3.MediaType? = mediaType

        override fun writeTo(sink: okio.BufferedSink) {
            context.contentResolver.openInputStream(uri)?.use { input ->
                val source = input.source().buffer()
                sink.writeAll(source)
            } ?: throw IllegalStateException("鏃犳硶鎵撳紑闄勪欢锛?uri")
        }
    }
    private fun mergeAttachmentLists(
        primary: List<Attachment>,
        secondary: List<Attachment>
    ): List<Attachment> {
        if (secondary.isEmpty()) return primary
        val merged = linkedMapOf<String, Attachment>()
        fun append(list: List<Attachment>) {
            list.forEach { attachment ->
                val key = "${attachment.type}:${attachment.url}"
                if (!merged.containsKey(key)) {
                    merged[key] = attachment
                }
            }
        }
        append(primary)
        append(secondary)
        return merged.values.toList()
    }

    private suspend fun markConversationTouched(timestamp: Long) {
        val date = Instant.ofEpochMilli(timestamp)
            .atZone(zoneId)
            .toLocalDate()
            .format(isoFormatter)
        preferencesStore.setLastConversationDate(date)
    }

    suspend fun fetchLastConversationInfo(): Result<LastConversationInfo?> = withContext(Dispatchers.IO) {
        try {
            val userId = preferencesStore.ensureUserId()
            val response = apiService.fetchLastConversation(
                userId = userId,
                timeZone = zoneId.id
            )
            if (!response.isSuccessful) {
                return@withContext Result.failure(Exception("last conversation failed: ${response.code()}"))
            }
            val body = response.body()
            if (body == null || body.status == "missing" || body.date.isNullOrBlank()) {
                return@withContext Result.success(fallbackLastConversation())
            }
            Result.success(
                LastConversationInfo(
                    date = body.date,
                    daysSince = body.daysSince ?: 0
                )
            )
        } catch (e: Exception) {
            Result.success(fallbackLastConversation())
        }
    }

    private suspend fun fallbackLastConversation(): LastConversationInfo? {
        val stored = preferencesStore.lastConversationDate.first().takeIf { it.isNotBlank() } ?: return null
        return runCatching {
            val last = LocalDate.parse(stored)
            val today = LocalDate.now(zoneId)
            val diff = ChronoUnit.DAYS.between(last, today).toInt()
            LastConversationInfo(stored, diff)
        }.getOrNull()
    }
}




