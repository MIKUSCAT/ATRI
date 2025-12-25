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
import me.atri.data.api.response.ModelInfoResponse
import me.atri.data.datastore.PreferencesStore

data class SettingsUiState(
    val apiUrl: String = "",
    val userName: String = "",
    val modelName: String = "",
    val userId: String = "",
    val appToken: String = "",
    val streamEnabled: Boolean = false,
    val isLoading: Boolean = false,
    val isClearing: Boolean = false,
    val statusMessage: String? = null,
    val availableModels: List<ModelOption> = emptyList(),
    val modelsLoading: Boolean = false,
    val showModelSavedDialog: Boolean = false
) {
    data class ModelOption(
        val id: String,
        val label: String,
        val provider: String? = null,
        val note: String? = null
    )
}

class SettingsViewModel(
    private val preferencesStore: PreferencesStore,
    private val userDataManager: UserDataManager,
    private val apiService: AtriApiService
) : ViewModel() {

    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    init {
        loadSettings()
        refreshModelCatalog()
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
            preferencesStore.modelName.collect { model ->
                _uiState.update { it.copy(modelName = model) }
            }
        }
        viewModelScope.launch {
            preferencesStore.appToken.collect { token ->
                _uiState.update { it.copy(appToken = token) }
            }
        }
        viewModelScope.launch {
            preferencesStore.streamEnabled.collect { enabled ->
                _uiState.update { it.copy(streamEnabled = enabled) }
            }
        }
    }

    fun updateApiUrl(url: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, statusMessage = null) }
            preferencesStore.setApiUrl(url)
            _uiState.update { it.copy(isLoading = false, statusMessage = "已更新 Worker URL") }
        }
    }

    fun updateUserName(name: String) {
        viewModelScope.launch {
            preferencesStore.setUserName(name)
            _uiState.update { it.copy(statusMessage = "昵称已保存") }
        }
    }

    fun updateModelName(model: String) {
        viewModelScope.launch {
            preferencesStore.setModelName(model)
            _uiState.update { it.copy(showModelSavedDialog = true) }
        }
    }

    fun updateAppToken(token: String) {
        viewModelScope.launch {
            preferencesStore.setAppToken(token.trim())
            _uiState.update { it.copy(statusMessage = "已保存鉴权 Token") }
        }
    }

    fun updateStreamEnabled(enabled: Boolean) {
        viewModelScope.launch {
            preferencesStore.setStreamEnabled(enabled)
        }
    }

    fun refreshModelCatalog() {
        if (_uiState.value.modelsLoading) return
        viewModelScope.launch {
            _uiState.update { it.copy(modelsLoading = true) }
            runCatching {
                val response = apiService.fetchModelList()
                if (!response.isSuccessful) {
                    throw IllegalStateException("模型列表请求失败：${response.code()}")
                }
                response.body()?.models.orEmpty()
            }.onSuccess { models ->
                _uiState.update {
                    it.copy(
                        availableModels = models.map { model -> model.toOption() },
                        modelsLoading = false
                    )
                }
            }.onFailure { error ->
                _uiState.update {
                    it.copy(
                        modelsLoading = false,
                        statusMessage = "获取模型列表失败：${error.message ?: "未知错误"}"
                    )
                }
            }
        }
    }

    fun importUserId(input: String) {
        val trimmed = input.trim()
        if (trimmed.isEmpty()) {
            _uiState.update { it.copy(statusMessage = "账号 ID 不能为空") }
            return
        }
        viewModelScope.launch {
            preferencesStore.setUserId(trimmed)
            _uiState.update { it.copy(userId = trimmed, statusMessage = "已导入账号 ID") }
        }
    }

    fun dismissModelSavedDialog() {
        _uiState.update { it.copy(showModelSavedDialog = false) }
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

}

private fun ModelInfoResponse.toOption() = SettingsUiState.ModelOption(
    id = id,
    label = label,
    provider = provider,
    note = note
)
