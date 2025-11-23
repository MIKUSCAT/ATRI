package me.atri.data.model

/**
 * 附件类型契约，需与 worker/src/index.ts 中的 ATTACHMENT_TYPES 保持一致。
 */
object AttachmentContract {
    const val TYPE_IMAGE = "image"
    const val TYPE_DOCUMENT = "document"

    val SUPPORTED_TYPES = setOf(TYPE_IMAGE, TYPE_DOCUMENT)
}
