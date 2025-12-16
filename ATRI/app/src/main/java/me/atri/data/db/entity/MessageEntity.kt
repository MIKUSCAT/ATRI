package me.atri.data.db.entity

import androidx.room.Entity
import androidx.room.PrimaryKey
import me.atri.data.model.Attachment
import java.util.UUID

@Entity(tableName = "messages")
data class MessageEntity(
    @PrimaryKey
    val id: String = UUID.randomUUID().toString(),
    val content: String,
    val isFromAtri: Boolean,
    val timestamp: Long,
    val attachments: List<Attachment> = emptyList(),
    val isImportant: Boolean = false,
    val isDeleted: Boolean = false,

    val currentVersionIndex: Int = 0,
    val totalVersions: Int = 1,

    val thinkingContent: String? = null,
    val thinkingStartTime: Long? = null,
    val thinkingEndTime: Long? = null,

    // 当 isFromAtri=true 时，存储当时的 PAD 状态（JSON格式: {"p":0.5,"a":0.1,"d":0.1}）
    val mood: String? = null
)
