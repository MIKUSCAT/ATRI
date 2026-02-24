package me.atri.data.db.dao

import androidx.room.*
import kotlinx.coroutines.flow.Flow
import me.atri.data.db.entity.MessageEntity

@Dao
interface MessageDao {
    @Query("SELECT * FROM messages WHERE isDeleted = 0 ORDER BY timestamp ASC")
    fun observeAll(): Flow<List<MessageEntity>>

    @Query("SELECT * FROM messages WHERE isDeleted = 0 ORDER BY timestamp DESC LIMIT :limit")
    suspend fun getRecentMessages(limit: Int): List<MessageEntity>

    @Query("SELECT * FROM messages WHERE isDeleted = 0 ORDER BY timestamp ASC")
    suspend fun getAllMessages(): List<MessageEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(message: MessageEntity)

    @Update
    suspend fun update(message: MessageEntity)

    @Query("UPDATE messages SET isDeleted = 1 WHERE id = :id")
    suspend fun softDelete(id: String)

    @Query("UPDATE messages SET isDeleted = 1 WHERE id IN (:ids)")
    suspend fun softDeleteByIds(ids: List<String>)

    @Query("UPDATE messages SET isDeleted = 0 WHERE id = :id")
    suspend fun undoDelete(id: String)

    @Query("DELETE FROM messages WHERE isDeleted = 1 AND timestamp < :beforeTimestamp")
    suspend fun deleteOldSoftDeleted(beforeTimestamp: Long)

    @Query("UPDATE messages SET isImportant = :important WHERE id = :id")
    suspend fun updateImportant(id: String, important: Boolean)

    @Query("SELECT COUNT(*) FROM messages WHERE isDeleted = 0")
    suspend fun getMessageCount(): Int

    @Query("SELECT COUNT(*) FROM messages WHERE isDeleted = 0 AND date(timestamp/1000,'unixepoch','localtime') = date('now','localtime')")
    suspend fun getTodayMessageCount(): Int

    @Query("SELECT MIN(timestamp) FROM messages WHERE isDeleted = 0")
    suspend fun getFirstMessageTime(): Long?

    @Query("SELECT * FROM messages WHERE id = :id LIMIT 1")
    suspend fun getMessageById(id: String): MessageEntity?

    // 新增：按时间范围查询消息（升序），用于"问时即取"按日检索
    @Query("SELECT * FROM messages WHERE isDeleted = 0 AND timestamp BETWEEN :startMs AND :endMs ORDER BY timestamp ASC")
    suspend fun getMessagesInRange(startMs: Long, endMs: Long): List<MessageEntity>

    @Query("SELECT MAX(timestamp) FROM messages WHERE isDeleted = 0")
    suspend fun getLatestTimestamp(): Long?

    @Query("SELECT MIN(timestamp) FROM messages WHERE isDeleted = 0")
    suspend fun getEarliestTimestamp(): Long?

    @Query("DELETE FROM messages WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<String>)
}
