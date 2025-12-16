package me.atri.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
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
    version = 6,
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

        // Migration from version 1 to 2
        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                // 添加 message_versions 表
                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS message_versions (
                        id TEXT NOT NULL PRIMARY KEY,
                        messageId TEXT NOT NULL,
                        content TEXT NOT NULL,
                        attachments TEXT NOT NULL,
                        timestamp INTEGER NOT NULL,
                        versionIndex INTEGER NOT NULL,
                        FOREIGN KEY(messageId) REFERENCES messages(id) ON DELETE CASCADE
                    )
                """)
                db.execSQL("CREATE INDEX IF NOT EXISTS index_message_versions_messageId_versionIndex ON message_versions(messageId, versionIndex)")
                // 添加版本控制字段到 messages 表
                db.execSQL("ALTER TABLE messages ADD COLUMN currentVersionIndex INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE messages ADD COLUMN totalVersions INTEGER NOT NULL DEFAULT 1")
            }
        }

        // Migration from version 2 to 3
        private val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                // 添加 thinking 相关字段
                db.execSQL("ALTER TABLE messages ADD COLUMN thinkingContent TEXT")
                db.execSQL("ALTER TABLE messages ADD COLUMN thinkingStartTime INTEGER")
                db.execSQL("ALTER TABLE messages ADD COLUMN thinkingEndTime INTEGER")
            }
        }

        // Migration from version 3 to 4
        private val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                // 添加 memories 表
                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS memories (
                        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        category TEXT NOT NULL,
                        `key` TEXT NOT NULL,
                        value TEXT NOT NULL,
                        timestamp INTEGER NOT NULL,
                        importance INTEGER NOT NULL,
                        vectorId TEXT
                    )
                """)
            }
        }

        // Migration from version 4 to 5
        private val MIGRATION_4_5 = object : Migration(4, 5) {
            override fun migrate(db: SupportSQLiteDatabase) {
                // 重建 diary 表（移除 likeCount 和 isLiked 字段）
                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS diary_new (
                        id TEXT NOT NULL PRIMARY KEY,
                        content TEXT NOT NULL,
                        timestamp INTEGER NOT NULL,
                        mood TEXT NOT NULL
                    )
                """)
                db.execSQL("INSERT INTO diary_new (id, content, timestamp, mood) SELECT id, content, timestamp, mood FROM diary")
                db.execSQL("DROP TABLE diary")
                db.execSQL("ALTER TABLE diary_new RENAME TO diary")

                // 删除 comments 表
                db.execSQL("DROP TABLE IF EXISTS comments")
            }
        }

        // Migration from version 5 to 6
        private val MIGRATION_5_6 = object : Migration(5, 6) {
            override fun migrate(db: SupportSQLiteDatabase) {
                // 添加 mood 字段到 messages 表
                db.execSQL("ALTER TABLE messages ADD COLUMN mood TEXT")
            }
        }

        fun getInstance(context: Context): AtriDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AtriDatabase::class.java,
                    "atri_database"
                )
                    .addMigrations(
                        MIGRATION_1_2,
                        MIGRATION_2_3,
                        MIGRATION_3_4,
                        MIGRATION_4_5,
                        MIGRATION_5_6
                    )
                    // 仅在开发阶段保留，生产环境应移除
                    // .fallbackToDestructiveMigration()
                    .build()
                INSTANCE = instance
                instance
            }
        }
    }
}
