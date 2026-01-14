package me.atri.data.repository

import android.content.Context
import android.net.Uri
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
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
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.buffer
import okio.source
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import me.atri.data.model.LastConversationInfo
import me.atri.data.api.response.BioChatResponse
import me.atri.data.api.response.ConversationPullResponse
import me.atri.data.api.ws.ChatSocketRequest
import me.atri.data.api.ws.ChatSocketResponse

data class ChatResult(
    val reply: String,
    val mood: BioChatResponse.Mood?,
    val intimacy: Int,
    val replyLogId: String?,
    val replyTimestamp: Long?,
    val replyTo: String?
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
        private const val PULL_SKEW_MS = 5 * 60 * 1000L
        private const val SOCKET_SEND_TIMEOUT_MS = 60_000L
        private const val SOCKET_WAIT_TIMEOUT_MS = 90_000L
        private const val SOCKET_PATH = "/api/v1/chat/ws"
        private const val DEFAULT_BASE_URL = "https://example.com"
    }

    private val mediaHttpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    private val socketHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    private val socketJson = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    private class ChatSocketException(
        message: String,
        val shouldFallback: Boolean,
        cause: Throwable? = null
    ) : Exception(message, cause)

    fun observeMessages(): Flow<List<MessageEntity>> = messageDao.observeAll()

    private val zoneId: ZoneId = ZoneId.systemDefault()
    private val isoFormatter: DateTimeFormatter = DateTimeFormatter.ISO_LOCAL_DATE

    suspend fun sendMessage(
        content: String,
        attachments: List<PendingAttachment>,
        reusedAttachments: List<Attachment> = emptyList(),
        onUserMessagePrepared: suspend (MessageEntity) -> Unit = {}
    ): Result<ChatResult> = withContext(Dispatchers.IO) {
        try {
            val userId = preferencesStore.ensureUserId()
            val userNameForLog = preferencesStore.userName.first().takeIf { it.isNotBlank() }
            val inlineImageDataUrl = runCatching {
                resolveInlineImageDataUrl(pending = attachments, reused = reusedAttachments)
            }.getOrNull()
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
            try {
                onUserMessagePrepared(userMessage)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                println("用户消息准备回调失败: ${e.message}")
            }
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
            val request = buildChatRequest(
                userId = userId,
                logId = userMessage.id,
                content = content,
                attachments = finalUserAttachments,
                inlineImageDataUrl = inlineImageDataUrl
            )

            val chatResult = executeChatWithFallback(request, SOCKET_SEND_TIMEOUT_MS)
            Result.success(chatResult)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun regenerateResponse(
        userMessageId: String,
        userContent: String,
        userAttachments: List<Attachment>
    ): Result<ChatResult> = withContext(Dispatchers.IO) {
        try {
            val userId = preferencesStore.ensureUserId()
            val inlineImageDataUrl = runCatching {
                resolveInlineImageDataUrlFromAttachments(userAttachments)
            }.getOrNull()

            val request = buildChatRequest(
                userId = userId,
                logId = userMessageId,
                content = userContent,
                attachments = userAttachments,
                inlineImageDataUrl = inlineImageDataUrl
            )

            val chatResult = executeChatWithFallback(request, SOCKET_SEND_TIMEOUT_MS)
            Result.success(chatResult)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun persistAtriMessage(
        finalMessage: MessageEntity,
        mood: BioChatResponse.Mood? = null,
        replyTo: String? = null,
        syncRemote: Boolean = true
    ): Boolean = withContext(Dispatchers.IO) {
        if (shouldSkipReply(replyTo)) {
            return@withContext false
        }
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
                mood = moodJson
            )
        }

        markConversationTouched(persisted.timestamp)

        if (syncRemote) {
            val userId = preferencesStore.ensureUserId()
            logConversationSafely(
                logId = persisted.id,
                userId = userId,
                userName = null,
                role = "atri",
                content = persisted.content,
                timestamp = persisted.timestamp,
                attachments = persisted.attachments,
                mood = persisted.mood,
                replyTo = replyTo
            )
        }
        true
    }

    suspend fun editMessage(
        id: String,
        newContent: String,
        newAttachments: List<Attachment>? = null,
        syncRemote: Boolean = false
    ) = withContext(Dispatchers.IO) {
        val message = messageDao.getMessageById(id) ?: return@withContext
        val attachmentsToUse = newAttachments ?: message.attachments

        val updated = saveMessageVersion(
            message = message,
            newContent = newContent,
            newAttachments = attachmentsToUse
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
        val message = messageDao.getMessageById(id)
        messageDao.softDelete(id)
        if (message != null && !message.isFromAtri) {
            preferencesStore.clearMessageReplied(id)
            preferencesStore.clearMessagePending(id)
        }
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
                mood = mood
            )
        } else {
            message.copy(
                content = newContent,
                attachments = newAttachments,
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
        logId: String? = null,
        content: String,
        attachments: List<Attachment>,
        inlineImageDataUrl: String? = null
    ): ChatRequest {
        val ensuredUserId = userId ?: preferencesStore.ensureUserId()
        val userName = preferencesStore.userName.first()
        val preferredModel = preferencesStore.modelName.first().takeIf { it.isNotBlank() }
        val requestContent = content
        val compatImage = attachments.firstOrNull { it.type == AttachmentType.IMAGE }?.url
        val resolvedInlineImage = inlineImageDataUrl?.takeIf { it.isNotBlank() }
            ?: compatImage?.takeIf { it.isNotBlank() }
        val requestAttachments = if (inlineImageDataUrl.isNullOrBlank()) {
            attachments
        } else {
            attachments.filter { it.type != AttachmentType.IMAGE }
        }

        return ChatRequest(
            userId = ensuredUserId,
            content = requestContent,
            logId = logId,
            imageUrl = resolvedInlineImage,
            attachments = requestAttachments.map { it.toPayload() },
            userName = userName.takeIf { it.isNotBlank() },
            clientTimeIso = currentClientTimeIso(),
            modelKey = preferredModel,
            timeZone = zoneId.id
        )
    }

    private fun ChatRequest.toSocketRequest(): ChatSocketRequest =
        ChatSocketRequest(
            type = "send",
            userId = userId,
            content = content,
            logId = logId,
            imageUrl = imageUrl,
            attachments = attachments,
            userName = userName,
            clientTimeIso = clientTimeIso,
            modelKey = modelKey,
            timeZone = timeZone
        )

    private suspend fun executeChatRequest(request: ChatRequest): ChatResult {
        val response = apiService.sendBioMessage(request)
        if (!response.isSuccessful) {
            throw IllegalStateException("API Error: ${response.code()}")
        }
        val body = response.body()
        val reply = body?.reply?.trim().orEmpty()
        if (reply.isEmpty()) {
            throw IllegalStateException("空回复")
        }
        val replyTo = body?.replyTo?.trim()?.takeIf { it.isNotBlank() } ?: request.logId
        return ChatResult(
            reply = reply,
            mood = body?.mood,
            intimacy = body?.intimacy ?: 0,
            replyLogId = body?.replyLogId?.trim()?.takeIf { it.isNotBlank() },
            replyTimestamp = body?.replyTimestamp,
            replyTo = replyTo
        )
    }

    private suspend fun executeChatWithFallback(request: ChatRequest, timeoutMs: Long): ChatResult {
        return try {
            executeChatSocketRequest(request.toSocketRequest(), timeoutMs)
        } catch (error: Exception) {
            val socketError = error as? ChatSocketException
            if (socketError != null && socketError.shouldFallback) {
                executeChatRequest(request)
            } else {
                throw error
            }
        }
    }

    private suspend fun executeChatSocketRequest(
        request: ChatSocketRequest,
        timeoutMs: Long = SOCKET_SEND_TIMEOUT_MS
    ): ChatResult {
        val socketRequest = buildSocketRequest(request.userId)
        val messageText = socketJson.encodeToString(request)
        val messageSent = AtomicBoolean(false)
        return try {
            withTimeout(timeoutMs) {
                suspendCancellableCoroutine { continuation ->
                    val completed = AtomicBoolean(false)

                    val listener = object : WebSocketListener() {
                        override fun onOpen(webSocket: WebSocket, response: okhttp3.Response) {
                            val sent = webSocket.send(messageText)
                            messageSent.set(sent)
                            if (!sent) {
                                failOnce(
                                    continuation,
                                    completed,
                                    ChatSocketException("WebSocket发送失败", shouldFallback = true)
                                )
                                webSocket.close(1011, "send_failed")
                            }
                        }

                        override fun onMessage(webSocket: WebSocket, text: String) {
                            if (completed.get()) return
                            val payload = runCatching {
                                socketJson.decodeFromString<ChatSocketResponse>(text)
                            }.getOrElse {
                                failOnce(
                                    continuation,
                                    completed,
                                    ChatSocketException("响应解析失败", shouldFallback = false, cause = it)
                                )
                                webSocket.close(1011, "parse_error")
                                return
                            }

                            when (payload.type?.lowercase()) {
                                "reply" -> {
                                    val reply = payload.reply?.trim().orEmpty()
                                    if (reply.isEmpty()) {
                                        failOnce(
                                            continuation,
                                            completed,
                                            ChatSocketException("空回复", shouldFallback = false)
                                        )
                                    } else {
                                        val replyTo = payload.replyTo?.trim()
                                            ?.takeIf { it.isNotBlank() }
                                            ?: request.logId
                                        completeOnce(
                                            continuation,
                                            completed,
                                            ChatResult(
                                                reply = reply,
                                                mood = payload.mood,
                                                intimacy = payload.intimacy ?: 0,
                                                replyLogId = payload.replyLogId?.trim()
                                                    .takeIf { !it.isNullOrBlank() },
                                                replyTimestamp = payload.replyTimestamp,
                                                replyTo = replyTo
                                            )
                                        )
                                    }
                                    webSocket.close(1000, "done")
                                }
                                "error" -> {
                                    val message = payload.message?.takeIf { it.isNotBlank() } ?: "WebSocket错误"
                                    failOnce(
                                        continuation,
                                        completed,
                                        ChatSocketException(message, shouldFallback = false)
                                    )
                                    webSocket.close(1011, "error")
                                }
                                else -> {
                                    // ignore non-reply messages
                                }
                            }
                        }

                        override fun onFailure(
                            webSocket: WebSocket,
                            t: Throwable,
                            response: okhttp3.Response?
                        ) {
                            val message = response?.let { "WebSocket连接失败: ${it.code}" }
                                ?: (t.message ?: "WebSocket连接失败")
                            val shouldFallback = response != null || !messageSent.get()
                            failOnce(
                                continuation,
                                completed,
                                ChatSocketException(message, shouldFallback = shouldFallback, cause = t)
                            )
                        }

                        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                            if (!completed.get()) {
                                val shouldFallback = !messageSent.get()
                                failOnce(
                                    continuation,
                                    completed,
                                    ChatSocketException("连接已关闭", shouldFallback = shouldFallback)
                                )
                            }
                        }
                    }

                    val webSocket = socketHttpClient.newWebSocket(socketRequest, listener)
                    continuation.invokeOnCancellation {
                        webSocket.close(1000, "cancelled")
                    }
                }
            }
        } catch (error: TimeoutCancellationException) {
            throw ChatSocketException("等待回复超时", shouldFallback = !messageSent.get(), cause = error)
        }
    }


    private suspend fun buildSocketRequest(userId: String): Request {
        val baseUrlRaw = preferencesStore.apiUrl.first().trim().ifBlank { DEFAULT_BASE_URL }
        val normalizedBaseUrl = baseUrlRaw
            .replaceFirst("wss://", "https://", ignoreCase = true)
            .replaceFirst("ws://", "http://", ignoreCase = true)
        val baseUrl = normalizedBaseUrl.toHttpUrlOrNull()
            ?: DEFAULT_BASE_URL.toHttpUrlOrNull()
            ?: throw IllegalStateException("无效的 API 地址")
        val wsUrl = baseUrl.newBuilder()
            .encodedPath(SOCKET_PATH)
            .addQueryParameter("userId", userId)
            .build()

        val token = preferencesStore.appToken.first().trim()
        val builder = Request.Builder().url(wsUrl)
        if (token.isNotBlank()) {
            builder.addHeader("X-App-Token", token)
        }
        return builder.build()
    }

    private fun <T> completeOnce(
        continuation: kotlinx.coroutines.CancellableContinuation<T>,
        completed: AtomicBoolean,
        value: T
    ) {
        if (completed.compareAndSet(false, true) && continuation.isActive) {
            continuation.resumeWith(Result.success(value))
        }
    }

    private fun failOnce(
        continuation: kotlinx.coroutines.CancellableContinuation<ChatResult>,
        completed: AtomicBoolean,
        throwable: Throwable
    ) {
        if (completed.compareAndSet(false, true) && continuation.isActive) {
            continuation.resumeWith(Result.failure(throwable))
        }
    }

    private fun currentClientTimeIso(): String =
        java.time.OffsetDateTime.now()
            .format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssXXX"))
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

    private fun normalizeMimeForDataUrl(raw: String?): String {
        val trimmed = raw?.trim().orEmpty()
        if (trimmed.isBlank()) return "application/octet-stream"
        return trimmed.substringBefore(';').trim()
    }

    private fun buildDataUrl(bytes: ByteArray, mime: String): String {
        val normalized = normalizeMimeForDataUrl(mime)
        val encoded = Base64.encodeToString(bytes, Base64.NO_WRAP)
        return "data:$normalized;base64,$encoded"
    }

    private suspend fun resolveInlineImageDataUrl(
        pending: List<PendingAttachment>,
        reused: List<Attachment>
    ): String? {
        val pendingImage = pending.firstOrNull { it.type == AttachmentType.IMAGE }
        if (pendingImage != null) {
            return loadPendingImageAsDataUrl(pendingImage)
        }
        val reusedImage = reused.firstOrNull { it.type == AttachmentType.IMAGE }
        if (reusedImage != null) {
            return loadRemoteImageAsDataUrl(reusedImage)
        }
        return null
    }

    private suspend fun resolveInlineImageDataUrlFromAttachments(attachments: List<Attachment>): String? {
        val image = attachments.firstOrNull { it.type == AttachmentType.IMAGE } ?: return null
        return loadRemoteImageAsDataUrl(image)
    }

    private fun loadPendingImageAsDataUrl(attachment: PendingAttachment): String? {
        val mime = normalizeMimeForDataUrl(
            attachment.mime.takeIf { it.isNotBlank() }
                ?: context.contentResolver.getType(attachment.uri)
        ).let { resolved ->
            if (resolved == "application/octet-stream") "image/jpeg" else resolved
        }
        val bytes = context.contentResolver.openInputStream(attachment.uri)?.use { input ->
            input.readBytes()
        } ?: return null
        return buildDataUrl(bytes, mime)
    }

    private suspend fun loadRemoteImageAsDataUrl(attachment: Attachment): String? {
        val url = attachment.url.trim()
        if (url.isBlank()) return null
        if (url.startsWith("data:")) return url

        val token = preferencesStore.appToken.first().trim()
        val requestBuilder = Request.Builder().url(url)
        if (token.isNotEmpty()) {
            requestBuilder.addHeader("X-App-Token", token)
        }

        return runCatching {
            mediaHttpClient.newCall(requestBuilder.build()).execute().use { response ->
                if (!response.isSuccessful) {
                    throw IllegalStateException("图片拉取失败: ${response.code}")
                }
                val bodyBytes = response.body?.bytes() ?: throw IllegalStateException("图片响应为空")
                val headerMime = response.header("Content-Type")?.substringBefore(';')?.trim()
                val mime = normalizeMimeForDataUrl(
                    attachment.mime.takeIf { it.isNotBlank() } ?: headerMime
                ).let { resolved ->
                    if (resolved == "application/octet-stream") "image/jpeg" else resolved
                }
                buildDataUrl(bodyBytes, mime)
            }
        }.onFailure {
            println("引用图片转 base64 失败: ${it.message}")
        }.getOrNull()
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
        mood: String? = null,
        replyTo: String? = null
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
            mood = mood,
            replyTo = replyTo
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

    private suspend fun shouldSkipReply(replyTo: String?): Boolean {
        val trimmed = replyTo?.trim()?.takeIf { it.isNotBlank() } ?: return false
        val message = messageDao.getMessageById(trimmed) ?: return false
        return message.isDeleted
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

    suspend fun hasPendingReply(): Boolean = withContext(Dispatchers.IO) {
        val last = messageDao.getRecentMessages(1).firstOrNull() ?: return@withContext false
        if (last.isFromAtri) return@withContext false
        val pendingIds = preferencesStore.pendingMessageIds.first()
        if (pendingIds.contains(last.id)) return@withContext true
        val repliedIds = preferencesStore.repliedMessageIds.first()
        !repliedIds.contains(last.id)
    }

    suspend fun waitForRemoteReply(): Result<ChatResult> = withContext(Dispatchers.IO) {
        try {
            val userId = preferencesStore.ensureUserId()
            val after = resolveWaitAfterTimestamp()
            val request = ChatSocketRequest(
                type = "wait",
                userId = userId,
                after = after,
                timeZone = zoneId.id
            )
            val chatResult = executeChatSocketRequest(request, SOCKET_WAIT_TIMEOUT_MS)
            Result.success(chatResult)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    private suspend fun resolveWaitAfterTimestamp(): Long {
        val lastAtriTimestamp = messageDao.getLatestAtriMessageTimestamp() ?: 0L
        val lastMessage = messageDao.getRecentMessages(1).firstOrNull()
        val lastUserTimestamp = if (lastMessage != null && !lastMessage.isFromAtri) {
            lastMessage.timestamp
        } else {
            0L
        }
        val adjustedUserTimestamp = if (lastUserTimestamp > 0L) {
            (lastUserTimestamp - PULL_SKEW_MS).coerceAtLeast(0L)
        } else {
            0L
        }
        return maxOf(lastAtriTimestamp, adjustedUserTimestamp)
    }

    suspend fun pullRemoteReplies(limit: Int = 50): Result<Int> = withContext(Dispatchers.IO) {
        try {
            val userId = preferencesStore.ensureUserId()
            val lastMessageTimestamp = messageDao.getRecentMessages(1).firstOrNull()?.timestamp ?: 0L
            val lastAtriTimestamp = messageDao.getLatestAtriMessageTimestamp()
            val afterTimestamp = when {
                lastAtriTimestamp != null -> lastAtriTimestamp
                lastMessageTimestamp > 0L -> (lastMessageTimestamp - PULL_SKEW_MS).coerceAtLeast(0L)
                else -> 0L
            }
            val response = apiService.pullConversationLogs(
                userId = userId,
                after = afterTimestamp,
                limit = limit,
                role = "atri"
            )
            if (!response.isSuccessful) {
                return@withContext Result.failure(Exception("conversation pull failed: ${response.code()}"))
            }
            val logs = response.body()?.logs.orEmpty()
            if (logs.isEmpty()) {
                return@withContext Result.success(0)
            }

            var latestTimestamp = lastMessageTimestamp
            var normalizedTimestamp = lastMessageTimestamp
            val repliedIds = mutableSetOf<String>()
            logs.forEach { log ->
                if (log.id.isBlank() || log.role != "atri") return@forEach
                if (shouldSkipReply(log.replyTo)) return@forEach
                val replyToId = log.replyTo?.trim()?.takeIf { it.isNotBlank() }
                if (replyToId != null) repliedIds.add(replyToId)
                val rawTimestamp = if (log.timestamp > 0L) log.timestamp else System.currentTimeMillis()
                val timestamp = if (rawTimestamp <= normalizedTimestamp) {
                    normalizedTimestamp + 1
                } else {
                    rawTimestamp
                }
                normalizedTimestamp = timestamp
                val attachments = log.attachments.mapNotNull { it.toAttachment() }
                val message = MessageEntity(
                    id = log.id,
                    content = log.content,
                    isFromAtri = true,
                    timestamp = timestamp,
                    attachments = attachments,
                    mood = log.mood
                )
                messageDao.insert(message)
                if (timestamp > latestTimestamp) {
                    latestTimestamp = timestamp
                }
            }

            if (latestTimestamp > lastMessageTimestamp) {
                markConversationTouched(latestTimestamp)
            }

            if (repliedIds.isNotEmpty()) {
                preferencesStore.markMessagesReplied(repliedIds)
                preferencesStore.clearMessagesPending(repliedIds)
            }

            Result.success(logs.size)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun syncConversationHistory(limit: Int = 200): Result<Int> = withContext(Dispatchers.IO) {
        try {
            val token = preferencesStore.appToken.first().trim()
            val baseUrl = preferencesStore.apiUrl.first().trim()
            val normalizedBaseUrl = baseUrl.trimEnd('/')
            if (token.isBlank() || normalizedBaseUrl.isBlank() || normalizedBaseUrl == DEFAULT_BASE_URL) {
                return@withContext Result.success(0)
            }

            val userId = preferencesStore.ensureUserId()
            val existingIds = messageDao.getMessageIds().toHashSet()
            val lastLocalTimestamp = messageDao.getRecentMessages(1).firstOrNull()?.timestamp ?: 0L
            var after = if (lastLocalTimestamp > 0L) {
                (lastLocalTimestamp - PULL_SKEW_MS).coerceAtLeast(0L)
            } else {
                0L
            }
            var normalizedTimestamp = after
            var latestTimestamp = lastLocalTimestamp
            var inserted = 0
            val repliedIds = mutableSetOf<String>()

            while (true) {
                val response = apiService.pullConversationLogs(
                    userId = userId,
                    after = after,
                    limit = limit,
                    role = null
                )
                if (!response.isSuccessful) {
                    return@withContext Result.failure(Exception("conversation pull failed: ${response.code()}"))
                }
                val logs = response.body()?.logs.orEmpty()
                if (logs.isEmpty()) break

                logs.forEach { log ->
                    if (log.id.isBlank()) return@forEach
                    if (log.role == "atri" && shouldSkipReply(log.replyTo)) return@forEach
                    if (log.role == "atri") {
                        val replyToId = log.replyTo?.trim()?.takeIf { it.isNotBlank() }
                        if (replyToId != null) repliedIds.add(replyToId)
                    }
                    val rawTimestamp = if (log.timestamp > 0L) log.timestamp else System.currentTimeMillis()
                    val timestamp = if (rawTimestamp <= normalizedTimestamp) {
                        normalizedTimestamp + 1
                    } else {
                        rawTimestamp
                    }
                    normalizedTimestamp = timestamp
                    latestTimestamp = maxOf(latestTimestamp, timestamp)

                    if (existingIds.contains(log.id)) return@forEach

                    val attachments = log.attachments.mapNotNull { it.toAttachment() }
                    val isFromAtri = log.role == "atri"
                    val content = if (isFromAtri) cleanTimestampPrefix(log.content) else log.content
                    val message = MessageEntity(
                        id = log.id,
                        content = content,
                        isFromAtri = isFromAtri,
                        timestamp = timestamp,
                        attachments = attachments,
                        mood = if (isFromAtri) log.mood else null
                    )
                    messageDao.insert(message)
                    existingIds.add(log.id)
                    inserted += 1
                }

                if (logs.size < limit) break
                val nextAfter = logs.maxOfOrNull { it.timestamp } ?: after
                after = if (nextAfter > after) nextAfter else normalizedTimestamp
            }

            if (latestTimestamp > 0L) {
                markConversationTouched(latestTimestamp)
            }

            if (repliedIds.isNotEmpty()) {
                preferencesStore.markMessagesReplied(repliedIds)
                preferencesStore.clearMessagesPending(repliedIds)
            }

            Result.success(inserted)
        } catch (e: Exception) {
            Result.failure(e)
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

    private fun ConversationPullResponse.AttachmentPayload.toAttachment(): Attachment? {
        if (url.isBlank()) return null
        val mappedType = when (type) {
            AttachmentContract.TYPE_IMAGE -> AttachmentType.IMAGE
            AttachmentContract.TYPE_DOCUMENT -> AttachmentType.DOCUMENT
            else -> null
        } ?: return null
        val resolvedMime = mime?.ifBlank { null } ?: "application/octet-stream"
        return Attachment(
            type = mappedType,
            url = url,
            mime = resolvedMime,
            name = name,
            sizeBytes = sizeBytes
        )
    }
}




