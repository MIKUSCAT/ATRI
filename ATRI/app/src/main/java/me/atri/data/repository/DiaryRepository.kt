package me.atri.data.repository

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.withContext
import me.atri.data.api.AtriApiService
import me.atri.data.api.request.DiaryRegenerateRequest
import me.atri.data.api.response.DiaryEntryDto
import me.atri.data.datastore.PreferencesStore

sealed class RegenerateProgress {
    data class Running(val phase: String?, val percent: Int) : RegenerateProgress()
    data class Success(val entry: DiaryEntryDto?) : RegenerateProgress()
    data class Error(val message: String) : RegenerateProgress()
}

class DiaryRepository(
    private val apiService: AtriApiService,
    private val preferencesStore: PreferencesStore
) {
    suspend fun fetchRemoteDiaries(limit: Int = 7): Result<List<DiaryEntryDto>> = withContext(Dispatchers.IO) {
        try {
            val userId = preferencesStore.ensureUserId()
            val response = apiService.fetchDiaryList(userId = userId, limit = limit)
            if (!response.isSuccessful) {
                return@withContext Result.failure(Exception("加载日记失败: ${response.code()}"))
            }
            Result.success(response.body()?.entries.orEmpty())
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun fetchDiaryDetail(date: String): Result<DiaryEntryDto?> = withContext(Dispatchers.IO) {
        try {
            val userId = preferencesStore.ensureUserId()
            val response = apiService.fetchDiaryDetail(userId = userId, date = date)
            if (!response.isSuccessful) {
                return@withContext Result.failure(Exception("获取日记失败: ${response.code()}"))
            }
            val body = response.body()
            if (body == null || body.status == "missing") {
                return@withContext Result.success(null)
            }
            Result.success(body.entry)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    fun regenerateDiary(date: String): Flow<RegenerateProgress> = flow {
        val userId = preferencesStore.ensureUserId()
        val acceptResponse = apiService.regenerateDiary(DiaryRegenerateRequest(userId = userId, date = date))
        if (!acceptResponse.isSuccessful) {
            val message = when (acceptResponse.code()) {
                401, 403 -> "鉴权失败，请检查 X-App-Token"
                404 -> "当天没有聊天记录，无法重生成"
                else -> "重新生成失败: ${acceptResponse.code()}"
            }
            emit(RegenerateProgress.Error(message))
            return@flow
        }
        val accepted = acceptResponse.body() ?: run {
            emit(RegenerateProgress.Error("重新生成失败: 空响应"))
            return@flow
        }
        val taskId = accepted.taskId
        emit(RegenerateProgress.Running(phase = null, percent = 0))

        while (true) {
            delay(2_000L)
            val statusResponse = apiService.getRegenerateStatus(taskId)
            if (!statusResponse.isSuccessful) {
                emit(RegenerateProgress.Error("查询进度失败: ${statusResponse.code()}"))
                return@flow
            }
            val status = statusResponse.body() ?: run {
                emit(RegenerateProgress.Error("查询进度失败: 空响应"))
                return@flow
            }
            if (!status.error.isNullOrBlank()) {
                emit(RegenerateProgress.Error(status.error))
                return@flow
            }
            emit(RegenerateProgress.Running(phase = status.currentPhase, percent = status.percent))
            if (status.percent >= 100) {
                val finalEntry = status.entry ?: runCatching {
                    apiService.fetchDiaryDetail(userId = userId, date = date)
                        .takeIf { it.isSuccessful }
                        ?.body()
                        ?.entry
                }.getOrNull()
                emit(RegenerateProgress.Success(finalEntry))
                return@flow
            }
        }
    }.flowOn(Dispatchers.IO)
}
