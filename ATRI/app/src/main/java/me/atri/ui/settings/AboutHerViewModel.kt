package me.atri.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import me.atri.data.api.AtriApiService
import me.atri.data.api.response.SelfModelResponse
import me.atri.data.datastore.PreferencesStore

/**
 * 加载“关于她”页面所需数据：远端 self_model 字段。
 * 失败时给出温柔的错误文案，避免暴露 HTTP 细节。
 */
class AboutHerViewModel(
    private val apiService: AtriApiService,
    private val preferencesStore: PreferencesStore
) : ViewModel() {

    data class UiState(
        val isLoading: Boolean = true,
        val errorMessage: String? = null,
        val data: SelfModelResponse? = null
    )

    private val _uiState = MutableStateFlow(UiState())
    val uiState: StateFlow<UiState> = _uiState.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _uiState.value = UiState(isLoading = true)
            runCatching {
                val userId = preferencesStore.userId.first().trim().ifEmpty { "default" }
                apiService.getSelfModel(userId)
            }.onSuccess { response ->
                val body = response.body()
                if (response.isSuccessful && body != null) {
                    _uiState.value = UiState(isLoading = false, data = body)
                } else {
                    _uiState.value = UiState(
                        isLoading = false,
                        errorMessage = "她现在不想被人看…"
                    )
                }
            }.onFailure {
                _uiState.value = UiState(
                    isLoading = false,
                    errorMessage = "她现在不想被人看…"
                )
            }
        }
    }
}
