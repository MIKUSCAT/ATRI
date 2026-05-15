package me.atri.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import me.atri.data.UserDataManager
import me.atri.data.api.AtriApiService
import me.atri.data.datastore.PreferencesStore
import me.atri.data.repository.ChatRepository

data class SettingsUiState(
    val apiUrl: String = "",
    val userName: String = "",
    val userId: String = "",
    val appToken: String = "",
    val isLoading: Boolean = false,
    val isClearing: Boolean = false,
    val isSyncing: Boolean = false,
    val statusMessage: String? = null
)

class SettingsViewModel(
    private val preferencesStore: PreferencesStore,
    private val userDataManager: UserDataManager,
    @Suppress("UNUSED_PARAMETER") apiService: AtriApiService,
    private val chatRepository: ChatRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    init {
        loadSettings()
    }

    private fun loadSettings() {
        viewModelScope.launch {
            preferencesStore.apiUrl.collect { url ->
                _uiState.update { it.copy(apiUrl = url) }
            }
        }
        viewModelScope.launch {
            preferencesStore.userName.collect { name ->
                _uiState.update { it.copy(userName = name) }
            }
        }
        viewModelScope.launch {
            preferencesStore.userId.collect { id ->
                _uiState.update { it.copy(userId = id) }
            }
        }
        viewModelScope.launch {
            preferencesStore.appToken.collect { token ->
                _uiState.update { it.copy(appToken = token) }
            }
        }
    }

    fun updateApiUrl(url: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, statusMessage = null) }
            preferencesStore.setApiUrl(url)
            _uiState.update { it.copy(isLoading = false, statusMessage = "已更新 API 地址") }
        }
    }

    fun updateUserName(name: String) {
        viewModelScope.launch {
            preferencesStore.setUserName(name)
            _uiState.update { it.copy(statusMessage = "昵称已保存") }
        }
    }

    fun updateAppToken(token: String) {
        viewModelScope.launch {
            preferencesStore.setAppToken(token.trim())
            _uiState.update { it.copy(statusMessage = "已保存鉴权 Token") }
        }
    }

    fun importUserId(input: String) {
        val trimmed = input.trim()
        if (trimmed.isEmpty()) {
            _uiState.update { it.copy(statusMessage = "UID 不能为空") }
            return
        }
        viewModelScope.launch {
            preferencesStore.setUserId(trimmed)
            _uiState.update { it.copy(userId = trimmed, statusMessage = "已导入 UID") }
        }
    }

    fun clearMemories() {
        if (_uiState.value.isClearing) return
        viewModelScope.launch {
            _uiState.update { it.copy(isClearing = true, statusMessage = null) }
            runCatching {
                userDataManager.clearLocalDataAndResetUser()
            }.onSuccess {
                _uiState.update {
                    it.copy(
                        isClearing = false,
                        statusMessage = "已清空聊天、日记与向量标识，接下来是全新的 ATRI。"
                    )
                }
            }.onFailure { error ->
                _uiState.update {
                    it.copy(
                        isClearing = false,
                        statusMessage = "清空失败：${error.message ?: "未知错误"}"
                    )
                }
            }
        }
    }

    fun syncHistory() {
        if (_uiState.value.isSyncing) return
        viewModelScope.launch {
            _uiState.update { it.copy(isSyncing = true, statusMessage = "正在同步...") }
            runCatching {
                chatRepository.syncRemoteHistory()
            }.onSuccess { result ->
                result.onSuccess { syncResult ->
                    _uiState.update {
                        it.copy(
                            isSyncing = false,
                            statusMessage = "同步完成：新增 ${syncResult.insertedCount} 条，删除 ${syncResult.deletedCount} 条"
                        )
                    }
                }.onFailure { error ->
                    _uiState.update {
                        it.copy(
                            isSyncing = false,
                            statusMessage = "同步失败：${error.message ?: "未知错误"}"
                        )
                    }
                }
            }.onFailure { error ->
                _uiState.update {
                    it.copy(
                        isSyncing = false,
                        statusMessage = "同步失败：${error.message ?: "未知错误"}"
                    )
                }
            }
        }
    }
}
