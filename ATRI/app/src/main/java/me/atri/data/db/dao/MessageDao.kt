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

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(message: MessageEntity)

    @Update
    suspend fun update(message: MessageEntity)

    @Query("UPDATE messages SET isDeleted = 1 WHERE id = :id")
    suspend fun softDelete(id: String)

    @Query("UPDATE messages SET isDeleted = 1 WHERE id IN (:ids)")
    suspend fun softDeleteByIds(ids: List<String>)

    @Query("SELECT * FROM messages WHERE id = :id LIMIT 1")
    suspend fun getMessageById(id: String): MessageEntity?

    @Query("SELECT MAX(timestamp) FROM messages WHERE isDeleted = 0")
    suspend fun getLatestTimestamp(): Long?

    @Query("SELECT MIN(timestamp) FROM messages WHERE isDeleted = 0")
    suspend fun getEarliestTimestamp(): Long?

    @Query("DELETE FROM messages WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<String>)
}
