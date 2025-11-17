package me.atri.data.repository

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import me.atri.data.api.AtriApiService
import me.atri.data.api.response.DiaryEntryDto
import me.atri.data.datastore.PreferencesStore
import me.atri.data.db.dao.DiaryDao
import me.atri.data.db.entity.DiaryEntity

class DiaryRepository(
    private val diaryDao: DiaryDao,
    private val apiService: AtriApiService,
    private val preferencesStore: PreferencesStore
) {
    fun observeAllDiaries(): Flow<List<DiaryEntity>> = diaryDao.observeAll()

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
}
