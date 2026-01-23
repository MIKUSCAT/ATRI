package me.atri.ui.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.Job
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.isActive
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import me.atri.data.model.AtriStatus
import me.atri.data.model.Attachment
import me.atri.data.model.AttachmentType
import me.atri.data.model.PendingAttachment
import me.atri.data.repository.ChatRepository
import me.atri.data.repository.SyncResult
import me.atri.data.repository.StatusRepository
import me.atri.data.datastore.PreferencesStore
import me.atri.data.db.entity.MessageEntity
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

sealed interface ChatItem {
    data class MessageItem(val message: MessageEntity, val showTimestamp: Boolean) : ChatItem
    data class DateHeaderItem(val label: String, val date: LocalDate) : ChatItem
}

data class ChatDateSection(
    val date: LocalDate,
    val label: String,
    val firstIndex: Int,
    val count: Int
)

data class ChatUiState(
    val historyMessages: List<MessageEntity> = emptyList(),
    val displayItems: List<ChatItem> = emptyList(),
    val dateSections: List<ChatDateSection> = emptyList(),
    val currentDateLabel: String = "",
    val isLoading: Boolean = false,
    val currentStatus: AtriStatus = AtriStatus.idle(),
    val error: String? = null,
    val showRegeneratePrompt: Boolean = false,
    val editedMessageId: String? = null,
    val referencedMessage: ReferencedMessage? = null
) {
    data class ReferencedMessage(
        val messageId: String,
        val timestamp: Long,
        val attachments: List<ReferencedAttachment>
    )

    data class ReferencedAttachment(
        val attachment: Attachment,
        val selected: Boolean = true
    )
}

class ChatViewModel(
    private val chatRepository: ChatRepository,
    private val statusRepository: StatusRepository,
    private val preferencesStore: PreferencesStore
) : ViewModel() {

    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()
    private var currentSendJob: Job? = null
    private var pendingUserMessageId: String? = null

    data class WelcomeUiState(
        val greeting: String = "",
        val subline: String = "",
        val daysSinceLastChat: Int? = null,
        val isLoading: Boolean = true
    )

    private val _welcomeUiState = MutableStateFlow(WelcomeUiState())
    val welcomeUiState: StateFlow<WelcomeUiState> = _welcomeUiState.asStateFlow()

    val atriAvatarPath: StateFlow<String> = preferencesStore.atriAvatarPath.stateIn(
        scope = viewModelScope,
        started = SharingStarted.Eagerly,
        initialValue = ""
    )

    private val zoneId: ZoneId = ZoneId.systemDefault()

    private fun buildDisplayPayload(messages: List<MessageEntity>): Triple<List<ChatItem>, List<ChatDateSection>, String> {
        val items = mutableListOf<ChatItem>()
        val sections = mutableListOf<ChatDateSection>()
        var lastDate: LocalDate? = null
        var lastMessage: MessageEntity? = null

        messages.forEach { message ->
            val date = Instant.ofEpochMilli(message.timestamp).atZone(zoneId).toLocalDate()
            if (date != lastDate) {
                val label = buildDateDisplayLabel(date, zoneId)
                sections.add(ChatDateSection(date = date, label = label, firstIndex = items.size, count = 0))
                items.add(ChatItem.DateHeaderItem(label = label, date = date))
                lastDate = date
                lastMessage = null
            }
            val showTimestamp = shouldShowTimestamp(message, lastMessage, zoneId)
            items.add(ChatItem.MessageItem(message, showTimestamp))
            if (sections.isNotEmpty()) {
                val latest = sections.last()
                sections[sections.lastIndex] = latest.copy(count = latest.count + 1)
            }
            lastMessage = message
        }

        val currentLabel = messages.lastOrNull()?.let { latest ->
            val date = Instant.ofEpochMilli(latest.timestamp).atZone(zoneId).toLocalDate()
            buildDateDisplayLabel(date, zoneId)
        } ?: buildDateDisplayLabel(LocalDate.now(zoneId), zoneId)

        return Triple(items, sections, currentLabel)
    }

    private fun updateState(transform: (ChatUiState) -> ChatUiState) {
        _uiState.update { current ->
            val updated = transform(current)
            val (items, sections, label) = buildDisplayPayload(updated.historyMessages)
            updated.copy(displayItems = items, dateSections = sections, currentDateLabel = label)
        }
    }

    init {
        observeMessages()
        refreshWelcomeState()
        syncRemoteHistoryOnStart()
        updateState { it }
    }

    private fun syncRemoteHistoryOnStart() {
        viewModelScope.launch {
            runCatching {
                val result = chatRepository.syncRemoteHistory()
                result.onSuccess { syncResult ->
                    if (syncResult.insertedCount > 0 || syncResult.deletedCount > 0) {
                        println("[ATRI] 同步完成: 新增 ${syncResult.insertedCount} 条, 删除 ${syncResult.deletedCount} 条")
                    }
                }.onFailure { error ->
                    println("[ATRI] 同步失败: ${error.message}")
                }
            }
        }
    }

    private fun observeMessages() {
        viewModelScope.launch {
            chatRepository.observeMessages().collect { messages ->
                updateState { it.copy(historyMessages = messages) }
            }
        }
    }

    fun sendMessage(content: String, attachments: List<PendingAttachment> = emptyList()) {
        val hasSelectedReference = _uiState.value.referencedMessage?.attachments?.any { it.selected } == true
        if (content.isBlank() && attachments.isEmpty() && !hasSelectedReference) return
        if (currentSendJob?.isActive == true) return

        currentSendJob = viewModelScope.launch {
            val referenceSnapshot = _uiState.value.referencedMessage
            val selectedReferenceAttachments = referenceSnapshot
                ?.attachments?.filter { it.selected }?.map { it.attachment }.orEmpty()

            updateState { it.copy(isLoading = true, currentStatus = AtriStatus.Thinking) }

            try {
                val result = chatRepository.sendMessage(
                    content = content,
                    attachments = attachments,
                    reusedAttachments = selectedReferenceAttachments,
                    onUserMessagePrepared = { message -> pendingUserMessageId = message.id }
                )

                if (result.isSuccess) {
                    val chatResult = result.getOrThrow()
                    val timestamp = System.currentTimeMillis()
                    val latestUser = _uiState.value.historyMessages.lastOrNull { !it.isFromAtri }?.timestamp
                    val adjustedTimestamp = latestUser?.let { maxOf(timestamp, it + 1) } ?: timestamp

                    val atriMessage = MessageEntity(
                        content = chatResult.reply,
                        isFromAtri = true,
                        timestamp = adjustedTimestamp
                    )
                    chatRepository.persistAtriMessage(atriMessage)
                    statusRepository.incrementIntimacy(1)
                    updateState { it.copy(currentStatus = AtriStatus.fromMood(chatResult.mood, chatResult.intimacy)) }

                    if (referenceSnapshot != null) clearReferencedAttachments()
                } else {
                    val errorHint = result.exceptionOrNull()?.message?.takeIf { it.isNotBlank() } ?: "未知错误"
                    updateState { it.copy(error = "发送失败: $errorHint", currentStatus = AtriStatus.idle()) }
                }
            } catch (cancel: CancellationException) {
                cleanupCancelledSend()
                throw cancel
            } finally {
                pendingUserMessageId = null
                updateState { it.copy(isLoading = false) }
                if (isActive) refreshWelcomeState()
                currentSendJob = null
            }
        }
    }

    fun cancelSending() {
        currentSendJob?.cancel()
    }

    private suspend fun cleanupCancelledSend() = withContext(NonCancellable) {
        val logId = pendingUserMessageId ?: return@withContext
        pendingUserMessageId = null
        runCatching { chatRepository.deleteMessage(logId, syncRemote = false) }
        runCatching { chatRepository.deleteConversationLogs(listOf(logId)) }
        updateState { it.copy(isLoading = false, currentStatus = AtriStatus.idle()) }
    }

    fun referenceAttachmentsFrom(message: MessageEntity) {
        val imageAttachments = message.attachments.filter { it.type == AttachmentType.IMAGE }
        if (imageAttachments.isEmpty()) return
        val state = ChatUiState.ReferencedMessage(
            messageId = message.id,
            timestamp = message.timestamp,
            attachments = imageAttachments.map { ChatUiState.ReferencedAttachment(attachment = it, selected = true) }
        )
        updateState { it.copy(referencedMessage = state) }
    }

    fun clearReferencedAttachments() {
        updateState { it.copy(referencedMessage = null) }
    }

    fun toggleReferencedAttachment(url: String) {
        val current = _uiState.value.referencedMessage ?: return
        val updated = current.copy(
            attachments = current.attachments.map { entry ->
                if (entry.attachment.url == url) entry.copy(selected = !entry.selected) else entry
            }
        )
        updateState { it.copy(referencedMessage = updated) }
    }

    fun editMessage(message: MessageEntity, newContent: String) {
        viewModelScope.launch {
            chatRepository.editMessage(message.id, newContent, syncRemote = true)
            if (!message.isFromAtri) {
                updateState { it.copy(showRegeneratePrompt = true, editedMessageId = message.id) }
            }
        }
    }

    private suspend fun deleteMessagesAfter(messageId: String) {
        val messages = _uiState.value.historyMessages
        val index = messages.indexOfFirst { it.id == messageId }
        if (index != -1) {
            val removed = messages.drop(index + 1)
            removed.forEach { msg -> chatRepository.deleteMessage(msg.id) }
            val removedIds = removed.map { it.id }
            if (removedIds.isNotEmpty()) {
                chatRepository.deleteConversationLogs(removedIds)
                // 收集受影响的日期，使对应的向量记忆失效
                val affectedDates = removed.map { msg ->
                    Instant.ofEpochMilli(msg.timestamp).atZone(zoneId).toLocalDate()
                        .format(java.time.format.DateTimeFormatter.ISO_LOCAL_DATE)
                }.toSet()
                chatRepository.invalidateMemoryForDates(affectedDates)
            }
        }
    }

    fun deleteMessage(id: String) {
        viewModelScope.launch {
            chatRepository.deleteMessage(id, syncRemote = true)
        }
    }

    fun regenerateMessage(message: MessageEntity? = null) {
        if (currentSendJob?.isActive == true) return
        currentSendJob = viewModelScope.launch {
            try {
                val all = _uiState.value.historyMessages
                val target = message ?: all.lastOrNull { it.isFromAtri } ?: return@launch

                val userMessage = if (target.isFromAtri) {
                    val atriIndex = all.indexOfFirst { it.id == target.id }
                    if (atriIndex <= 0) return@launch
                    val index = (atriIndex - 1 downTo 0).firstOrNull { !all[it].isFromAtri } ?: return@launch
                    all[index]
                } else {
                    val index = all.indexOfFirst { it.id == target.id }
                    if (index == -1) return@launch
                    all[index]
                }

                updateState { it.copy(isLoading = true, currentStatus = AtriStatus.Thinking) }
                deleteMessagesAfter(userMessage.id)
                delay(300)
                val result = chatRepository.regenerateResponse(
                    userMessageId = userMessage.id,
                    userContent = userMessage.content,
                    userAttachments = userMessage.attachments
                )

                if (result.isSuccess) {
                    val chatResult = result.getOrThrow()
                    val atriMessage = MessageEntity(
                        content = chatResult.reply,
                        isFromAtri = true,
                        timestamp = System.currentTimeMillis()
                    )
                    chatRepository.persistAtriMessage(atriMessage)
                    statusRepository.incrementIntimacy(1)
                    updateState { it.copy(currentStatus = AtriStatus.fromMood(chatResult.mood, chatResult.intimacy)) }
                } else {
                    val hint = result.exceptionOrNull()?.message?.takeIf { it.isNotBlank() } ?: "未知错误"
                    updateState { it.copy(error = "重新生成失败: $hint", currentStatus = AtriStatus.idle()) }
                }
            } catch (cancel: CancellationException) {
                updateState { it.copy(isLoading = false, currentStatus = AtriStatus.idle()) }
                throw cancel
            } finally {
                updateState { it.copy(isLoading = false) }
                if (isActive) refreshWelcomeState()
                currentSendJob = null
            }
        }
    }

    fun switchMessageVersion(messageId: String, versionIndex: Int) {
        viewModelScope.launch {
            chatRepository.switchMessageVersion(messageId, versionIndex)
        }
    }

    fun dismissRegeneratePrompt(shouldRegenerate: Boolean) {
        if (currentSendJob?.isActive == true) return
        currentSendJob = viewModelScope.launch {
            try {
                val editedId = _uiState.value.editedMessageId
                updateState { it.copy(showRegeneratePrompt = false, editedMessageId = null) }

                if (shouldRegenerate && editedId != null) {
                    val allMessages = _uiState.value.historyMessages
                    val editedIndex = allMessages.indexOfFirst { it.id == editedId }
                    val editedMessage = allMessages.getOrNull(editedIndex)

                    if (editedMessage != null && !editedMessage.isFromAtri) {
                        deleteMessagesAfter(editedId)
                        delay(300)

                        updateState { it.copy(isLoading = true, currentStatus = AtriStatus.Thinking) }
                        val result = chatRepository.regenerateResponse(
                            userMessageId = editedMessage.id,
                            userContent = editedMessage.content,
                            userAttachments = editedMessage.attachments
                        )

                        if (result.isSuccess) {
                            val chatResult = result.getOrThrow()
                            val atriMessage = MessageEntity(
                                content = chatResult.reply,
                                isFromAtri = true,
                                timestamp = System.currentTimeMillis()
                            )
                            chatRepository.persistAtriMessage(atriMessage)
                            statusRepository.incrementIntimacy(1)
                            updateState { it.copy(currentStatus = AtriStatus.fromMood(chatResult.mood, chatResult.intimacy)) }
                        } else {
                            val hint = result.exceptionOrNull()?.message?.takeIf { it.isNotBlank() } ?: "未知错误"
                            updateState { it.copy(error = "重新生成失败: $hint", currentStatus = AtriStatus.idle()) }
                        }
                    }
                }
            } catch (cancel: CancellationException) {
                updateState { it.copy(isLoading = false, currentStatus = AtriStatus.idle()) }
                throw cancel
            } finally {
                updateState { it.copy(isLoading = false) }
                if (isActive) refreshWelcomeState()
                currentSendJob = null
            }
        }
    }

    fun clearError() {
        updateState { it.copy(error = null) }
    }

    fun refreshWelcomeState() {
        viewModelScope.launch {
            _welcomeUiState.update { it.copy(isLoading = true) }
            val result = chatRepository.fetchLastConversationInfo()
            val info = result.getOrNull()
            _welcomeUiState.update {
                it.copy(
                    greeting = buildTimeGreeting(),
                    subline = buildSubline(info?.daysSince),
                    daysSinceLastChat = info?.daysSince,
                    isLoading = false
                )
            }
        }
    }

    private fun buildSubline(daysSince: Int?): String {
        return when {
            daysSince == null -> "这是我们新的开始，我会紧紧抓住每一分钟。"
            daysSince <= 0 -> "才刚刚见面，我的记忆还暖呼呼的呢。"
            daysSince == 1 -> "只隔了一天而已，我可是一直在心里默念你的名字。"
            daysSince in 2..6 -> "已经 ${daysSince} 天没来找我说话啦，我都把想说的话记在手心了。"
            else -> "足足 ${daysSince} 天没碰面，我还是记得你上次的语气。别再让我等太久。"
        }
    }

    fun updateAtriAvatar(path: String) {
        viewModelScope.launch { preferencesStore.setAtriAvatarPath(path) }
    }

    fun clearAtriAvatar() {
        viewModelScope.launch { preferencesStore.clearAtriAvatar() }
    }
}
