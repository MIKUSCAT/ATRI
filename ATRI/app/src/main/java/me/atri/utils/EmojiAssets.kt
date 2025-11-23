package me.atri.utils

import me.atri.data.model.Attachment
import me.atri.data.model.AttachmentType

/**
 * 提供表情名到图片地址的映射，以及便捷的附件构造。
 * URL 先占位，后续把实际上传后的地址替换进来即可。
 */
object EmojiAssets {
    // TODO: 将这些占位地址替换为你上传后的真实表情包 URL（前缀已替换为 mikuscat.qzz.io）
    private val emojiUrls: Map<String, String> = mapOf(
        "冷漠" to "https://mikuscat.qzz.io/media/u/5e784490-821b-4812-967c-d93c4f3ede2a/1763884878052-1000018802.jpg",
        "加油" to "https://mikuscat.qzz.io/media/u/5e784490-821b-4812-967c-d93c4f3ede2a/1763884547905-1000018798.jpg",
        "吃饭啦" to "https://mikuscat.qzz.io/media/u/5e784490-821b-4812-967c-d93c4f3ede2a/1763884546830-1000018796.jpg",
        "害羞" to "https://mikuscat.qzz.io/media/u/5e784490-821b-4812-967c-d93c4f3ede2a/1763884548820-1000018797.jpg",
        "开心" to "https://mikuscat.qzz.io/media/u/5e784490-821b-4812-967c-d93c4f3ede2a/1763884876348-1000018800.jpg",
        "惊讶" to "https://mikuscat.qzz.io/media/u/5e784490-821b-4812-967c-d93c4f3ede2a/1763884875417-1000018799.jpg",
        "拜托啦" to "https://mikuscat.qzz.io/media/u/5e784490-821b-4812-967c-d93c4f3ede2a/1763884545105-1000018795.jpg",
        "早上好" to "https://mikuscat.qzz.io/media/u/5e784490-821b-4812-967c-d93c4f3ede2a/1763884545955-1000018794.jpg",
        "早安" to "https://mikuscat.qzz.io/media/u/5e784490-821b-4812-967c-d93c4f3ede2a/1763884544055-1000018793.jpg",
        "晚安" to "https://mikuscat.qzz.io/media/u/5e784490-821b-4812-967c-d93c4f3ede2a/1763884915868-1000018805.jpg",
        "生气" to "https://mikuscat.qzz.io/media/u/5e784490-821b-4812-967c-d93c4f3ede2a/1763884878922-1000018803.jpg",
        "疑问" to "https://mikuscat.qzz.io/media/u/5e784490-821b-4812-967c-d93c4f3ede2a/1763884917678-1000018807.jpg",
        "睡觉" to "https://mikuscat.qzz.io/media/u/5e784490-821b-4812-967c-d93c4f3ede2a/1763884880038-1000018804.jpg",
        "累了" to "https://mikuscat.qzz.io/media/u/5e784490-821b-4812-967c-d93c4f3ede2a/1763884877212-1000018801.jpg",
        "谢谢" to "https://mikuscat.qzz.io/media/u/5e784490-821b-4812-967c-d93c4f3ede2a/1763884916797-1000018806.jpg"
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
