package me.atri.ui.diary

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import me.atri.data.api.response.DiaryEntryDto
import me.atri.data.repository.DiaryRepository

data class DiaryUiState(
    val isLoading: Boolean = true,
    val entries: List<DiaryEntryDto> = emptyList(),
    val error: String? = null,
    val selectedEntry: DiaryEntryDto? = null,
    val isRefreshingEntry: Boolean = false
)

class DiaryViewModel(
    private val diaryRepository: DiaryRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(DiaryUiState())
    val uiState: StateFlow<DiaryUiState> = _uiState.asStateFlow()

    init {
        refresh()
    }

    fun refresh(limit: Int = 14) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            val result = diaryRepository.fetchRemoteDiaries(limit)
            _uiState.update { state ->
                result.fold(
                    onSuccess = { diaries -> state.copy(isLoading = false, entries = diaries, error = null) },
                    onFailure = { state.copy(isLoading = false, error = it.message ?: "加载失败") }
                )
            }
        }
    }

    fun openDiary(entry: DiaryEntryDto) {
        _uiState.update { it.copy(selectedEntry = entry) }
    }

    fun closeDiary() {
        _uiState.update { it.copy(selectedEntry = null) }
    }

    fun refreshEntry(date: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isRefreshingEntry = true) }
            val result = diaryRepository.fetchDiaryDetail(date)
            _uiState.update { state ->
                val updatedEntry = result.getOrNull()
                val newList = if (updatedEntry != null) {
                    state.entries.map { if (it.date == updatedEntry.date) updatedEntry else it }
                } else {
                    state.entries
                }
                state.copy(
                    entries = newList,
                    selectedEntry = updatedEntry ?: state.selectedEntry,
                    isRefreshingEntry = false,
                    error = result.exceptionOrNull()?.message
                )
            }
        }
    }
}
