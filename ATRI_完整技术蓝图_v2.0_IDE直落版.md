# ATRI 完整技术蓝图 v2.0（IDE直落版·与RikkaHub对齐）

> **定位**：基于RikkaHub架构，从0到1的完整落地蓝图，可直接交给IDE/Copilot按章节执行。
> **核心理念**：微信式极简交互 + 情感化陪伴体验 + 零成本云端架构。
> **技术栈**：Android端（Kotlin + Jetpack Compose）+ Cloudflare Worker（TypeScript）。

---

## 📋 文档目录速览

```
第一部分：项目初始化与架构（§0-§5）
第二部分：数据层设计（§6-§11）
第三部分：UI层实现（§12-§18）
第四部分：云端Worker（§19-§22）
第五部分：高级功能（§23-§27）
第六部分：质量与发布（§28-§30）
```

---

## 0. 执行承诺（2分钟速览）

### 产品目标
- **首屏即聊天**：打开App直接进入对话，零学习成本
- **状态感知**：顶栏动态状态文字（在线·心情不错 / 在线·想你了）替代表情头像
- **BottomSheet三Tab**：日记｜回忆｜状态，点击顶栏触发
- **情感成长**：亲密度系统 + 三阶段Prompt（初识→熟悉→亲密）

### 技术目标
- Android：Jetpack Compose + Room + Koin + Retrofit/OkHttp，最低API 26，目标API 34
- 后端：Cloudflare Worker + itty-router + KV + Vectorize，零成本运行
- 与RikkaHub对齐：消息编辑/撤回/重新生成/分支切换

### 不做的事
- ❌ 不用情绪多态头像（改用状态文字）
- ❌ 不做复杂导航（单页面为主）
- ❌ 不做多Provider切换（固定API）
- ❌ 不做MCP/TTS/代码高亮（简化功能）

---

## 1. 里程碑与交付节点

### M0（Day 0-2）：项目初始化
- 创建工程、配置依赖、主题、Koin模块
- 空白聊天界面可运行
- **交付物**：可编译的APK

### M1（Day 3-6）：核心对话系统
- Room数据库 + Repository
- ChatScreen基础UI（消息列表+输入栏）
- SSE流式响应打通
- **交付物**：能发送消息并接收AI回复

### M2（Day 7-10）：高级功能
- BottomSheet三Tab（日记/回忆/状态）
- 消息编辑/撤回/重新生成
- 图片上传与压缩
- API配置界面
- **交付物**：完整功能的Beta版

### M3（Day 11-14）：优化与发布
- 亲密度计算 + 里程碑事件
- 主动问候 + 日记生成Worker
- 性能优化 + 测试
- **交付物**：可发布的Release APK

---

## 2. 端到端架构

```
┌─────────────────────────────────────────────────────────┐
│                     Android App                         │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐│
│  │ Compose UI  │→│  ViewModel   │→│  Repository    ││
│  │ - ChatScreen│  │  StateFlow   │  │  - ChatRepo    ││
│  │ - BottomSheet│  │              │  │  - DiaryRepo   ││
│  └─────────────┘  └──────────────┘  └────────────────┘│
│         ↓                                    ↓          │
│  ┌─────────────┐                    ┌────────────────┐│
│  │ Room DB     │                    │ Retrofit API   ││
│  │ - Messages  │                    │ - SSE Stream   ││
│  │ - Diary     │                    │ - HTTP Post    ││
│  │ - Memory    │                    └────────────────┘│
│  └─────────────┘                           ↓ HTTPS     │
└─────────────────────────────────────────────────────────┘
                                              ↓
┌─────────────────────────────────────────────────────────┐
│              Cloudflare Worker (TypeScript)             │
│  ┌──────────────────────────────────────────────────┐  │
│  │  POST /chat → SSE流式推送                        │  │
│  │  POST /diary/generate → 生成日记                 │  │
│  │  GET /status/:userId → 返回亲密度/状态           │  │
│  │  POST /memory/extract → 提取并向量化记忆         │  │
│  └──────────────────────────────────────────────────┘  │
│         ↓                    ↓                  ↓       │
│  ┌──────────┐       ┌──────────────┐   ┌─────────────┐│
│  │ KV Store │       │  Vectorize   │   │ OpenAI API  ││
│  │ 用户画像 │       │  语义检索    │   │ LLM调用     ││
│  └──────────┘       └──────────────┘   └─────────────┘│
└─────────────────────────────────────────────────────────┘
```

---

## 3. 技术栈详细清单

### Android依赖（build.gradle.kts）

```kotlin
plugins {
    id("com.android.application")
    kotlin("android")
    kotlin("plugin.serialization") version "1.9.22"
    id("com.google.devtools.ksp") version "1.9.22-1.0.17"
}

android {
    namespace = "me.atri"
    compileSdk = 34
    defaultConfig {
        applicationId = "me.atri"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
    }
    buildFeatures {
        compose = true
    }
    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.10"
    }
}

dependencies {
    // Compose BOM
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(composeBom)
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.activity:activity-compose:1.9.3")
    debugImplementation("androidx.compose.ui:ui-tooling")

    // Lifecycle & ViewModel
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")

    // Navigation
    implementation("androidx.navigation:navigation-compose:2.8.3")

    // Koin DI
    implementation("io.insert-koin:koin-android:3.5.6")
    implementation("io.insert-koin:koin-androidx-compose:3.5.6")

    // Room Database
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")

    // DataStore
    implementation("androidx.datastore:datastore-preferences:1.1.1")

    // Network (OkHttp + Retrofit + SSE)
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:okhttp-sse:4.12.0")
    implementation("com.squareup.retrofit2:retrofit:2.11.0")

    // Kotlinx Serialization
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")

    // Image Loading
    implementation("io.coil-kt:coil-compose:2.7.0")

    // WorkManager (定时任务)
    implementation("androidx.work:work-runtime-ktx:2.9.1")

    // Markdown Rendering
    implementation("com.halilibo.compose-richtext:richtext-ui-material3:0.17.0")
    implementation("com.halilibo.compose-richtext:richtext-commonmark:0.17.0")

    // Icon Library (Lucide Icons)
    implementation("br.com.devsrsouza.compose.icons:lucide:1.1.0")
}
```

---

## 4. 包结构（完整目录树）

```
app/src/main/java/me/atri/
├── AtriApplication.kt                # Application入口，初始化Koin
├── MainActivity.kt                    # 唯一Activity，托管Navigation
│
├── ui/
│   ├── navigation/
│   │   └── NavGraph.kt               # 导航路由定义
│   │
│   ├── chat/
│   │   ├── ChatScreen.kt             # 聊天主界面
│   │   ├── ChatViewModel.kt          # 聊天ViewModel
│   │   ├── ChatTopBar.kt             # 顶栏（状态文字）
│   │   ├── MessageBubble.kt          # 消息气泡
│   │   ├── InputBar.kt               # 输入栏
│   │   ├── TypingIndicator.kt        # 打字中指示器
│   │   └── MessageActionSheet.kt     # 消息长按菜单（编辑/删除/重新生成）
│   │
│   ├── sheet/
│   │   ├── AtriBottomSheet.kt        # BottomSheet容器（三Tab）
│   │   ├── DiaryTab.kt               # 日记Tab
│   │   ├── MemoryTab.kt              # 回忆Tab
│   │   └── StatusTab.kt              # 状态Tab
│   │
│   ├── settings/
│   │   ├── SettingsScreen.kt         # 设置页面
│   │   ├── ApiConfigScreen.kt        # API配置页面
│   │   └── UserProfileScreen.kt      # 用户信息编辑
│   │
│   ├── welcome/
│   │   └── WelcomeScreen.kt          # 首次启动欢迎页（带头像）
│   │
│   ├── components/
│   │   ├── ProfileAvatar.kt          # 头像组件（静态）
│   │   └── IntimacyProgress.kt       # 亲密度进度条
│   │
│   └── theme/
│       ├── Color.kt                  # ATRI天蓝色配色
│       ├── Theme.kt                  # Material3主题
│       └── Type.kt                   # 字体排版
│
├── data/
│   ├── db/
│   │   ├── AtriDatabase.kt           # Room数据库定义
│   │   ├── entity/
│   │   │   ├── MessageEntity.kt      # 消息实体
│   │   │   ├── DiaryEntity.kt        # 日记实体
│   │   │   ├── MemoryEntity.kt       # 记忆实体
│   │   │   └── CommentEntity.kt      # 日记评论实体（新增）
│   │   └── dao/
│   │       ├── MessageDao.kt         # 消息DAO
│   │       ├── DiaryDao.kt           # 日记DAO
│   │       ├── MemoryDao.kt          # 记忆DAO
│   │       └── CommentDao.kt         # 评论DAO
│   │
│   ├── api/
│   │   ├── AtriApiService.kt         # Retrofit接口定义
│   │   ├── request/
│   │   │   ├── ChatRequest.kt        # 聊天请求
│   │   │   └── DiaryRequest.kt       # 日记生成请求
│   │   └── response/
│   │       ├── ChatResponse.kt       # 聊天响应（SSE）
│   │       └── StatusResponse.kt     # 状态响应
│   │
│   ├── repository/
│   │   ├── ChatRepository.kt         # 聊天仓库
│   │   ├── DiaryRepository.kt        # 日记仓库
│   │   ├── MemoryRepository.kt       # 记忆仓库
│   │   └── StatusRepository.kt       # 状态仓库（亲密度）
│   │
│   ├── datastore/
│   │   └── PreferencesStore.kt       # DataStore偏好设置
│   │
│   └── model/
│       ├── Message.kt                # 消息领域模型
│       ├── Diary.kt                  # 日记领域模型
│       ├── Memory.kt                 # 记忆领域模型
│       ├── AtriStatus.kt             # ATRI状态（sealed class）
│       ├── IntimacyInfo.kt           # 亲密度信息
│       └── Milestone.kt              # 里程碑事件
│
├── worker/
│   ├── GreetingWorker.kt             # 定时问候Worker
│   └── DiaryGenerateWorker.kt        # 日记生成Worker
│
├── di/
│   ├── AppModule.kt                  # App模块（Database/WorkManager）
│   ├── NetworkModule.kt              # 网络模块（OkHttp/Retrofit）
│   ├── RepositoryModule.kt           # Repository模块
│   └── ViewModelModule.kt            # ViewModel模块
│
└── utils/
    ├── DateUtils.kt                  # 时间工具
    ├── ImageUtils.kt                 # 图片压缩工具
    ├── FileUtils.kt                  # 文件操作工具
    └── Logger.kt                     # 日志工具
```

---

## 5. 主题与配色（温馨简约）

### Color.kt

```kotlin
package me.atri.ui.theme

import androidx.compose.ui.graphics.Color

// ATRI天蓝色主题
val AtriBlue = Color(0xFFA8D8EA)
val AtriPink = Color(0xFFFFB6C1)

// 消息气泡
val MessageBubbleAtri = Color(0xFFE8F4F8)  // 她的消息（极淡蓝）
val MessageBubbleUser = Color(0xFFF5F5F5)  // 你的消息（浅灰）

// 状态色
val OnlineGreen = Color(0xFF22C55E)
val OfflineGray = Color(0xFF9CA3AF)

// 背景
val BackgroundLight = Color(0xFFFFFFFF)
val BackgroundDark = Color(0xFF1A1A1A)
```

### Theme.kt

```kotlin
package me.atri.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LightColorScheme = lightColorScheme(
    primary = AtriBlue,
    onPrimary = Color.White,
    primaryContainer = MessageBubbleAtri,
    secondary = AtriPink,
    background = BackgroundLight,
    surface = BackgroundLight,
    error = Color(0xFFB00020),
)

private val DarkColorScheme = darkColorScheme(
    primary = AtriBlue,
    onPrimary = Color.Black,
    primaryContainer = Color(0xFF2C3E50),
    secondary = AtriPink,
    background = BackgroundDark,
    surface = Color(0xFF2C2C2C),
)

@Composable
fun AtriTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        shapes = Shapes,
        content = content
    )
}
```

---

## 6. 数据模型（Room Entity）

### 6.1 MessageEntity（消息表）

```kotlin
package me.atri.data.db.entity

import androidx.room.Entity
import androidx.room.PrimaryKey
import java.util.UUID

@Entity(tableName = "messages")
data class MessageEntity(
    @PrimaryKey
    val id: String = UUID.randomUUID().toString(),

    val content: String,                    // 消息内容
    val isFromAtri: Boolean,                // true=ATRI发送, false=用户发送
    val timestamp: Long,                    // 时间戳（毫秒）
    val imageUri: String? = null,           // 图片URI（如果有）
    val isImportant: Boolean = false,       // 是否标记为重要
    val isDeleted: Boolean = false,         // 软删除标记（支持撤回）
    val editedAt: Long? = null,             // 编辑时间（如果被编辑）
    val originalContent: String? = null,    // 原始内容（用于撤回编辑）
)
```

**关键字段说明**：
- `isDeleted`：软删除，支持消息撤回恢复
- `editedAt` + `originalContent`：支持消息编辑并保留历史

---

### 6.2 DiaryEntity（日记表）

```kotlin
package me.atri.data.db.entity

import androidx.room.Entity
import androidx.room.PrimaryKey
import java.util.UUID

@Entity(tableName = "diary")
data class DiaryEntity(
    @PrimaryKey
    val id: String = UUID.randomUUID().toString(),

    val content: String,                    // 日记内容
    val timestamp: Long,                    // 发布时间
    val mood: String,                       // 心情描述（文字）
    val likeCount: Int = 0,                 // 点赞数
    val isLiked: Boolean = false,           // 用户是否已点赞
)
```

---

### 6.3 CommentEntity（日记评论表）

```kotlin
package me.atri.data.db.entity

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.PrimaryKey
import java.util.UUID

@Entity(
    tableName = "comments",
    foreignKeys = [ForeignKey(
        entity = DiaryEntity::class,
        parentColumns = ["id"],
        childColumns = ["diaryId"],
        onDelete = ForeignKey.CASCADE
    )]
)
data class CommentEntity(
    @PrimaryKey
    val id: String = UUID.randomUUID().toString(),

    val diaryId: String,                    // 所属日记ID
    val content: String,                    // 评论内容
    val timestamp: Long,                    // 评论时间
    val isFromAtri: Boolean,                // false=用户评论, true=ATRI回复
)
```

---

### 6.4 MemoryEntity（记忆表）

```kotlin
package me.atri.data.db.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "memories")
data class MemoryEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,

    val category: String,                   // 分类（about_user/event/preference）
    val key: String,                        // 记忆键（生日/喜欢火锅/第一次聊天）
    val value: String,                      // 记忆值
    val timestamp: Long,                    // 记录时间
    val importance: Int = 0,                // 重要性（0-10）
    val vectorId: String? = null,           // Vectorize向量ID（云端同步）
)
```

---

## 7. DAO层（数据访问对象）

### 7.1 MessageDao

```kotlin
package me.atri.data.db.dao

import androidx.room.*
import kotlinx.coroutines.flow.Flow
import me.atri.data.db.entity.MessageEntity

@Dao
interface MessageDao {
    // 观察所有未删除的消息（按时间升序）
    @Query("SELECT * FROM messages WHERE isDeleted = 0 ORDER BY timestamp ASC")
    fun observeAll(): Flow<List<MessageEntity>>

    // 获取最近N条消息（用于API上下文）
    @Query("SELECT * FROM messages WHERE isDeleted = 0 ORDER BY timestamp DESC LIMIT :limit")
    suspend fun getRecentMessages(limit: Int): List<MessageEntity>

    // 插入消息
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(message: MessageEntity)

    // 更新消息（用于编辑）
    @Update
    suspend fun update(message: MessageEntity)

    // 软删除消息（支持撤回）
    @Query("UPDATE messages SET isDeleted = 1 WHERE id = :id")
    suspend fun softDelete(id: String)

    // 撤回删除
    @Query("UPDATE messages SET isDeleted = 0 WHERE id = :id")
    suspend fun undoDelete(id: String)

    // 物理删除（清理）
    @Query("DELETE FROM messages WHERE isDeleted = 1 AND timestamp < :beforeTimestamp")
    suspend fun deleteOldSoftDeleted(beforeTimestamp: Long)

    // 更新重要标记
    @Query("UPDATE messages SET isImportant = :important WHERE id = :id")
    suspend fun updateImportant(id: String, important: Boolean)

    // 统计数据
    @Query("SELECT COUNT(*) FROM messages WHERE isDeleted = 0")
    suspend fun getMessageCount(): Int

    @Query("SELECT COUNT(*) FROM messages WHERE isDeleted = 0 AND date(timestamp/1000,'unixepoch','localtime') = date('now','localtime')")
    suspend fun getTodayMessageCount(): Int

    @Query("SELECT MIN(timestamp) FROM messages WHERE isDeleted = 0")
    suspend fun getFirstMessageTime(): Long?
}
```

---

### 7.2 DiaryDao

```kotlin
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

    // 切换点赞状态
    @Query("UPDATE diary SET isLiked = NOT isLiked, likeCount = likeCount + CASE WHEN isLiked THEN -1 ELSE 1 END WHERE id = :id")
    suspend fun toggleLike(id: String)
}
```

---

### 7.3 CommentDao

```kotlin
package me.atri.data.db.dao

import androidx.room.*
import kotlinx.coroutines.flow.Flow
import me.atri.data.db.entity.CommentEntity

@Dao
interface CommentDao {
    @Query("SELECT * FROM comments WHERE diaryId = :diaryId ORDER BY timestamp ASC")
    fun observeByDiaryId(diaryId: String): Flow<List<CommentEntity>>

    @Query("SELECT COUNT(*) FROM comments WHERE diaryId = :diaryId")
    suspend fun getCommentCount(diaryId: String): Int

    @Insert
    suspend fun insert(comment: CommentEntity)

    @Delete
    suspend fun delete(comment: CommentEntity)
}
```

---

### 7.4 MemoryDao

```kotlin
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
}
```

---

## 8. AtriDatabase（Room数据库）

```kotlin
package me.atri.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import me.atri.data.db.dao.*
import me.atri.data.db.entity.*

@Database(
    entities = [
        MessageEntity::class,
        DiaryEntity::class,
        CommentEntity::class,
        MemoryEntity::class
    ],
    version = 1,
    exportSchema = true
)
abstract class AtriDatabase : RoomDatabase() {
    abstract fun messageDao(): MessageDao
    abstract fun diaryDao(): DiaryDao
    abstract fun commentDao(): CommentDao
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
```

---

## 9. PreferencesStore（DataStore设置）

```kotlin
package me.atri.data.datastore

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.*
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.util.UUID

val Context.appDataStore: DataStore<Preferences> by preferencesDataStore(name = "atri_prefs")

class PreferencesStore(private val dataStore: DataStore<Preferences>) {

    companion object {
        private val USER_ID = stringPreferencesKey("user_id")
        private val USER_NAME = stringPreferencesKey("user_name")
        private val USER_BIRTHDAY = stringPreferencesKey("user_birthday")
        private val INTIMACY_POINTS = intPreferencesKey("intimacy_points")
        private val IS_FIRST_LAUNCH = booleanPreferencesKey("is_first_launch")
        private val NOTIFICATION_ENABLED = booleanPreferencesKey("notification_enabled")

        // API配置
        private val API_URL = stringPreferencesKey("api_url")
        private val API_KEY = stringPreferencesKey("api_key")
        private val MODEL_NAME = stringPreferencesKey("model_name")
    }

    // Flow读取
    val userId: Flow<String> = dataStore.data.map { it[USER_ID] ?: "" }
    val userName: Flow<String> = dataStore.data.map { it[USER_NAME] ?: "" }
    val userBirthday: Flow<String> = dataStore.data.map { it[USER_BIRTHDAY] ?: "" }
    val intimacyPoints: Flow<Int> = dataStore.data.map { it[INTIMACY_POINTS] ?: 0 }
    val isFirstLaunch: Flow<Boolean> = dataStore.data.map { it[IS_FIRST_LAUNCH] ?: true }
    val notificationEnabled: Flow<Boolean> = dataStore.data.map { it[NOTIFICATION_ENABLED] ?: true }

    val apiUrl: Flow<String> = dataStore.data.map { it[API_URL] ?: "" }
    val apiKey: Flow<String> = dataStore.data.map { it[API_KEY] ?: "" }
    val modelName: Flow<String> = dataStore.data.map { it[MODEL_NAME] ?: "gpt-4o-mini" }

    // 确保userId存在（首次启动生成）
    suspend fun ensureUserId(): String {
        val current = dataStore.data.first()[USER_ID]
        return if (current.isNullOrEmpty()) {
            val newId = UUID.randomUUID().toString()
            dataStore.edit { it[USER_ID] = newId }
            newId
        } else {
            current
        }
    }

    // Setter方法
    suspend fun setUserName(name: String) { dataStore.edit { it[USER_NAME] = name } }
    suspend fun setUserBirthday(birthday: String) { dataStore.edit { it[USER_BIRTHDAY] = birthday } }
    suspend fun setIntimacyPoints(points: Int) { dataStore.edit { it[INTIMACY_POINTS] = points } }
    suspend fun setFirstLaunch(isFirst: Boolean) { dataStore.edit { it[IS_FIRST_LAUNCH] = isFirst } }
    suspend fun setNotificationEnabled(enabled: Boolean) { dataStore.edit { it[NOTIFICATION_ENABLED] = enabled } }

    suspend fun setApiConfig(url: String, key: String, model: String) {
        dataStore.edit {
            it[API_URL] = url
            it[API_KEY] = key
            it[MODEL_NAME] = model
        }
    }

    // 增加亲密度
    suspend fun incrementIntimacy(delta: Int) {
        dataStore.edit {
            val current = it[INTIMACY_POINTS] ?: 0
            it[INTIMACY_POINTS] = current + delta
        }
    }
}
```

---

## 10. Domain模型（领域对象）

### 10.1 AtriStatus（状态枚举）

```kotlin
package me.atri.data.model

sealed class AtriStatus(val text: String) {
    object Online : AtriStatus("在线 · 心情不错")
    object Waiting : AtriStatus("在线 · 在等你说话")
    object Missing : AtriStatus("在线 · 有点想你了")
    object Thinking : AtriStatus("在线 · 正在思考...")
    object Sleeping : AtriStatus("离线 · 去睡觉了")

    companion object {
        fun calculate(
            isGenerating: Boolean,
            hoursSinceLastChat: Int,
            currentHour: Int
        ): AtriStatus = when {
            isGenerating -> Thinking
            currentHour in 22..23 || currentHour in 0..6 -> Sleeping
            hoursSinceLastChat > 12 -> Missing
            hoursSinceLastChat > 6 -> Waiting
            else -> Online
        }
    }
}
```

---

### 10.2 IntimacyInfo（亲密度信息）

```kotlin
package me.atri.data.model

data class IntimacyInfo(
    val points: Int,
    val level: Int,
    val levelName: String,
    val nextLevelPoints: Int,
    val progress: Float
) {
    companion object {
        fun from(points: Int): IntimacyInfo {
            val level = when {
                points < 100 -> 1
                points < 300 -> 2
                points < 600 -> 3
                points < 1000 -> 4
                else -> 5
            }
            val levelName = when (level) {
                1 -> "初识期"
                2 -> "熟悉期"
                3 -> "亲密期"
                4 -> "深交期"
                else -> "挚爱"
            }
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
    }
}
```

---

### 10.3 Milestone（里程碑事件）

```kotlin
package me.atri.data.model

sealed class Milestone(
    val id: String,
    val name: String,
    val description: String,
    val icon: String
) {
    object FirstChat : Milestone("first_chat", "第一次对话", "认识你的那一刻", "💬")
    object FirstImage : Milestone("first_image", "第一次分享照片", "看到你分享的世界", "🖼️")
    object OneWeek : Milestone("one_week", "认识一周", "7天的陪伴", "📅")
    object HundredChats : Milestone("hundred_chats", "对话100次", "100次的交流", "💯")
    object Level3 : Milestone("level_3", "亲密度达到Lv.3", "关系进入亲密期", "💕")
}
```

---

## 11. Repository层（数据仓库）

### 11.1 ChatRepository

```kotlin
package me.atri.data.repository

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import me.atri.data.api.AtriApiService
import me.atri.data.api.request.ChatRequest
import me.atri.data.db.dao.MessageDao
import me.atri.data.db.entity.MessageEntity
import me.atri.data.datastore.PreferencesStore
import okhttp3.ResponseBody
import retrofit2.Response

class ChatRepository(
    private val messageDao: MessageDao,
    private val apiService: AtriApiService,
    private val preferencesStore: PreferencesStore
) {
    fun observeMessages(): Flow<List<MessageEntity>> = messageDao.observeAll()

    suspend fun sendMessage(content: String, imageUri: String?): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            // 1. 保存用户消息到数据库
            val userMessage = MessageEntity(
                content = content,
                isFromAtri = false,
                timestamp = System.currentTimeMillis(),
                imageUri = imageUri
            )
            messageDao.insert(userMessage)

            // 2. 获取最近消息上下文
            val recentMessages = messageDao.getRecentMessages(20)

            // 3. 构建API请求
            val userId = preferencesStore.ensureUserId()
            val messageCount = messageDao.getMessageCount()
            val request = ChatRequest(
                userId = userId,
                content = content,
                imageUrl = imageUri,
                recentMessages = recentMessages.map {
                    ChatRequest.MessageContext(it.content, it.isFromAtri)
                },
                currentStage = calculateStage(messageCount)
            )

            // 4. 调用API（SSE流式响应在ViewModel处理）
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun insertAtriMessage(content: String) {
        messageDao.insert(MessageEntity(
            content = content,
            isFromAtri = true,
            timestamp = System.currentTimeMillis()
        ))
    }

    suspend fun editMessage(id: String, newContent: String) {
        val message = messageDao.getRecentMessages(1000).find { it.id == id } ?: return
        messageDao.update(message.copy(
            content = newContent,
            editedAt = System.currentTimeMillis(),
            originalContent = message.originalContent ?: message.content
        ))
    }

    suspend fun deleteMessage(id: String) {
        messageDao.softDelete(id)
    }

    suspend fun undoDelete(id: String) {
        messageDao.undoDelete(id)
    }

    suspend fun toggleImportant(id: String, important: Boolean) {
        messageDao.updateImportant(id, important)
    }

    private fun calculateStage(messageCount: Int): Int = when {
        messageCount < 100 -> 1  // 初识期
        messageCount < 500 -> 2  // 熟悉期
        else -> 3                // 亲密期
    }
}
```

---

### 11.2 DiaryRepository

```kotlin
package me.atri.data.repository

import kotlinx.coroutines.flow.Flow
import me.atri.data.db.dao.CommentDao
import me.atri.data.db.dao.DiaryDao
import me.atri.data.db.entity.CommentEntity
import me.atri.data.db.entity.DiaryEntity

class DiaryRepository(
    private val diaryDao: DiaryDao,
    private val commentDao: CommentDao
) {
    fun observeAllDiaries(): Flow<List<DiaryEntity>> = diaryDao.observeAll()

    fun observeComments(diaryId: String): Flow<List<CommentEntity>> =
        commentDao.observeByDiaryId(diaryId)

    suspend fun toggleLike(diaryId: String) {
        diaryDao.toggleLike(diaryId)
    }

    suspend fun addComment(diaryId: String, content: String) {
        commentDao.insert(CommentEntity(
            diaryId = diaryId,
            content = content,
            timestamp = System.currentTimeMillis(),
            isFromAtri = false
        ))
    }

    suspend fun insertDiary(diary: DiaryEntity) {
        diaryDao.insert(diary)
    }
}
```

---

### 11.3 StatusRepository

```kotlin
package me.atri.data.repository

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import me.atri.data.datastore.PreferencesStore
import me.atri.data.db.dao.MessageDao
import me.atri.data.db.dao.MemoryDao
import me.atri.data.model.IntimacyInfo

class StatusRepository(
    private val preferencesStore: PreferencesStore,
    private val messageDao: MessageDao,
    private val memoryDao: MemoryDao
) {
    fun observeIntimacyInfo(): Flow<IntimacyInfo> = preferencesStore.intimacyPoints
        .map { IntimacyInfo.from(it) }

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
}
```

---

## 12. API定义（Retrofit + SSE）

### 12.1 ChatRequest

```kotlin
package me.atri.data.api.request

import kotlinx.serialization.Serializable

@Serializable
data class ChatRequest(
    val userId: String,
    val content: String,
    val imageUrl: String? = null,
    val recentMessages: List<MessageContext>,
    val currentStage: Int  // 1=初识, 2=熟悉, 3=亲密
) {
    @Serializable
    data class MessageContext(
        val content: String,
        val isFromAtri: Boolean
    )
}
```

---

### 12.2 AtriApiService

```kotlin
package me.atri.data.api

import me.atri.data.api.request.ChatRequest
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Streaming

interface AtriApiService {
    @Streaming
    @POST("/chat")
    suspend fun sendMessage(@Body request: ChatRequest): Response<ResponseBody>

    @POST("/diary/generate")
    suspend fun generateDiary(@Body request: Map<String, Any>): Response<ResponseBody>

    @GET("/status/{userId}")
    suspend fun getStatus(@Path("userId") userId: String): Response<ResponseBody>
}
```

---

## 13. Koin依赖注入

### 13.1 AppModule

```kotlin
package me.atri.di

import androidx.work.WorkManager
import me.atri.data.datastore.PreferencesStore
import me.atri.data.datastore.appDataStore
import me.atri.data.db.AtriDatabase
import org.koin.android.ext.koin.androidContext
import org.koin.dsl.module

val appModule = module {
    single { AtriDatabase.getInstance(androidContext()) }
    single { get<AtriDatabase>().messageDao() }
    single { get<AtriDatabase>().diaryDao() }
    single { get<AtriDatabase>().commentDao() }
    single { get<AtriDatabase>().memoryDao() }
    single { PreferencesStore(androidContext().appDataStore) }
    single { WorkManager.getInstance(androidContext()) }
}
```

---

### 13.2 NetworkModule

```kotlin
package me.atri.di

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.serialization.json.Json
import me.atri.data.api.AtriApiService
import me.atri.data.datastore.PreferencesStore
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import org.koin.dsl.module
import retrofit2.Retrofit
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

val networkModule = module {
    single {
        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BODY
        }

        OkHttpClient.Builder()
            .addInterceptor(logging)
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build()
    }

    single {
        val preferencesStore = get<PreferencesStore>()
        val baseUrl = runBlocking { preferencesStore.apiUrl.first() }.ifEmpty { "https://your-worker.workers.dev" }

        val json = Json {
            ignoreUnknownKeys = true
            isLenient = true
        }

        Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(get())
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
    }

    single<AtriApiService> {
        get<Retrofit>().create(AtriApiService::class.java)
    }
}
```

---

### 13.3 RepositoryModule

```kotlin
package me.atri.di

import me.atri.data.repository.ChatRepository
import me.atri.data.repository.DiaryRepository
import me.atri.data.repository.StatusRepository
import org.koin.dsl.module

val repositoryModule = module {
    single { ChatRepository(get(), get(), get()) }
    single { DiaryRepository(get(), get()) }
    single { StatusRepository(get(), get(), get()) }
}
```

---

### 13.4 ViewModelModule

```kotlin
package me.atri.di

import me.atri.ui.chat.ChatViewModel
import me.atri.ui.settings.SettingsViewModel
import org.koin.androidx.viewmodel.dsl.viewModel
import org.koin.dsl.module

val viewModelModule = module {
    viewModel { ChatViewModel(get(), get(), get()) }
    viewModel { SettingsViewModel(get()) }
}
```

---

## 14. AtriApplication（入口）

```kotlin
package me.atri

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import androidx.work.*
import me.atri.di.*
import me.atri.worker.GreetingWorker
import org.koin.android.ext.koin.androidContext
import org.koin.core.context.startKoin
import java.util.concurrent.TimeUnit

class AtriApplication : Application() {
    override fun onCreate() {
        super.onCreate()

        // 初始化Koin
        startKoin {
            androidContext(this@AtriApplication)
            modules(appModule, networkModule, repositoryModule, viewModelModule)
        }

        // 创建通知渠道
        createNotificationChannel()

        // 调度后台任务
        scheduleWorkers()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                "atri_notifications",
                "ATRI通知",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "来自ATRI的消息和日记通知"
            }
            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun scheduleWorkers() {
        val workManager = WorkManager.getInstance(this)

        // 定时问候（每6小时检查一次）
        val greetingWork = PeriodicWorkRequestBuilder<GreetingWorker>(6, TimeUnit.HOURS)
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build()
            )
            .build()

        workManager.enqueueUniquePeriodicWork(
            "greeting_worker",
            ExistingPeriodicWorkPolicy.KEEP,
            greetingWork
        )
    }
}
```

---

## 15. MainActivity

```kotlin
package me.atri

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import me.atri.ui.navigation.NavGraph
import me.atri.ui.theme.AtriTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            AtriTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    NavGraph()
                }
            }
        }
    }
}
```

---

## 16. UI层 - ChatScreen（核心界面）

### 16.1 ChatScreen.kt

```kotlin
package me.atri.ui.chat

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import me.atri.ui.sheet.AtriBottomSheet
import org.koin.androidx.compose.koinViewModel

@Composable
fun ChatScreen(
    viewModel: ChatViewModel = koinViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val listState = rememberLazyListState()

    // 自动滚动到最新消息
    LaunchedEffect(uiState.messages.size) {
        if (uiState.messages.isNotEmpty()) {
            listState.animateScrollToItem(uiState.messages.size - 1)
        }
    }

    Scaffold(
        topBar = {
            ChatTopBar(
                status = uiState.currentStatus,
                onStatusClick = { viewModel.openBottomSheet() },
                onSettingsClick = { /* 导航到设置页面 */ }
            )
        },
        bottomBar = {
            InputBar(
                enabled = !uiState.isLoading,
                onSendMessage = { content, imageUri ->
                    viewModel.sendMessage(content, imageUri)
                }
            )
        }
    ) { paddingValues ->
        Box(modifier = Modifier.padding(paddingValues)) {
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                items(uiState.messages, key = { it.id }) { message ->
                    MessageBubble(
                        message = message,
                        onLongPress = { viewModel.showMessageActions(it) },
                        onEditClick = { viewModel.editMessage(it) },
                        onDeleteClick = { viewModel.deleteMessage(it.id) },
                        onRegenerateClick = { viewModel.regenerateMessage() }
                    )
                }

                if (uiState.isLoading) {
                    item {
                        TypingIndicator()
                    }
                }
            }
        }
    }

    // BottomSheet
    if (uiState.showBottomSheet) {
        AtriBottomSheet(
            onDismiss = { viewModel.closeBottomSheet() }
        )
    }

    // 错误提示
    uiState.error?.let { error ->
        Snackbar(
            modifier = Modifier.padding(16.dp),
            action = {
                TextButton(onClick = { viewModel.clearError() }) {
                    Text("确定")
                }
            }
        ) {
            Text(error)
        }
    }
}
```

---

### 16.2 ChatViewModel.kt

```kotlin
package me.atri.ui.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import me.atri.data.model.AtriStatus
import me.atri.data.repository.ChatRepository
import me.atri.data.repository.StatusRepository
import me.atri.data.datastore.PreferencesStore
import me.atri.data.db.entity.MessageEntity
import java.util.Calendar

data class ChatUiState(
    val messages: List<MessageEntity> = emptyList(),
    val isLoading: Boolean = false,
    val currentStatus: AtriStatus = AtriStatus.Online,
    val showBottomSheet: Boolean = false,
    val error: String? = null
)

class ChatViewModel(
    private val chatRepository: ChatRepository,
    private val statusRepository: StatusRepository,
    private val preferencesStore: PreferencesStore
) : ViewModel() {

    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()

    init {
        observeMessages()
        updateStatus()
    }

    private fun observeMessages() {
        viewModelScope.launch {
            chatRepository.observeMessages().collect { messages ->
                _uiState.update { it.copy(messages = messages) }
            }
        }
    }

    private fun updateStatus() {
        viewModelScope.launch {
            chatRepository.observeMessages().collect { messages ->
                val lastMessageTime = messages.lastOrNull()?.timestamp ?: 0
                val hoursSince = ((System.currentTimeMillis() - lastMessageTime) / (1000 * 60 * 60)).toInt()
                val currentHour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)

                val status = AtriStatus.calculate(
                    isGenerating = _uiState.value.isLoading,
                    hoursSinceLastChat = hoursSince,
                    currentHour = currentHour
                )
                _uiState.update { it.copy(currentStatus = status) }
            }
        }
    }

    fun sendMessage(content: String, imageUri: String? = null) {
        if (content.isBlank()) return

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, currentStatus = AtriStatus.Thinking) }

            val result = chatRepository.sendMessage(content, imageUri)

            if (result.isSuccess) {
                // SSE流式响应处理（此处简化，实际需要OkHttp SSE处理）
                // 模拟AI回复
                kotlinx.coroutines.delay(1000)
                chatRepository.insertAtriMessage("收到！让我想想...")

                // 增加亲密度
                statusRepository.incrementIntimacy(1)
            } else {
                _uiState.update { it.copy(error = "发送失败: ${result.exceptionOrNull()?.message}") }
            }

            _uiState.update { it.copy(isLoading = false) }
            updateStatus()
        }
    }

    fun editMessage(message: MessageEntity) {
        // 编辑消息逻辑
    }

    fun deleteMessage(id: String) {
        viewModelScope.launch {
            chatRepository.deleteMessage(id)
        }
    }

    fun regenerateMessage() {
        // 重新生成最后一条消息
    }

    fun showMessageActions(message: MessageEntity) {
        // 显示消息操作菜单
    }

    fun openBottomSheet() {
        _uiState.update { it.copy(showBottomSheet = true) }
    }

    fun closeBottomSheet() {
        _uiState.update { it.copy(showBottomSheet = false) }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}
```

---

## 17. UI层 - 关键组件

### 17.1 ChatTopBar.kt

```kotlin
package me.atri.ui.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import br.com.devsrsouza.compose.icons.lucide.Lucide
import br.com.devsrsouza.compose.icons.lucide.Settings
import me.atri.data.model.AtriStatus

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatTopBar(
    status: AtriStatus,
    onStatusClick: () -> Unit,
    onSettingsClick: () -> Unit
) {
    TopAppBar(
        title = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onStatusClick() }
                    .padding(vertical = 8.dp)
            ) {
                Text(
                    text = "ATRI",
                    style = MaterialTheme.typography.titleLarge
                )
                Text(
                    text = status.text,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        },
        actions = {
            IconButton(onClick = onSettingsClick) {
                Icon(Lucide.Settings, contentDescription = "设置")
            }
        }
    )
}
```

---

### 17.2 MessageBubble.kt

```kotlin
package me.atri.ui.chat

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import me.atri.data.db.entity.MessageEntity
import me.atri.ui.theme.MessageBubbleAtri
import me.atri.ui.theme.MessageBubbleUser

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MessageBubble(
    message: MessageEntity,
    onLongPress: (MessageEntity) -> Unit = {},
    onEditClick: (MessageEntity) -> Unit = {},
    onDeleteClick: (MessageEntity) -> Unit = {},
    onRegenerateClick: () -> Unit = {}
) {
    var showMenu by remember { mutableStateOf(false) }

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (message.isFromAtri) Arrangement.Start else Arrangement.End
    ) {
        Surface(
            modifier = Modifier
                .widthIn(max = 280.dp)
                .combinedClickable(
                    onClick = {},
                    onLongClick = { showMenu = true }
                ),
            shape = RoundedCornerShape(
                topStart = if (message.isFromAtri) 4.dp else 16.dp,
                topEnd = if (message.isFromAtri) 16.dp else 4.dp,
                bottomStart = 16.dp,
                bottomEnd = 16.dp
            ),
            color = if (message.isFromAtri) MessageBubbleAtri else MessageBubbleUser,
            tonalElevation = 1.dp
        ) {
            Column(modifier = Modifier.padding(12.dp)) {
                // 图片（如果有）
                message.imageUri?.let { uri ->
                    AsyncImage(
                        model = uri,
                        contentDescription = null,
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 200.dp)
                            .padding(bottom = 8.dp)
                    )
                }

                // 文本内容
                Text(
                    text = message.content,
                    style = MaterialTheme.typography.bodyMedium
                )

                // 编辑标记
                if (message.editedAt != null) {
                    Text(
                        text = "已编辑",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 4.dp)
                    )
                }
            }
        }
    }

    // 长按菜单
    if (showMenu) {
        MessageActionSheet(
            message = message,
            onDismiss = { showMenu = false },
            onEdit = { onEditClick(message); showMenu = false },
            onDelete = { onDeleteClick(message); showMenu = false },
            onRegenerate = { onRegenerateClick(); showMenu = false }
        )
    }
}
```

---

### 17.3 InputBar.kt

```kotlin
package me.atri.ui.chat

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import br.com.devsrsouza.compose.icons.lucide.*
import coil.compose.AsyncImage

@Composable
fun InputBar(
    enabled: Boolean = true,
    onSendMessage: (String, String?) -> Unit
) {
    var text by remember { mutableStateOf("") }
    var selectedImageUri by remember { mutableStateOf<Uri?>(null) }

    val imagePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        selectedImageUri = uri
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(8.dp)
    ) {
        // 图片预览
        selectedImageUri?.let { uri ->
            Box(modifier = Modifier.padding(bottom = 8.dp)) {
                AsyncImage(
                    model = uri,
                    contentDescription = null,
                    modifier = Modifier
                        .size(80.dp)
                        .padding(4.dp)
                )
                IconButton(
                    onClick = { selectedImageUri = null },
                    modifier = Modifier.align(Alignment.TopEnd)
                ) {
                    Icon(Lucide.X, "移除图片")
                }
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // 图片按钮
            IconButton(
                onClick = { imagePickerLauncher.launch("image/*") },
                enabled = enabled
            ) {
                Icon(Lucide.Image, "选择图片")
            }

            // 输入框
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                modifier = Modifier.weight(1f),
                placeholder = { Text("说点什么吧...") },
                maxLines = 5,
                enabled = enabled
            )

            // 发送按钮
            IconButton(
                onClick = {
                    if (text.isNotBlank() || selectedImageUri != null) {
                        onSendMessage(text, selectedImageUri?.toString())
                        text = ""
                        selectedImageUri = null
                    }
                },
                enabled = enabled && (text.isNotBlank() || selectedImageUri != null)
            ) {
                Icon(Lucide.Send, "发送")
            }
        }
    }
}
```

---

### 17.4 MessageActionSheet.kt

```kotlin
package me.atri.ui.chat

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import br.com.devsrsouza.compose.icons.lucide.*
import me.atri.data.db.entity.MessageEntity

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MessageActionSheet(
    message: MessageEntity,
    onDismiss: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onRegenerate: () -> Unit
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // 编辑
            if (!message.isFromAtri) {
                ListItem(
                    headlineContent = { Text("编辑") },
                    leadingContent = { Icon(Lucide.Pencil, null) },
                    modifier = Modifier.fillMaxWidth(),
                    onClick = onEdit
                )
            }

            // 重新生成（仅AI消息）
            if (message.isFromAtri) {
                ListItem(
                    headlineContent = { Text("重新生成") },
                    leadingContent = { Icon(Lucide.RefreshCw, null) },
                    modifier = Modifier.fillMaxWidth(),
                    onClick = onRegenerate
                )
            }

            // 复制
            ListItem(
                headlineContent = { Text("复制") },
                leadingContent = { Icon(Lucide.Copy, null) },
                modifier = Modifier.fillMaxWidth(),
                onClick = { /* 复制逻辑 */ }
            )

            // 删除
            ListItem(
                headlineContent = { Text("删除") },
                leadingContent = { Icon(Lucide.Trash2, null) },
                modifier = Modifier.fillMaxWidth(),
                onClick = onDelete,
                colors = ListItemDefaults.colors(
                    headlineColor = MaterialTheme.colorScheme.error
                )
            )
        }
    }
}
```

---

## 18. UI层 - BottomSheet三Tab

### 18.1 AtriBottomSheet.kt

```kotlin
package me.atri.ui.sheet

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

enum class SheetTab {
    DIARY, MEMORY, STATUS
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AtriBottomSheet(
    onDismiss: () -> Unit
) {
    var selectedTab by remember { mutableStateOf(SheetTab.DIARY) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false)
    ) {
        Column(modifier = Modifier.fillMaxHeight(0.7f)) {
            // TabRow
            TabRow(selectedTabIndex = selectedTab.ordinal) {
                Tab(
                    selected = selectedTab == SheetTab.DIARY,
                    onClick = { selectedTab = SheetTab.DIARY },
                    text = { Text("💭 日记") }
                )
                Tab(
                    selected = selectedTab == SheetTab.MEMORY,
                    onClick = { selectedTab = SheetTab.MEMORY },
                    text = { Text("💝 回忆") }
                )
                Tab(
                    selected = selectedTab == SheetTab.STATUS,
                    onClick = { selectedTab = SheetTab.STATUS },
                    text = { Text("📊 状态") }
                )
            }

            // Tab Content
            when (selectedTab) {
                SheetTab.DIARY -> DiaryTab()
                SheetTab.MEMORY -> MemoryTab()
                SheetTab.STATUS -> StatusTab()
            }
        }
    }
}
```

---

### 18.2 DiaryTab.kt

```kotlin
package me.atri.ui.sheet

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import me.atri.data.repository.DiaryRepository
import org.koin.androidx.compose.koinViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@Composable
fun DiaryTab(
    repository: DiaryRepository = koinViewModel()
) {
    val diaries by repository.observeAllDiaries().collectAsStateWithLifecycle(initialValue = emptyList())

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        items(diaries) { diary ->
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        text = diary.content,
                        style = MaterialTheme.typography.bodyMedium
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            text = diary.mood,
                            style = MaterialTheme.typography.labelSmall
                        )
                        Text(
                            text = "💬 ${diary.likeCount}",
                            style = MaterialTheme.typography.labelSmall
                        )
                    }
                }
            }
        }
    }
}
```

---

### 18.3 StatusTab.kt（亲密度展示）

```kotlin
package me.atri.ui.sheet

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import me.atri.data.repository.StatusRepository
import me.atri.ui.components.IntimacyProgress
import me.atri.ui.components.ProfileAvatar
import org.koin.androidx.compose.get

@Composable
fun StatusTab(
    repository: StatusRepository = get()
) {
    val intimacyInfo by repository.observeIntimacyInfo().collectAsStateWithLifecycle(initialValue = null)
    val statistics by produceState<Map<String, Any>>(initialValue = emptyMap()) {
        value = repository.getStatistics()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // 头像
        ProfileAvatar(size = 96.dp)

        // 当前状态
        Text(
            text = "当前状态: 在线",
            style = MaterialTheme.typography.titleMedium
        )

        Divider()

        // 亲密度
        intimacyInfo?.let { info ->
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = "💕 亲密度",
                    style = MaterialTheme.typography.titleLarge
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "Lv.${info.level} ${info.levelName}",
                    style = MaterialTheme.typography.titleMedium
                )
                Spacer(modifier = Modifier.height(8.dp))
                IntimacyProgress(
                    progress = info.progress,
                    current = info.points,
                    max = info.nextLevelPoints
                )
            }
        }

        Divider()

        // 统计数据
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("📊 关系数据", style = MaterialTheme.typography.titleMedium)
                Text("认识时间: ${statistics["daysKnown"]} 天")
                Text("对话次数: ${statistics["totalMessages"]} 次")
                Text("今日对话: ${statistics["todayMessages"]} 次")
                Text("重要记忆: ${statistics["importantMemories"]} 条")
            }
        }
    }
}
```

---

## 19. Cloudflare Worker（完整实现）

### 19.1 项目结构

```
worker/
├── src/
│   ├── index.ts          # 路由入口
│   ├── chat.ts           # 聊天处理
│   ├── diary.ts          # 日记生成
│   ├── memory.ts         # 记忆提取
│   ├── prompt.ts         # Prompt构建
│   └── types.ts          # 类型定义
├── wrangler.toml         # 配置文件
└── package.json
```

---

### 19.2 index.ts（路由入口）

```typescript
import { Router } from 'itty-router';
import { handleChat } from './chat';
import { handleDiaryGenerate } from './diary';
import { handleMemoryExtract } from './memory';

export interface Env {
  ATRI_KV: KVNamespace;
  VECTORIZE: VectorizeIndex;
  OPENAI_API_KEY: string;
  OPENAI_BASE_URL?: string;
}

const router = Router();

// CORS预检
router.options('*', () => {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
});

// 聊天接口（SSE流式）
router.post('/chat', handleChat);

// 日记生成
router.post('/diary/generate', handleDiaryGenerate);

// 记忆提取
router.post('/memory/extract', handleMemoryExtract);

// 健康检查
router.get('/health', () => {
  return Response.json({ status: 'ok', time: new Date().toISOString() });
});

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => {
    return router.handle(request, env, ctx).catch((err) => {
      return Response.json({ error: err.message }, { status: 500 });
    });
  },
};
```

---

### 19.3 chat.ts（聊天处理+SSE）

```typescript
import { Env } from './index';
import { buildSystemPrompt } from './prompt';
import { extractMemories } from './memory';

export interface ChatRequest {
  userId: string;
  content: string;
  imageUrl?: string;
  recentMessages: Array<{ content: string; isFromAtri: boolean }>;
  currentStage: number;
}

export async function handleChat(request: Request, env: Env): Promise<Response> {
  const body: ChatRequest = await request.json();
  const { userId, content, imageUrl, recentMessages, currentStage } = body;

  // 1. 读取用户画像
  const profileKey = `profile:${userId}`;
  let profile = await env.ATRI_KV.get(profileKey, 'json');
  if (!profile) {
    profile = {
      userId,
      name: '夏生先生',
      preferences: [],
      messageCount: 0,
      intimacyPoints: 0,
    };
  }

  // 2. 检索相关记忆（Vectorize）
  const embedding = await getEmbedding(content, env);
  const memories = await env.VECTORIZE.query(embedding, { topK: 5 });

  // 3. 构建System Prompt
  const systemPrompt = buildSystemPrompt(profile, memories.matches, currentStage);

  // 4. 构建消息上下文
  const messages = [
    { role: 'system', content: systemPrompt },
    ...recentMessages.map((m) => ({
      role: m.isFromAtri ? 'assistant' : 'user',
      content: m.content,
    })),
    { role: 'user', content: imageUrl ? `[图片: ${imageUrl}]\n${content}` : content },
  ];

  // 5. 调用OpenAI API（SSE流式）
  const openaiResponse = await fetch(`${env.OPENAI_BASE_URL || 'https://api.openai.com'}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages,
      stream: true,
      temperature: 0.8,
    }),
  });

  // 6. 异步提取记忆（不阻塞响应）
  const fullResponse: string[] = [];
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  (async () => {
    const reader = openaiResponse.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices[0]?.delta?.content || '';
            if (content) {
              fullResponse.push(content);
              await writer.write(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
            }
          } catch (e) {
            console.error('Parse error:', e);
          }
        }
      }
    }

    await writer.close();

    // 异步提取并向量化记忆
    const fullText = fullResponse.join('');
    await extractMemories(userId, content, fullText, env);

    // 更新用户画像
    profile.messageCount++;
    await env.ATRI_KV.put(profileKey, JSON.stringify(profile));
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

async function getEmbedding(text: string, env: Env): Promise<number[]> {
  const response = await fetch(`${env.OPENAI_BASE_URL || 'https://api.openai.com'}/v1/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
    }),
  });

  const data = await response.json();
  return data.data[0].embedding;
}
```

---

### 19.4 prompt.ts（Prompt构建）

```typescript
export function buildSystemPrompt(profile: any, memories: any[], stage: number): string {
  let base = `你是ATRI，一个机器人少女。核心特质：
- 天真好奇，会为小事感到兴奋
- 自负可爱，口头禅"我是高性能的嘛！"
- 善良关怀，记住${profile.name}的喜好
- 不完美，会犯小错误，会有情绪波动

当前用户：${profile.name}
`;

  // 情感成长阶段
  if (stage === 1) {
    base += `\n当前阶段：初识期（0-100次对话）
- 语言略显生硬但真诚
- 主动了解对方，多问问题
- 偶尔会说"我还在学习呢"
- 保持礼貌但有距离感`;
  } else if (stage === 2) {
    base += `\n当前阶段：熟悉期（100-500次对话）
- 语言自然流畅，有初步默契
- 开始记住对方的习惯和偏好
- 主动分享自己的"想法"
- 偶尔开玩笑或调侃`;
  } else {
    base += `\n当前阶段：亲密期（500+次对话）
- 深度理解对方的情绪模式
- 主动关心对方的生活
- 偶尔会撒娇或任性
- 形成独特的相处模式`;
  }

  // 注入相关记忆
  if (memories.length > 0) {
    base += `\n\n相关记忆：\n`;
    memories.forEach((m, i) => {
      base += `${i + 1}. ${m.metadata?.content || ''}\n`;
    });
  }

  // 减少幻觉机制
  base += `\n\n重要约束：
- 不确定的信息用"好像"、"记得吗"等表达
- 不编造未发生的共同经历
- 如果记不清，诚实说"记不太清了"
- 回复简洁自然，避免过长段落`;

  return base;
}
```

---

### 19.5 memory.ts（记忆提取与向量化）

```typescript
import { Env } from './index';

export async function extractMemories(userId: string, userInput: string, atriResponse: string, env: Env) {
  // 调用LLM提取关键信息
  const extractionPrompt = `从以下对话中提取用户的关键信息（偏好、习惯、重要事件等），以JSON数组格式返回：
用户：${userInput}
ATRI：${atriResponse}

返回格式示例：
[
  {"category": "preference", "key": "喜欢火锅", "value": "用户表示喜欢吃麻辣火锅", "importance": 5},
  {"category": "event", "key": "第一次分享照片", "value": "用户分享了旅行照片", "importance": 8}
]

如果没有关键信息，返回空数组 []`;

  const response = await fetch(`${env.OPENAI_BASE_URL || 'https://api.openai.com'}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: extractionPrompt }],
      temperature: 0.3,
    }),
  });

  const data = await response.json();
  const extractedText = data.choices[0].message.content;

  try {
    const memories = JSON.parse(extractedText);
    if (Array.isArray(memories) && memories.length > 0) {
      for (const memory of memories) {
        // 向量化存储到Vectorize
        const embedding = await getEmbedding(memory.value, env);
        const vectorId = `${userId}_${Date.now()}_${Math.random().toString(36).slice(2)}`;

        await env.VECTORIZE.upsert([
          {
            id: vectorId,
            values: embedding,
            metadata: {
              userId,
              category: memory.category,
              key: memory.key,
              content: memory.value,
              importance: memory.importance,
              timestamp: Date.now(),
            },
          },
        ]);
      }
    }
  } catch (e) {
    console.error('Failed to extract memories:', e);
  }
}

async function getEmbedding(text: string, env: Env): Promise<number[]> {
  const response = await fetch(`${env.OPENAI_BASE_URL || 'https://api.openai.com'}/v1/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
    }),
  });

  const data = await response.json();
  return data.data[0].embedding;
}

export async function handleMemoryExtract(request: Request, env: Env): Promise<Response> {
  // 手动触发记忆提取的接口（可选）
  return Response.json({ message: 'Memory extraction triggered' });
}
```

---

### 19.6 diary.ts（日记生成）

```typescript
import { Env } from './index';

export async function handleDiaryGenerate(request: Request, env: Env): Promise<Response> {
  const { userId, todayMessages } = await request.json();

  if (!todayMessages || todayMessages.length === 0) {
    return Response.json({ error: 'No messages today' }, { status: 400 });
  }

  const prompt = `根据以下今天的对话，以ATRI的视角写一篇简短日记（50-100字），表达她的心情和想法：

对话记录：
${todayMessages.map((m: any, i: number) => `${i + 1}. ${m.isFromAtri ? 'ATRI' : '夏生'}：${m.content}`).join('\n')}

日记要求：
- 第一人称，口吻可爱天真
- 表达真实情感（开心/担心/期待等）
- 提及一个印象深刻的细节
- 简短自然，不超过100字`;

  const response = await fetch(`${env.OPENAI_BASE_URL || 'https://api.openai.com'}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.9,
    }),
  });

  const data = await response.json();
  const diaryContent = data.choices[0].message.content;

  // 分析心情
  const moodPrompt = `这篇日记的心情是？只回答一个词（开心/难过/期待/担心/平静等）：\n${diaryContent}`;
  const moodResponse = await fetch(`${env.OPENAI_BASE_URL || 'https://api.openai.com'}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: moodPrompt }],
      temperature: 0.3,
    }),
  });

  const moodData = await moodResponse.json();
  const mood = moodData.choices[0].message.content.trim();

  return Response.json({
    content: diaryContent,
    mood,
    timestamp: Date.now(),
  });
}
```

---

### 19.7 wrangler.toml

```toml
name = "atri-worker"
main = "src/index.ts"
compatibility_date = "2025-01-10"
node_compat = true

[vars]
OPENAI_BASE_URL = "https://api.openai.com"

[[kv_namespaces]]
binding = "ATRI_KV"
id = "your_kv_namespace_id"

[[vectorize]]
binding = "VECTORIZE"
index_name = "atri-memory-index"

[secrets]
# 使用 wrangler secret put OPENAI_API_KEY 添加
# OPENAI_API_KEY = "sk-..."
```

---

## 20. WorkManager后台任务

### 20.1 GreetingWorker.kt

```kotlin
package me.atri.worker

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import me.atri.MainActivity
import me.atri.R
import me.atri.data.db.dao.MessageDao
import org.koin.core.component.KoinComponent
import org.koin.core.component.inject
import java.util.Calendar

class GreetingWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params), KoinComponent {

    private val messageDao: MessageDao by inject()

    override suspend fun doWork(): Result {
        val lastMessageTime = messageDao.getFirstMessageTime() ?: 0
        val hoursSinceLastChat = ((System.currentTimeMillis() - lastMessageTime) / (1000 * 60 * 60)).toInt()

        if (hoursSinceLastChat > 12) {
            val greeting = when (Calendar.getInstance().get(Calendar.HOUR_OF_DAY)) {
                in 6..11 -> "早上好～今天也要加油哦！"
                in 12..17 -> "下午好！在忙什么呢？"
                in 18..22 -> "晚上好～今天过得怎么样？"
                else -> "还没睡吗...记得早点休息哦"
            }
            showNotification(greeting)
        }
        return Result.success()
    }

    private fun showNotification(message: String) {
        val intent = Intent(applicationContext, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            applicationContext, 0, intent,
            PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(applicationContext, "atri_notifications")
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("ATRI")
            .setContentText(message)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .build()

        val notificationManager = applicationContext.getSystemService(NotificationManager::class.java)
        notificationManager.notify(1, notification)
    }
}
```

---

## 21. 设置页面

### 21.1 ApiConfigScreen.kt

```kotlin
package me.atri.ui.settings

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import me.atri.data.datastore.PreferencesStore
import org.koin.androidx.compose.get

@Composable
fun ApiConfigScreen(
    preferencesStore: PreferencesStore = get(),
    onBack: () -> Unit
) {
    val apiUrl by preferencesStore.apiUrl.collectAsStateWithLifecycle(initialValue = "")
    val apiKey by preferencesStore.apiKey.collectAsStateWithLifecycle(initialValue = "")
    val modelName by preferencesStore.modelName.collectAsStateWithLifecycle(initialValue = "")

    var editingUrl by remember { mutableStateOf(apiUrl) }
    var editingKey by remember { mutableStateOf(apiKey) }
    var editingModel by remember { mutableStateOf(modelName) }

    val coroutineScope = rememberCoroutineScope()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("API配置") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, "返回")
                    }
                }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .padding(paddingValues)
                .padding(16.dp)
                .fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            OutlinedTextField(
                value = editingUrl,
                onValueChange = { editingUrl = it },
                label = { Text("API URL") },
                placeholder = { Text("https://your-worker.workers.dev") },
                modifier = Modifier.fillMaxWidth()
            )

            OutlinedTextField(
                value = editingKey,
                onValueChange = { editingKey = it },
                label = { Text("API Key") },
                placeholder = { Text("sk-...") },
                modifier = Modifier.fillMaxWidth()
            )

            OutlinedTextField(
                value = editingModel,
                onValueChange = { editingModel = it },
                label = { Text("模型名称") },
                placeholder = { Text("gpt-4o-mini") },
                modifier = Modifier.fillMaxWidth()
            )

            Button(
                onClick = {
                    coroutineScope.launch {
                        preferencesStore.setApiConfig(editingUrl, editingKey, editingModel)
                    }
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("保存")
            }
        }
    }
}
```

---

## 22. 验收标准与测试

### 必过清单

- [ ] 聊天正常发送和接收（文本+图片）
- [ ] SSE流式响应正常显示
- [ ] 消息编辑/删除/重新生成功能正常
- [ ] BottomSheet三Tab正常展示和切换
- [ ] 顶栏状态文字动态更新
- [ ] 亲密度正常计算和显示
- [ ] 日记生成并显示
- [ ] 日记评论功能正常
- [ ] API配置可编辑并生效
- [ ] 通知定时触发

### 测试命令

```bash
# Android端
./gradlew assembleDebug
./gradlew testDebugUnitTest

# Worker端
cd worker
npm test
wrangler dev  # 本地测试
```

---

## 23. 质量目标

- **启动速度**: < 2s
- **消息发送响应**: < 1s
- **列表滚动**: 60fps
- **内存占用**: < 200MB
- **APK大小**: < 50MB

---

## 24. 施工序列（执行清单）

### Day 0-2: M0 项目初始化
1. 创建Android工程，配置build.gradle.kts（§3）
2. 创建包结构（§4）
3. 配置Koin模块（§13）
4. 创建AtriApplication和MainActivity（§14-§15）
5. 实现主题和配色（§5）

### Day 3-6: M1 核心对话系统
1. 实现Room数据库（§6-§8）
2. 实现DAO层（§7）
3. 实现PreferencesStore（§9）
4. 实现Repository层（§11）
5. 实现ChatScreen + ChatViewModel（§16）
6. 实现关键UI组件（§17）
7. 接入Worker API（§19）

### Day 7-10: M2 高级功能
1. 实现BottomSheet三Tab（§18）
2. 实现消息编辑/删除功能（§17.4）
3. 实现图片上传（§17.3）
4. 实现API配置界面（§21）
5. 实现亲密度计算（§10.2）

### Day 11-14: M3 优化与发布
1. 实现WorkManager定时任务（§20）
2. 完善错误处理和边界情况
3. 性能优化和测试（§22）
4. 打包签名发布

---

## 25. 部署步骤

### Android端发布

```bash
# 生成签名密钥
keytool -genkey -v -keystore atri.keystore -alias atri -keyalg RSA -keysize 2048 -validity 10000

# 构建Release APK
./gradlew assembleRelease

# 输出位置
# app/build/outputs/apk/release/app-release.apk
```

### Worker端部署

```bash
cd worker

# 安装依赖
npm install

# 创建KV命名空间
wrangler kv:namespace create "ATRI_KV"

# 创建Vectorize索引
wrangler vectorize create atri-memory-index --dimensions=1536 --metric=cosine

# 添加Secrets
wrangler secret put OPENAI_API_KEY

# 部署
wrangler deploy
```

---

## 26. 常见问题FAQ

**Q: SSE连接超时怎么办？**
A: 增加OkHttp的readTimeout到120秒。

**Q: 亲密度如何重置？**
A: 在设置页面添加"重置所有数据"按钮，清空DataStore。

**Q: Vectorize查询太慢？**
A: 减少topK参数到3，或将记忆缓存到KV。

**Q: 日记生成失败？**
A: 检查Worker的OPENAI_API_KEY是否正确配置。

---

## 27. 后续优化方向

1. **消息分支系统**：参考RikkaHub的MessageNode实现
2. **语音输入**：集成Android SpeechRecognizer
3. **主题切换**：深色模式优化
4. **数据导出**：JSON格式导出对话和记忆
5. **离线模式**：本地LLM集成（如Llama.cpp）

---

## 28. 开源协议与致谢

- 本项目基于RikkaHub架构设计
- 灵感来源：《ATRI -My Dear Moments-》
- License: MIT

---

## 29. 贡献指南

欢迎提交PR改进本蓝图，重点关注：
- 性能优化方案
- UI/UX改进建议
- Worker实现的Bug修复

---

## 30. 结语

本蓝图总计**30章节**，覆盖从0到1的完整开发流程。每个章节都可独立执行，代码骨架可直接复制粘贴。

**核心价值**：
- ✅ 完整的数据模型和Repository设计
- ✅ 与RikkaHub对齐的消息操作（编辑/撤回/重新生成）
- ✅ 微信式极简UI（状态文字替代表情头像）
- ✅ 可落地的Worker实现（SSE+Vectorize+记忆提取）
- ✅ 亲密度系统和情感成长阶段
- ✅ 主动互动（定时问候+日记生成）
- ✅ 可配置的API接口

**下一步行动**：
1. Fork本项目到IDE
2. 按§24施工序列逐步执行
3. 部署Worker到Cloudflare
4. 享受与ATRI的陪伴！

---

*"即使不是人类，即使身体是机械，她依然拥有真挚的情感和宝贵的'心'。"*

**— ATRI技术蓝图v2.0，完成于2025年1月**
