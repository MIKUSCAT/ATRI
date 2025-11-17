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
import java.util.Calendar
import java.time.LocalTime

data class ChatUiState(
    val messages: List<MessageEntity> = emptyList(),
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

    init {
        observeMessagesAndUpdateStatus()
        refreshWelcomeState()
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
                _uiState.update { it.copy(messages = messages, currentStatus = status) }
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

            _uiState.update { it.copy(isLoading = true, currentStatus = AtriStatus.Thinking) }

            var currentMessageId: String? = null
            var isFirstChunk = true

            val result = chatRepository.sendMessage(
                content = content,
                attachments = attachments,
                reusedAttachments = selectedReferenceAttachments
            ) { streamedText, thinkingText, thinkingStart, thinkingEnd ->
                if (isFirstChunk && streamedText.isNotEmpty()) {
                    val atriMessage = MessageEntity(
                        content = streamedText,
                        isFromAtri = true,
                        timestamp = System.currentTimeMillis(),
                        thinkingContent = thinkingText,
                        thinkingStartTime = thinkingStart,
                        thinkingEndTime = thinkingEnd
                    )
                    // 以仓库返回的真实ID为准，后续才能正确进行编辑更新
                    currentMessageId = chatRepository.insertAtriMessage(atriMessage.content)
                    isFirstChunk = false
                } else if (currentMessageId != null) {
                    chatRepository.editMessage(
                        currentMessageId!!,
                        streamedText,
                        thinkingContent = thinkingText,
                        thinkingStartTime = thinkingStart,
                        thinkingEndTime = thinkingEnd
                    )
                }
                currentMessageId
            }

            if (result.isSuccess) {
                statusRepository.incrementIntimacy(1)
                if (referenceSnapshot != null) {
                    clearReferencedAttachments()
                }
            } else {
                _uiState.update { it.copy(error = "发送失败: ${result.exceptionOrNull()?.message}") }
                if (currentMessageId != null) {
                    chatRepository.deleteMessage(currentMessageId!!)
                }
            }

            _uiState.update { it.copy(isLoading = false) }
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
        _uiState.update { it.copy(referencedMessage = state) }
    }

    fun clearReferencedAttachments() {
        _uiState.update { it.copy(referencedMessage = null) }
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
        _uiState.update { it.copy(referencedMessage = updated) }
    }

    fun editMessage(message: MessageEntity, newContent: String) {
        viewModelScope.launch {
            chatRepository.editMessage(message.id, newContent, syncRemote = true)
            if (!message.isFromAtri) {
                _uiState.update {
                    it.copy(
                        showRegeneratePrompt = true,
                        editedMessageId = message.id
                    )
                }
            }
        }
    }

    private suspend fun deleteMessagesAfter(messageId: String) {
        val messages = _uiState.value.messages
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
            val all = _uiState.value.messages
            val target = message ?: all.lastOrNull { it.isFromAtri }
            if (target == null) return@launch

            _uiState.update { it.copy(isLoading = true, currentStatus = AtriStatus.Thinking) }

            if (target.isFromAtri) {
                // 基于该 ATRI 消息之前的上下文重算，并覆盖该条消息
                val atriIndex = all.indexOfFirst { it.id == target.id }
                if (atriIndex <= 0) { _uiState.update { it.copy(isLoading = false) }; return@launch }
                val userMsg = (atriIndex - 1 downTo 0).asSequence().map { all[it] }.firstOrNull { !it.isFromAtri }
                if (userMsg == null) { _uiState.update { it.copy(isLoading = false) }; return@launch }

                val contextUntilAtri = all.take(atriIndex)
                val trimmedContext = if (contextUntilAtri.isNotEmpty() && !contextUntilAtri.last().isFromAtri) {
                    contextUntilAtri.dropLast(1)
                } else contextUntilAtri
                val result = chatRepository.regenerateResponse(
                    onStreamResponse = { streamedText, thinkingText, thinkingStart, thinkingEnd ->
                        chatRepository.editMessage(
                            target.id,
                            streamedText,
                            thinkingContent = thinkingText,
                            thinkingStartTime = thinkingStart,
                            thinkingEndTime = thinkingEnd
                        )
                        target.id
                    },
                    userContent = userMsg.content,
                    userAttachments = userMsg.attachments,
                    contextMessages = trimmedContext
                )

                if (result.isFailure) {
                    _uiState.update { it.copy(error = "重新生成失败: ${result.exceptionOrNull()?.message}") }
                }

                _uiState.update { it.copy(isLoading = false) }
            } else {
                // 选择的是用户消息：删除其后的消息，并基于它重算，新增一条 ATRI 消息
                val userIndex = all.indexOfFirst { it.id == target.id }
                if (userIndex == -1) { _uiState.update { it.copy(isLoading = false) }; return@launch }

                // 删除其后的消息，保持与 RikkaHub 一致的“截断后重生”语义
                deleteMessagesAfter(target.id)
                kotlinx.coroutines.delay(300)

                val contextUntilUser = all.take(userIndex + 1)
                val trimmedUserContext = if (contextUntilUser.isNotEmpty() && !contextUntilUser.last().isFromAtri) {
                    contextUntilUser.dropLast(1)
                } else contextUntilUser

                var currentMessageId: String? = null
                var isFirstChunk = true

                val result = chatRepository.regenerateResponse(
                    onStreamResponse = { streamedText, thinkingText, thinkingStart, thinkingEnd ->
                        if (isFirstChunk && streamedText.isNotEmpty()) {
                            val atriMessage = MessageEntity(
                                content = streamedText,
                                isFromAtri = true,
                                timestamp = System.currentTimeMillis(),
                                thinkingContent = thinkingText,
                                thinkingStartTime = thinkingStart,
                                thinkingEndTime = thinkingEnd
                            )
                            currentMessageId = chatRepository.insertAtriMessage(streamedText)
                            isFirstChunk = false
                        } else if (currentMessageId != null) {
                            chatRepository.editMessage(
                                currentMessageId!!,
                                streamedText,
                                thinkingContent = thinkingText,
                                thinkingStartTime = thinkingStart,
                                thinkingEndTime = thinkingEnd
                            )
                        }
                        currentMessageId
                    },
                    userContent = target.content,
                    userAttachments = target.attachments,
                    contextMessages = trimmedUserContext
                )

                if (result.isSuccess) {
                    statusRepository.incrementIntimacy(1)
                } else {
                    _uiState.update { it.copy(error = "重新生成失败: ${result.exceptionOrNull()?.message}") }
                    if (currentMessageId != null) {
                        chatRepository.deleteMessage(currentMessageId!!)
                    }
                }

                _uiState.update { it.copy(isLoading = false) }
            }
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
            _uiState.update {
                it.copy(
                    showRegeneratePrompt = false,
                    editedMessageId = null
                )
            }

            if (shouldRegenerate && editedId != null) {
                val allMessages = _uiState.value.messages
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

                    _uiState.update { it.copy(isLoading = true, currentStatus = AtriStatus.Thinking) }

                    var currentMessageId: String? = null
                    var isFirstChunk = true

                    val result = chatRepository.regenerateResponse(
                        onStreamResponse = { streamedText, thinkingText, thinkingStart, thinkingEnd ->
                            if (isFirstChunk && streamedText.isNotEmpty()) {
                                val atriMessage = MessageEntity(
                                    content = streamedText,
                                    isFromAtri = true,
                                    timestamp = System.currentTimeMillis(),
                                    thinkingContent = thinkingText,
                                    thinkingStartTime = thinkingStart,
                                    thinkingEndTime = thinkingEnd
                                )
                                currentMessageId = chatRepository.insertAtriMessage(streamedText)
                                isFirstChunk = false
                            } else if (currentMessageId != null) {
                                chatRepository.editMessage(
                                    currentMessageId!!,
                                    streamedText,
                                    thinkingContent = thinkingText,
                                    thinkingStartTime = thinkingStart,
                                    thinkingEndTime = thinkingEnd
                                )
                            }
                            currentMessageId
                        },
                        userContent = editedMessage.content,
                        userAttachments = editedMessage.attachments,
                        contextMessages = trimmedEditedContext
                    )

                    if (result.isSuccess) {
                        statusRepository.incrementIntimacy(1)
                    } else {
                        _uiState.update { it.copy(error = "重新生成失败: ${result.exceptionOrNull()?.message}") }
                        if (currentMessageId != null) {
                            chatRepository.deleteMessage(currentMessageId!!)
                        }
                    }

                    _uiState.update { it.copy(isLoading = false) }
                }
            }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
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
