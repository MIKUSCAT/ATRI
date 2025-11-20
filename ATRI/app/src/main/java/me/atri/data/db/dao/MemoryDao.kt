package me.atri.data.db.dao

import androidx.room.*
import kotlinx.coroutines.flow.Flow
import me.atri.data.db.entity.MemoryEntity

@Dao
interface MemoryDao {
    @Query("SELECT * FROM memories ORDER BY importance DESC, timestamp DESC")
    fun observeAll(): Flow<List<MemoryEntity>>

    @Query("SELECT * FROM memories WHERE category = :category ORDER BY timestamp DESC")
    fun observeByCategory(category: String): Flow<List<MemoryEntity>>

    @Query("SELECT * FROM memories WHERE importance >= 5 ORDER BY importance DESC LIMIT 10")
    suspend fun getImportantMemories(): List<MemoryEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(memory: MemoryEntity)

    @Update
    suspend fun update(memory: MemoryEntity)

    @Delete
    suspend fun delete(memory: MemoryEntity)

    @Query("SELECT COUNT(*) FROM memories")
    suspend fun getMemoryCount(): Int

    @Query("DELETE FROM memories")
    suspend fun clearAll()
}
