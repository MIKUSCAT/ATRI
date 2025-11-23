package me.atri.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import me.atri.data.db.dao.DiaryDao
import me.atri.data.db.dao.MessageDao
import me.atri.data.db.dao.MessageVersionDao
import me.atri.data.db.dao.MemoryDao
import me.atri.data.db.entity.DiaryEntity
import me.atri.data.db.entity.MemoryEntity
import me.atri.data.db.entity.MessageEntity
import me.atri.data.db.entity.MessageVersionEntity

@Database(
    entities = [
        MessageEntity::class,
        MessageVersionEntity::class,
        DiaryEntity::class,
        MemoryEntity::class
    ],
    version = 5,
    exportSchema = true
)
@TypeConverters(AttachmentTypeConverters::class)
abstract class AtriDatabase : RoomDatabase() {
    abstract fun messageDao(): MessageDao
    abstract fun messageVersionDao(): MessageVersionDao
    abstract fun diaryDao(): DiaryDao
    abstract fun memoryDao(): MemoryDao

    companion object {
        @Volatile
        private var INSTANCE: AtriDatabase? = null

        fun getInstance(context: Context): AtriDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AtriDatabase::class.java,
                    "atri_database"
                )
                    .fallbackToDestructiveMigration()
                    .build()
                INSTANCE = instance
                instance
            }
        }
    }
}
