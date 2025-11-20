package me.atri.ui.sheet

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import me.atri.data.repository.StatusRepository
import me.atri.ui.components.IntimacyProgress
import me.atri.ui.components.ProfileAvatar
import org.koin.compose.koinInject

@Composable
fun StatusTab(
    repository: StatusRepository = koinInject()
) {
    val intimacyInfo by repository.observeIntimacyInfo().collectAsStateWithLifecycle(initialValue = null)
    var statistics by remember { mutableStateOf<Map<String, Any>>(emptyMap()) }

    LaunchedEffect(Unit) {
        statistics = repository.getStatistics()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(20.dp)
    ) {
        ProfileAvatar(size = 80.dp)

        Text(
            text = "当前状态: 在线",
            style = MaterialTheme.typography.titleMedium
        )

        Spacer(modifier = Modifier.height(4.dp))

        intimacyInfo?.let { info ->
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = "亲密度",
                    style = MaterialTheme.typography.titleLarge
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "Lv.${info.level} ${info.levelName}",
                    style = MaterialTheme.typography.titleMedium
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "${info.points} / ${info.nextLevelPoints}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(modifier = Modifier.height(8.dp))
                LinearProgressIndicator(
                    progress = info.progress,
                    modifier = Modifier
                        .fillMaxWidth(0.8f)
                        .height(8.dp)
                        .clip(androidx.compose.foundation.shape.RoundedCornerShape(4.dp))
                )
            }
        }

        Spacer(modifier = Modifier.height(4.dp))

        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(
                text = "关系数据",
                style = MaterialTheme.typography.titleMedium
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "认识时间  ${statistics["daysKnown"] ?: 0} 天",
                style = MaterialTheme.typography.bodyMedium
            )
            Text(
                text = "对话次数  ${statistics["totalMessages"] ?: 0} 次",
                style = MaterialTheme.typography.bodyMedium
            )
            Text(
                text = "今日对话  ${statistics["todayMessages"] ?: 0} 次",
                style = MaterialTheme.typography.bodyMedium
            )
            Text(
                text = "重要记忆  ${statistics["importantMemories"] ?: 0} 条",
                style = MaterialTheme.typography.bodyMedium
            )
        }
    }
}
