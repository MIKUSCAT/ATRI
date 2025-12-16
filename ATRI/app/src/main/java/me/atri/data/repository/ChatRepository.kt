package me.atri.data.repository

import android.content.Context
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
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
import kotlinx.coroutines.CancellationException
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
import me.atri.data.api.response.BioChatResponse

data class ChatResult(
    val reply: String,
    val mood: BioChatResponse.Mood?,
    val intimacy: Int
)

class ChatRepository(
    private val messageDao: MessageDao,
    private val messageVersionDao: MessageVersionDao,
    private val apiService: AtriApiService,
    private val preferencesStore: PreferencesStore,
    private val memoryDao: me.atri.data.db.dao.MemoryDao,
    private val context: Context
) {
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
        onUserMessagePrepared: (MessageEntity) -> Unit = {}
    ): Result<ChatResult> = withContext(Dispatchers.IO) {
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
            onUserMessagePrepared(userMessage)
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

            val recentAll = messageDao.getAllMessages()
            val recentMessages = if (recentAll.isNotEmpty()) recentAll.dropLast(1) else recentAll
            val request = buildChatRequest(
                userId = userId,
                content = content,
                attachments = finalUserAttachments,
                recentMessages = recentMessages
            )

            val chatResult = executeChatRequest(request)
            Result.success(chatResult)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun regenerateResponse(
        contextMessages: List<MessageEntity>? = null,
        userContent: String? = null,
        userAttachments: List<Attachment>? = null
    ): Result<ChatResult> = withContext(Dispatchers.IO) {
        try {
            val userId = preferencesStore.ensureUserId()
            val recentMessages = contextMessages ?: messageDao.getAllMessages()
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

            val chatResult = executeChatRequest(request)
            Result.success(chatResult)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun persistAtriMessage(finalMessage: MessageEntity, mood: BioChatResponse.Mood? = null) = withContext(Dispatchers.IO) {
        val cleanedContent = cleanTimestampPrefix(finalMessage.content)
        // 将 PAD 状态转换为 JSON 字符串存储
        val moodJson = if (mood != null) {
            """{"p":${mood.p},"a":${mood.a},"d":${mood.d}}"""
        } else {
            null
        }
        val sanitized = finalMessage.copy(
            content = cleanedContent,
            attachments = finalMessage.attachments,
            mood = moodJson
        )
        val existing = messageDao.getMessageById(sanitized.id)

        val persisted = if (existing == null) {
            messageDao.insert(sanitized)
            sanitized
        } else {
            saveMessageVersion(
                message = existing,
                newContent = sanitized.content,
                newAttachments = sanitized.attachments,
                thinkingContent = sanitized.thinkingContent,
                thinkingStartTime = sanitized.thinkingStartTime,
                thinkingEndTime = sanitized.thinkingEndTime,
                mood = moodJson
            )
        }

        markConversationTouched(persisted.timestamp)

        val userId = preferencesStore.ensureUserId()
        logConversationSafely(
            logId = persisted.id,
            userId = userId,
            userName = null,
            role = "atri",
            content = persisted.content,
            timestamp = persisted.timestamp,
            attachments = persisted.attachments,
            mood = persisted.mood
        )
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
        thinkingEndTime: Long? = null,
        mood: String? = null
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
                thinkingEndTime = thinkingEndTime,
                mood = mood
            )
        } else {
            message.copy(
                content = newContent,
                attachments = newAttachments,
                thinkingContent = thinkingContent,
                thinkingStartTime = thinkingStartTime,
                thinkingEndTime = thinkingEndTime,
                mood = mood
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
        val requestContent = content
        val compatImage = attachments.firstOrNull { it.type == AttachmentType.IMAGE }?.url

        return ChatRequest(
            userId = ensuredUserId,
            content = requestContent,
            imageUrl = compatImage,
            attachments = attachments.map { it.toPayload() },
            recentMessages = recentMessages.map { it.toMessageContext() },
            userName = userName.takeIf { it.isNotBlank() },
            clientTimeIso = currentClientTimeIso(),
            modelKey = preferredModel
        )
    }

    private suspend fun executeChatRequest(request: ChatRequest): ChatResult {
        val response = apiService.sendBioMessage(request)
        if (!response.isSuccessful) {
            throw Exception("API Error: ${response.code()}")
        }
        val body = response.body()
        val reply = body?.reply?.trim().orEmpty()
        if (reply.isEmpty()) {
            throw Exception("空回复")
        }
        return ChatResult(
            reply = reply,
            mood = body?.mood,
            intimacy = body?.intimacy ?: 0
        )
    }

    private fun currentClientTimeIso(): String =
        java.time.OffsetDateTime.now()
            .format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssXXX"))

    private fun MessageEntity.toMessageContext(): ChatRequest.MessageContext =
        ChatRequest.MessageContext(
            content = cleanTimestampPrefix(content),
            isFromAtri = isFromAtri,
            timestampMs = timestamp,
            // 历史消息不携带图片附件，只保留非图片的附件（如文档）
            attachments = attachments
                .filter { it.type != AttachmentType.IMAGE }
                .map { attachment -> attachment.toPayload() }
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
                throw IllegalStateException("上传附件失败: ${response.code()} $errorBody")
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
        attachments: List<Attachment>,
        mood: String? = null
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
            date = date,
            mood = mood
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
            } ?: throw IllegalStateException("无法打开附件: $uri")
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




