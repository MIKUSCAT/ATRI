package me.atri.data.repository

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import me.atri.data.datastore.PreferencesStore
import me.atri.data.db.dao.MessageDao
import me.atri.data.db.dao.MemoryDao
import me.atri.data.model.IntimacyInfo
import me.atri.data.prompt.PromptProvider

class StatusRepository(
    private val preferencesStore: PreferencesStore,
    private val messageDao: MessageDao,
    private val memoryDao: MemoryDao,
    private val promptProvider: PromptProvider
) {
    fun observeIntimacyInfo(): Flow<IntimacyInfo> = preferencesStore.intimacyPoints
        .map { buildIntimacyInfo(it) }

    suspend fun incrementIntimacy(delta: Int) {
        preferencesStore.incrementIntimacy(delta)
    }

    suspend fun getStatistics(): Map<String, Any> {
        val firstMessageTime = messageDao.getFirstMessageTime() ?: System.currentTimeMillis()
        val daysKnown = ((System.currentTimeMillis() - firstMessageTime) / (1000 * 60 * 60 * 24)).toInt()

        return mapOf(
            "daysKnown" to daysKnown,
            "totalMessages" to messageDao.getMessageCount(),
            "todayMessages" to messageDao.getTodayMessageCount(),
            "importantMemories" to memoryDao.getMemoryCount()
        )
    }

    private fun buildIntimacyInfo(points: Int): IntimacyInfo {
        val level = when {
            points < 100 -> 1
            points < 300 -> 2
            points < 600 -> 3
            points < 1000 -> 4
            else -> 5
        }
        val levelName = promptProvider.chatStageDisplayName(level) ?: DEFAULT_LEVEL_NAMES[level] ?: "挚爱"
        val nextPoints = when (level) {
            1 -> 100
            2 -> 300
            3 -> 600
            4 -> 1000
            else -> 1000
        }
        val prevPoints = when (level) {
            1 -> 0
            2 -> 100
            3 -> 300
            4 -> 600
            else -> 1000
        }
        val progress = if (level == 5) 1f else {
            (points - prevPoints).toFloat() / (nextPoints - prevPoints)
        }
        return IntimacyInfo(points, level, levelName, nextPoints, progress)
    }

    companion object {
        private val DEFAULT_LEVEL_NAMES = mapOf(
            1 to "初识",
            2 to "熟悉",
            3 to "亲密",
            4 to "深交",
            5 to "挚爱"
        )
    }
}
