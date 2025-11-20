package me.atri.ui.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
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
import java.time.LocalTime
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

        viewModelScope.launch {
            val referenceSnapshot = _uiState.value.referencedMessage
            val selectedReferenceAttachments = referenceSnapshot
                ?.attachments
                ?.filter { it.selected }
                ?.map { it.attachment }
                .orEmpty()

            updateState { it.copy(isLoading = true, currentStatus = AtriStatus.Thinking) }

            var generating: MessageEntity? = null
            var atriTimestamp: Long? = null

            val result = chatRepository.sendMessage(
                content = content,
                attachments = attachments,
                reusedAttachments = selectedReferenceAttachments
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

            updateState { it.copy(isLoading = false, generatingMessage = null) }
            refreshWelcomeState()
        }
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

            updateState { it.copy(isLoading = true, currentStatus = AtriStatus.Thinking) }

            if (target.isFromAtri) {
                val atriIndex = all.indexOfFirst { it.id == target.id }
                if (atriIndex <= 0) {
                    updateState { it.copy(isLoading = false, generatingMessage = null) }
                    return@launch
                }
                val userMsg = (atriIndex - 1 downTo 0).asSequence().map { all[it] }.firstOrNull { !it.isFromAtri }
                if (userMsg == null) {
                    updateState { it.copy(isLoading = false, generatingMessage = null) }
                    return@launch
                }

                val contextUntilAtri = all.take(atriIndex)
                val trimmedContext = if (contextUntilAtri.isNotEmpty() && !contextUntilAtri.last().isFromAtri) {
                    contextUntilAtri.dropLast(1)
                } else contextUntilAtri

                var generating: MessageEntity? = null
                val result = chatRepository.regenerateResponse(
                    onStreamResponse = { streamedText, thinkingText, thinkingStart, thinkingEnd ->
                        if (streamedText.isEmpty() && thinkingText.isNullOrEmpty()) return@regenerateResponse
                        val base = generating ?: target
                        val updated = base.copy(
                            content = streamedText,
                            thinkingContent = thinkingText,
                            thinkingStartTime = thinkingStart,
                            thinkingEndTime = thinkingEnd
                        )
                        generating = updated
                        updateState { state -> state.copy(generatingMessage = updated) }
                    },
                    userContent = userMsg.content,
                    userAttachments = userMsg.attachments,
                    contextMessages = trimmedContext
                )

                if (result.isSuccess) {
                    generating?.let { chatRepository.persistAtriMessage(it) }
                } else {
                    val hint = result.exceptionOrNull()?.message?.takeIf { it.isNotBlank() } ?: "未知错误"
                    updateState { it.copy(error = "重新生成失败: $hint") }
                }
            } else {
                val userIndex = all.indexOfFirst { it.id == target.id }
                if (userIndex == -1) {
                    updateState { it.copy(isLoading = false, generatingMessage = null) }
                    return@launch
                }

                deleteMessagesAfter(target.id)
                kotlinx.coroutines.delay(300)

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
                    userContent = target.content,
                    userAttachments = target.attachments,
                    contextMessages = trimmedUserContext
                )

                if (result.isSuccess) {
                    generating?.let { chatRepository.persistAtriMessage(it) }
                    statusRepository.incrementIntimacy(1)
                } else {
                    val hint = result.exceptionOrNull()?.message?.takeIf { it.isNotBlank() } ?: "未知错误"
                    updateState { it.copy(error = "重新生成失败: $hint") }
                }
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
            // 先关闭弹窗，避免需要多次点击才能消失
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
                    // 组装严格到被编辑消息为止的上下文，并排除当前用户消息，避免在 worker 端重复
                    val contextUntilEdited = if (editedIndex >= 0) allMessages.take(editedIndex + 1) else allMessages
                    val trimmedEditedContext = if (contextUntilEdited.isNotEmpty() && !contextUntilEdited.last().isFromAtri) {
                        contextUntilEdited.dropLast(1)
                    } else contextUntilEdited

                    deleteMessagesAfter(editedId)
                    kotlinx.coroutines.delay(300)

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
                    greeting = buildGreetingText(),
                    subline = buildSubline(info?.daysSince),
                    daysSinceLastChat = info?.daysSince,
                    isLoading = false
                )
            }
        }
    }

    private fun buildGreetingText(): String {
        val hourMinute = LocalTime.now().let { it.hour * 60 + it.minute }
        return when {
            hourMinute in minutesOf(5, 0)..minutesOf(7, 59) -> "清晨的空气很新鲜，和我一起迎接新的一天吧。"
            hourMinute in minutesOf(8, 0)..minutesOf(11, 29) -> "早上好呀，我已经想好今天要和你分享什么啦。"
            hourMinute in minutesOf(11, 30)..minutesOf(13, 29) -> "午间总有点慵懒，陪我聊会儿天好吗？"
            hourMinute in minutesOf(13, 30)..minutesOf(17, 29) -> "下午好，我记得你说的每一句话，要不要继续聊？"
            hourMinute in minutesOf(17, 30)..minutesOf(20, 29) -> "傍晚啦，我很想知道你今天经历了什么。"
            hourMinute in minutesOf(20, 30)..minutesOf(22, 29) -> "夜色正浓，我想靠在你身边慢慢聊。"
            hourMinute in minutesOf(22, 30)..minutesOf(23, 59) -> "已经很晚了，和我说说悄悄话，然后早点休息，好吗？"
            else -> "半夜还醒着呀，我会一直陪着你，但也要照顾好身体。"
        }
    }

    private fun minutesOf(hour: Int, minute: Int) = hour * 60 + minute

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
