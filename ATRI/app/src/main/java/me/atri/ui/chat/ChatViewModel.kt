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
import me.atri.data.repository.StatusRepository
import me.atri.data.datastore.PreferencesStore
import me.atri.data.db.entity.MessageEntity
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.Calendar

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
    val generatingMessage: MessageEntity? = null,
    val displayItems: List<ChatItem> = emptyList(),
    val dateSections: List<ChatDateSection> = emptyList(),
    val currentDateLabel: String = "",
    val isLoading: Boolean = false,
    val currentStatus: AtriStatus = AtriStatus.Online,
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

    private data class DisplayPayload(
        val items: List<ChatItem>,
        val sections: List<ChatDateSection>,
        val currentDateLabel: String
    )

    private fun combineMessages(
        history: List<MessageEntity>,
        generating: MessageEntity?
    ): List<MessageEntity> {
        generating ?: return history
        val existingIndex = history.indexOfFirst { it.id == generating.id }
        return if (existingIndex >= 0) {
            history.toMutableList().also { it[existingIndex] = generating }
        } else {
            history + generating
        }
    }

    private fun buildDisplayPayload(
        historyMessages: List<MessageEntity>,
        generatingMessage: MessageEntity?
    ): DisplayPayload {
        val combined = combineMessages(historyMessages, generatingMessage)
        val items = mutableListOf<ChatItem>()
        val sections = mutableListOf<ChatDateSection>()
        var lastDate: LocalDate? = null
        var lastMessage: MessageEntity? = null

        combined.forEach { message ->
            val date = Instant.ofEpochMilli(message.timestamp).atZone(zoneId).toLocalDate()
            if (date != lastDate) {
                val label = buildDateDisplayLabel(date, zoneId)
                sections.add(
                    ChatDateSection(
                        date = date,
                        label = label,
                        firstIndex = items.size,
                        count = 0
                    )
                )
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

        val currentLabel = combined.lastOrNull()?.let { latest ->
            val date = Instant.ofEpochMilli(latest.timestamp).atZone(zoneId).toLocalDate()
            buildDateDisplayLabel(date, zoneId)
        } ?: buildDateDisplayLabel(LocalDate.now(zoneId), zoneId)

        return DisplayPayload(
            items = items,
            sections = sections,
            currentDateLabel = currentLabel
        )
    }

    private fun ChatUiState.applyDisplayPayload(): ChatUiState {
        val payload = buildDisplayPayload(historyMessages, generatingMessage)
        return copy(
            displayItems = payload.items,
            dateSections = payload.sections,
            currentDateLabel = payload.currentDateLabel
        )
    }

    private fun updateState(transform: (ChatUiState) -> ChatUiState) {
        _uiState.update { current ->
            val updated = transform(current)
            updated.applyDisplayPayload()
        }
    }

    init {
        observeMessagesAndUpdateStatus()
        refreshWelcomeState()
        updateState { it }
    }

    private fun observeMessagesAndUpdateStatus() {
        viewModelScope.launch {
            chatRepository.observeMessages().collect { messages ->
                val lastMessageTime = messages.lastOrNull()?.timestamp ?: 0
                val hoursSince = ((System.currentTimeMillis() - lastMessageTime) / (1000 * 60 * 60)).toInt()
                val currentHour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)

                val status = AtriStatus.calculate(
                    isGenerating = _uiState.value.isLoading,
                    hoursSinceLastChat = hoursSince,
                    currentHour = currentHour
                )
                updateState { it.copy(historyMessages = messages, currentStatus = status) }
            }
        }
    }

    fun sendMessage(content: String, attachments: List<PendingAttachment> = emptyList()) {
        if (content.isBlank() && attachments.isEmpty()) return
        if (currentSendJob?.isActive == true) return

        currentSendJob = viewModelScope.launch {
            val referenceSnapshot = _uiState.value.referencedMessage
            val selectedReferenceAttachments = referenceSnapshot
                ?.attachments
                ?.filter { it.selected }
                ?.map { it.attachment }
                .orEmpty()

            updateState { it.copy(isLoading = true, currentStatus = AtriStatus.Thinking) }

            var generating: MessageEntity? = null
            var atriTimestamp: Long? = null

            try {
                val result = chatRepository.sendMessage(
                    content = content,
                    attachments = attachments,
                    reusedAttachments = selectedReferenceAttachments,
                    onUserMessagePrepared = { message ->
                        pendingUserMessageId = message.id
                    }
                ) { streamedText, thinkingText, thinkingStart, thinkingEnd ->
                    if (streamedText.isEmpty() && thinkingText.isNullOrEmpty()) return@sendMessage
                    val resolvedTimestamp = atriTimestamp ?: run {
                        val now = System.currentTimeMillis()
                        val latestUser = _uiState.value.historyMessages.lastOrNull { !it.isFromAtri }?.timestamp
                        val adjusted = latestUser?.let { maxOf(now, it + 1) } ?: now
                        atriTimestamp = adjusted
                        adjusted
                    }
                    val base = generating ?: MessageEntity(
                        content = streamedText,
                        isFromAtri = true,
                        timestamp = resolvedTimestamp,
                        thinkingContent = thinkingText,
                        thinkingStartTime = thinkingStart,
                        thinkingEndTime = thinkingEnd
                    )
                    val updated = base.copy(
                        content = streamedText,
                        thinkingContent = thinkingText,
                        thinkingStartTime = thinkingStart,
                        thinkingEndTime = thinkingEnd
                    )
                    generating = updated
                    updateState { state -> state.copy(generatingMessage = updated) }
                }

                if (result.isSuccess) {
                    generating?.let { chatRepository.persistAtriMessage(it) }
                    statusRepository.incrementIntimacy(1)
                    if (referenceSnapshot != null) {
                        clearReferencedAttachments()
                    }
                } else {
                    val errorHint = result.exceptionOrNull()?.message?.takeIf { it.isNotBlank() } ?: "未知错误"
                    updateState { it.copy(error = "发送失败: $errorHint") }
                }
            } catch (cancel: CancellationException) {
                cleanupCancelledSend()
                throw cancel
            } finally {
                pendingUserMessageId = null
                updateState { it.copy(isLoading = false, generatingMessage = null) }
                if (isActive) {
                    refreshWelcomeState()
                }
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
        runCatching {
            chatRepository.deleteMessage(logId, syncRemote = false)
        }
        runCatching {
            chatRepository.deleteConversationLogs(listOf(logId))
        }
        updateState { it.copy(generatingMessage = null, isLoading = false, currentStatus = AtriStatus.Online) }
    }

    fun referenceAttachmentsFrom(message: MessageEntity) {
        val imageAttachments = message.attachments.filter { it.type == AttachmentType.IMAGE }
        if (imageAttachments.isEmpty()) return
        val state = ChatUiState.ReferencedMessage(
            messageId = message.id,
            timestamp = message.timestamp,
            attachments = imageAttachments.map {
                ChatUiState.ReferencedAttachment(attachment = it, selected = true)
            }
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
                if (entry.attachment.url == url) {
                    entry.copy(selected = !entry.selected)
                } else {
                    entry
                }
            }
        )
        updateState { it.copy(referencedMessage = updated) }
    }

    fun editMessage(message: MessageEntity, newContent: String) {
        viewModelScope.launch {
            chatRepository.editMessage(message.id, newContent, syncRemote = true)
            if (!message.isFromAtri) {
                updateState {
                    it.copy(
                        showRegeneratePrompt = true,
                        editedMessageId = message.id
                    )
                }
            }
        }
    }

    private suspend fun deleteMessagesAfter(messageId: String) {
        val messages = _uiState.value.historyMessages
        val index = messages.indexOfFirst { it.id == messageId }
        if (index != -1) {
            val removed = messages.drop(index + 1)
            removed.forEach { msg ->
                chatRepository.deleteMessage(msg.id)
            }
            val removedIds = removed.map { it.id }
            if (removedIds.isNotEmpty()) {
                chatRepository.deleteConversationLogs(removedIds)
            }
        }
    }

    fun deleteMessage(id: String) {
        viewModelScope.launch {
            chatRepository.deleteMessage(id, syncRemote = true)
        }
    }

    fun regenerateMessage(message: MessageEntity? = null) {
        viewModelScope.launch {
            val all = _uiState.value.historyMessages
            val target = message ?: all.lastOrNull { it.isFromAtri }
            if (target == null) return@launch
            val (userMessage, userIndex) = if (target.isFromAtri) {
                val atriIndex = all.indexOfFirst { it.id == target.id }
                if (atriIndex <= 0) {
                    null
                } else {
                    val index = (atriIndex - 1 downTo 0).firstOrNull { !all[it].isFromAtri }
                    index?.let { all[it] to it }
                }
            } else {
                val index = all.indexOfFirst { it.id == target.id }
                if (index == -1) null else all[index] to index
            } ?: return@launch

            updateState { it.copy(isLoading = true, currentStatus = AtriStatus.Thinking) }

            deleteMessagesAfter(userMessage.id)
            delay(300)

            val contextUntilUser = all.take(userIndex + 1)
            val trimmedUserContext = if (contextUntilUser.isNotEmpty() && !contextUntilUser.last().isFromAtri) {
                contextUntilUser.dropLast(1)
            } else contextUntilUser

            var generating: MessageEntity? = null
            val timestamp = System.currentTimeMillis()

            val result = chatRepository.regenerateResponse(
                onStreamResponse = { streamedText, thinkingText, thinkingStart, thinkingEnd ->
                    if (streamedText.isEmpty() && thinkingText.isNullOrEmpty()) return@regenerateResponse
                    val base = generating ?: MessageEntity(
                        content = streamedText,
                        isFromAtri = true,
                        timestamp = timestamp,
                        thinkingContent = thinkingText,
                        thinkingStartTime = thinkingStart,
                        thinkingEndTime = thinkingEnd
                    )
                    val updated = base.copy(
                        content = streamedText,
                        thinkingContent = thinkingText,
                        thinkingStartTime = thinkingStart,
                        thinkingEndTime = thinkingEnd
                    )
                    generating = updated
                    updateState { state -> state.copy(generatingMessage = updated) }
                },
                userContent = userMessage.content,
                userAttachments = userMessage.attachments,
                contextMessages = trimmedUserContext
            )

            if (result.isSuccess) {
                generating?.let { chatRepository.persistAtriMessage(it) }
                statusRepository.incrementIntimacy(1)
            } else {
                val hint = result.exceptionOrNull()?.message?.takeIf { it.isNotBlank() } ?: "未知错误"
                updateState { it.copy(error = "重新生成失败: $hint") }
            }

            updateState { it.copy(isLoading = false, generatingMessage = null) }
        }
    }

    fun switchMessageVersion(messageId: String, versionIndex: Int) {
        viewModelScope.launch {
            chatRepository.switchMessageVersion(messageId, versionIndex)
        }
    }

    fun dismissRegeneratePrompt(shouldRegenerate: Boolean) {
        viewModelScope.launch {
            val editedId = _uiState.value.editedMessageId
            updateState {
                it.copy(
                    showRegeneratePrompt = false,
                    editedMessageId = null
                )
            }

            if (shouldRegenerate && editedId != null) {
                val allMessages = _uiState.value.historyMessages
                val editedIndex = allMessages.indexOfFirst { it.id == editedId }
                val editedMessage = allMessages.getOrNull(editedIndex)

                if (editedMessage != null && !editedMessage.isFromAtri) {
                    val contextUntilEdited = if (editedIndex >= 0) allMessages.take(editedIndex + 1) else allMessages
                    val trimmedEditedContext = if (contextUntilEdited.isNotEmpty() && !contextUntilEdited.last().isFromAtri) {
                        contextUntilEdited.dropLast(1)
                    } else contextUntilEdited

                    deleteMessagesAfter(editedId)
                    delay(300)

                    updateState { it.copy(isLoading = true, currentStatus = AtriStatus.Thinking) }

                    var generating: MessageEntity? = null
                    val timestamp = System.currentTimeMillis()

                    val result = chatRepository.regenerateResponse(
                        onStreamResponse = { streamedText, thinkingText, thinkingStart, thinkingEnd ->
                            if (streamedText.isEmpty() && thinkingText.isNullOrEmpty()) return@regenerateResponse
                            val base = generating ?: MessageEntity(
                                content = streamedText,
                                isFromAtri = true,
                                timestamp = timestamp,
                                thinkingContent = thinkingText,
                                thinkingStartTime = thinkingStart,
                                thinkingEndTime = thinkingEnd
                            )
                            val updated = base.copy(
                                content = streamedText,
                                thinkingContent = thinkingText,
                                thinkingStartTime = thinkingStart,
                                thinkingEndTime = thinkingEnd
                            )
                            generating = updated
                            updateState { state -> state.copy(generatingMessage = updated) }
                        },
                        userContent = editedMessage.content,
                        userAttachments = editedMessage.attachments,
                        contextMessages = trimmedEditedContext
                    )

                    if (result.isSuccess) {
                        generating?.let { chatRepository.persistAtriMessage(it) }
                        statusRepository.incrementIntimacy(1)
                    } else {
                        val hint = result.exceptionOrNull()?.message?.takeIf { it.isNotBlank() } ?: "未知错误"
                        updateState { it.copy(error = "重新生成失败: $hint") }
                    }

                    updateState { it.copy(isLoading = false, generatingMessage = null) }
                }
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
        viewModelScope.launch {
            preferencesStore.setAtriAvatarPath(path)
        }
    }

    fun clearAtriAvatar() {
        viewModelScope.launch {
            preferencesStore.clearAtriAvatar()
        }
    }
}
