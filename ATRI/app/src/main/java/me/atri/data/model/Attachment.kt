package me.atri.data.model

import android.net.Uri
import kotlinx.serialization.Serializable
import java.util.UUID

@Serializable
data class Attachment(
    val id: String = UUID.randomUUID().toString(),
    val type: AttachmentType,
    val url: String,
    val mime: String,
    val name: String? = null,
    val sizeBytes: Long? = null,
    val width: Int? = null,
    val height: Int? = null
)

@Serializable
enum class AttachmentType {
    IMAGE,
    DOCUMENT
}

/**
 * UI 层用于暂存待上传附件的模型。
 */
data class PendingAttachment(
    val uri: Uri,
    val mime: String,
    val name: String,
    val sizeBytes: Long?,
    val type: AttachmentType
)

