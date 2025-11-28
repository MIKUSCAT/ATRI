package me.atri.utils

import me.atri.data.model.Attachment
import me.atri.data.model.AttachmentType

/**
 * 提供表情名到图片地址的映射，以及便捷的附件构造。
 * URL 先占位，后续把实际上传后的地址替换进来即可。
 */
object EmojiAssets {
    private const val DEMO_MEDIA_BASE = "https://your-worker.example.com/media/demo"
    // 这些地址仅为演示，请在部署后把自己的表情包 URL 填进来。
    private val emojiUrls: Map<String, String> = mapOf(
        "冷漠" to "$DEMO_MEDIA_BASE/emoji-neutral.jpg",
        "加油" to "$DEMO_MEDIA_BASE/emoji-cheer.jpg",
        "吃饭啦" to "$DEMO_MEDIA_BASE/emoji-meal.jpg",
        "害羞" to "$DEMO_MEDIA_BASE/emoji-shy.jpg",
        "开心" to "$DEMO_MEDIA_BASE/emoji-happy.jpg",
        "惊讶" to "$DEMO_MEDIA_BASE/emoji-surprise.jpg",
        "拜托啦" to "$DEMO_MEDIA_BASE/emoji-please.jpg",
        "早上好" to "$DEMO_MEDIA_BASE/emoji-morning.jpg",
        "早安" to "$DEMO_MEDIA_BASE/emoji-hello.jpg",
        "晚安" to "$DEMO_MEDIA_BASE/emoji-night.jpg",
        "生气" to "$DEMO_MEDIA_BASE/emoji-angry.jpg",
        "疑问" to "$DEMO_MEDIA_BASE/emoji-question.jpg",
        "睡觉" to "$DEMO_MEDIA_BASE/emoji-sleep.jpg",
        "累了" to "$DEMO_MEDIA_BASE/emoji-tired.jpg",
        "谢谢" to "$DEMO_MEDIA_BASE/emoji-thanks.jpg"
    )

    fun createEmojiAttachmentOrNull(name: String): Attachment? {
        val url = emojiUrls[name] ?: return null
        return Attachment(
            type = AttachmentType.IMAGE,
            url = url,
            mime = "image/jpeg",
            name = name,
            sizeBytes = null
        )
    }
}
