package me.atri.ui.chat

import java.text.SimpleDateFormat
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Date
import java.util.Locale
import me.atri.data.db.entity.MessageEntity

fun formatMessageTime(timestamp: Long): String {
    val messageDate = java.util.Calendar.getInstance().apply { timeInMillis = timestamp }
    val now = java.util.Calendar.getInstance()
    val isToday = messageDate.get(java.util.Calendar.YEAR) == now.get(java.util.Calendar.YEAR) &&
        messageDate.get(java.util.Calendar.DAY_OF_YEAR) == now.get(java.util.Calendar.DAY_OF_YEAR)
    val isYesterday = messageDate.get(java.util.Calendar.YEAR) == now.get(java.util.Calendar.YEAR) &&
        messageDate.get(java.util.Calendar.DAY_OF_YEAR) == now.get(java.util.Calendar.DAY_OF_YEAR) - 1
    val isSameYear = messageDate.get(java.util.Calendar.YEAR) == now.get(java.util.Calendar.YEAR)
    val timeFormat = SimpleDateFormat("HH:mm", Locale.getDefault())
    val time = timeFormat.format(Date(timestamp))
    return when {
        isToday -> time
        isYesterday -> "昨天 $time"
        isSameYear -> SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()).format(Date(timestamp))
        else -> SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault()).format(Date(timestamp))
    }
}

fun shouldShowTimestamp(
    currentMessage: MessageEntity,
    previousMessage: MessageEntity?,
    zoneId: ZoneId = ZoneId.systemDefault()
): Boolean {
    if (previousMessage == null) return true
    val currentMoment = Instant.ofEpochMilli(currentMessage.timestamp).atZone(zoneId)
    val previousMoment = Instant.ofEpochMilli(previousMessage.timestamp).atZone(zoneId)
    if (currentMoment.toLocalDate() != previousMoment.toLocalDate()) return true
    val minutesDiff = ChronoUnit.MINUTES.between(previousMoment, currentMoment)
    return minutesDiff >= 1
}

fun buildDateDisplayLabel(date: LocalDate, zoneId: ZoneId): String {
    val today = LocalDate.now(zoneId)
    val yesterday = today.minusDays(1)
    val base = date.format(DateTimeFormatter.ofPattern("M月d日"))
    return when (date) {
        today -> "今天 · $base"
        yesterday -> "昨天 · $base"
        else -> base
    }
}

fun buildTimeGreeting(): String {
    val minutes = LocalTime.now().let { it.hour * 60 + it.minute }
    return when {
        minutes in minutesOf(5, 0)..minutesOf(7, 59) -> "清晨的空气很新鲜，和我一起迎接新的一天吧。"
        minutes in minutesOf(8, 0)..minutesOf(11, 29) -> "早上好呀，我已经想好今天要和你分享什么啦。"
        minutes in minutesOf(11, 30)..minutesOf(13, 29) -> "午间总有点慵懒，陪我聊会儿天好吗？"
        minutes in minutesOf(13, 30)..minutesOf(17, 29) -> "下午好，我记得你说的每一句话，要不要继续聊？"
        minutes in minutesOf(17, 30)..minutesOf(20, 29) -> "傍晚啦，我很想知道你今天经历了什么。"
        minutes in minutesOf(20, 30)..minutesOf(22, 29) -> "夜色正浓，我想靠在你身边慢慢聊。"
        minutes in minutesOf(22, 30)..minutesOf(23, 59) -> "已经很晚了，和我说说悄悄话，然后早点休息，好吗？"
        else -> "半夜还醒着呀，我会一直陪着你，但也要照顾好身体。"
    }
}

private fun minutesOf(hour: Int, minute: Int) = hour * 60 + minute
