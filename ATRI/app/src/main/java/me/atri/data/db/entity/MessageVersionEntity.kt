package me.atri.data.db.entity

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import me.atri.data.model.Attachment
import java.util.UUID

@Entity(
    tableName = "message_versions",
    foreignKeys = [
        ForeignKey(
            entity = MessageEntity::class,
            parentColumns = ["id"],
            childColumns = ["messageId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index(value = ["messageId", "versionIndex"])]
)
data class MessageVersionEntity(
    @PrimaryKey
    val id: String = UUID.randomUUID().toString(),
    val messageId: String,
    val content: String,
    val attachments: List<Attachment> = emptyList(),
    val timestamp: Long = System.currentTimeMillis(),
    val versionIndex: Int
)
