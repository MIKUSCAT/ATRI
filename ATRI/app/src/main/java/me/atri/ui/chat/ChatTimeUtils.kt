package me.atri.ui.chat

import java.text.SimpleDateFormat
import java.time.Instant
import java.time.LocalDate
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
    val prefix = when (date) {
        today -> "今天"
        yesterday -> "昨天"
        else -> date.format(DateTimeFormatter.ofPattern("M月d日"))
    }
    val detail = date.format(DateTimeFormatter.ofPattern("M 月 d 日"))
    return "$prefix · $detail"
}
