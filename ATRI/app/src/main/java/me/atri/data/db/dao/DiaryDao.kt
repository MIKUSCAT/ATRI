package me.atri.data.db.dao

import androidx.room.*
import kotlinx.coroutines.flow.Flow
import me.atri.data.db.entity.DiaryEntity

@Dao
interface DiaryDao {
    @Query("SELECT * FROM diary ORDER BY timestamp DESC")
    fun observeAll(): Flow<List<DiaryEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(diary: DiaryEntity)

    @Update
    suspend fun update(diary: DiaryEntity)

    @Delete
    suspend fun delete(diary: DiaryEntity)
}
