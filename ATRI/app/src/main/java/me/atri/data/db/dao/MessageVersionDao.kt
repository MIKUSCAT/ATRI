package me.atri.data.db.dao

import androidx.room.*
import kotlinx.coroutines.flow.Flow
import me.atri.data.db.entity.MessageVersionEntity

@Dao
interface MessageVersionDao {

    @Query("SELECT * FROM message_versions WHERE messageId = :messageId ORDER BY versionIndex ASC")
    fun observeVersions(messageId: String): Flow<List<MessageVersionEntity>>

    @Query("SELECT * FROM message_versions WHERE messageId = :messageId ORDER BY versionIndex ASC")
    suspend fun getVersions(messageId: String): List<MessageVersionEntity>

    @Query("SELECT * FROM message_versions WHERE messageId = :messageId AND versionIndex = :versionIndex LIMIT 1")
    suspend fun getVersion(messageId: String, versionIndex: Int): MessageVersionEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(version: MessageVersionEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(versions: List<MessageVersionEntity>)

    @Query("DELETE FROM message_versions WHERE messageId = :messageId")
    suspend fun deleteByMessageId(messageId: String)

    @Query("SELECT COUNT(*) FROM message_versions WHERE messageId = :messageId")
    suspend fun getVersionCount(messageId: String): Int
}
