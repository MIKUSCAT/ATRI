package me.atri.data.db

import androidx.room.TypeConverter
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import me.atri.data.model.Attachment

object AttachmentTypeConverters {
    private val json = Json { ignoreUnknownKeys = true }

    @TypeConverter
    @JvmStatic
    fun fromJson(value: String?): List<Attachment> {
        if (value.isNullOrBlank()) return emptyList()
        return runCatching { json.decodeFromString<List<Attachment>>(value) }.getOrElse { emptyList() }
    }

    @TypeConverter
    @JvmStatic
    fun toJson(value: List<Attachment>?): String {
        val safeList = value?.takeIf { it.isNotEmpty() } ?: emptyList()
        // 确保数据库永远得到合法 JSON，避免写入 NULL 触发 NOT NULL 约束
        return runCatching { json.encodeToString(safeList) }.getOrDefault("[]")
    }
}
