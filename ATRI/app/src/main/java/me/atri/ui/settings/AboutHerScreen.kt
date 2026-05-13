package me.atri.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import me.atri.data.api.response.SelfModelResponse
import org.koin.androidx.compose.koinViewModel
import java.util.concurrent.TimeUnit

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AboutHerScreen(
    onNavigateBack: () -> Unit,
    viewModel: AboutHerViewModel = koinViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("关于她") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, "返回")
                    }
                }
            )
        }
    ) { paddingValues ->
        when {
            uiState.isLoading -> {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(paddingValues),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            }
            uiState.errorMessage != null -> {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(paddingValues)
                        .padding(32.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        Text(
                            text = uiState.errorMessage ?: "她现在不想被人看…",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Text(
                            text = "可能是网络也可能是她在赌气，过一会再来看看吧。",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Button(onClick = { viewModel.load() }) {
                            Text("再试一次")
                        }
                    }
                }
            }
            uiState.data != null -> {
                AboutHerContent(
                    data = uiState.data!!,
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(paddingValues)
                )
            }
        }
    }
}

@Composable
private fun AboutHerContent(
    data: SelfModelResponse,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        AboutHerCard(title = "她是这样的") {
            BulletList(items = data.coreTraits.orEmpty(), emptyHint = "她还在慢慢长出自己的样子。")
        }

        AboutHerCard(title = "她的说话方式") {
            BulletList(items = data.speechStyle.orEmpty(), emptyHint = "她还没找到固定的腔调。")
        }

        AboutHerCard(title = "她和你的距离") {
            ParagraphText(text = data.relationshipStance, emptyHint = "她还在打量这段关系。")
        }

        AboutHerCard(title = "她的情绪底色") {
            ParagraphText(text = data.emotionalBaseline, emptyHint = "她现在情绪还很平稳。")
        }

        AboutHerCard(title = "最近她在变的") {
            BulletList(items = data.recentChanges.orEmpty(), emptyHint = "还没变化呢，刚出生不久。")
        }

        AboutHerCard(title = "她不喜欢的话") {
            BulletList(
                items = data.taboos.orEmpty(),
                emptyHint = "暂时没什么特别忌讳的。",
                tone = BulletTone.Muted
            )
        }

        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = "最近一次更新：${formatRelativeTime(data.updatedAt)}",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 4.dp)
        )
    }
}

@Composable
private fun AboutHerCard(
    title: String,
    content: @Composable ColumnScope.() -> Unit
) {
    Surface(
        shape = MaterialTheme.shapes.extraLarge,
        tonalElevation = 1.dp,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 18.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.primary
            )
            content()
        }
    }
}

private enum class BulletTone { Default, Muted }

@Composable
private fun BulletList(
    items: List<String>,
    emptyHint: String,
    tone: BulletTone = BulletTone.Default
) {
    val cleaned = items.map { it.trim() }.filter { it.isNotEmpty() }
    if (cleaned.isEmpty()) {
        Text(
            text = emptyHint,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        return
    }
    val textColor = when (tone) {
        BulletTone.Default -> MaterialTheme.colorScheme.onSurface
        BulletTone.Muted -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    val dotColor = when (tone) {
        BulletTone.Default -> MaterialTheme.colorScheme.primary
        BulletTone.Muted -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        cleaned.forEach { line ->
            Row(verticalAlignment = Alignment.Top) {
                Box(
                    modifier = Modifier
                        .padding(top = 8.dp)
                        .size(6.dp)
                        .clip(CircleShape)
                        .background(dotColor)
                )
                Spacer(modifier = Modifier.size(10.dp))
                Text(
                    text = line,
                    style = MaterialTheme.typography.bodyMedium,
                    color = textColor,
                    fontWeight = FontWeight.Normal
                )
            }
        }
    }
}

@Composable
private fun ParagraphText(text: String?, emptyHint: String) {
    val cleaned = text?.trim().orEmpty()
    if (cleaned.isEmpty()) {
        Text(
            text = emptyHint,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    } else {
        Text(
            text = cleaned,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface
        )
    }
}

/**
 * 把毫秒时间戳格式化为“刚刚 / N 分钟前 / N 小时前 / N 天前”等相对时间。
 */
private fun formatRelativeTime(updatedAt: Long?): String {
    if (updatedAt == null || updatedAt <= 0L) return "未知"
    val deltaMs = System.currentTimeMillis() - updatedAt
    if (deltaMs < 0) return "刚刚"
    val minutes = TimeUnit.MILLISECONDS.toMinutes(deltaMs)
    if (minutes < 1) return "刚刚"
    if (minutes < 60) return "${minutes} 分钟前"
    val hours = TimeUnit.MILLISECONDS.toHours(deltaMs)
    if (hours < 24) return "${hours} 小时前"
    val days = TimeUnit.MILLISECONDS.toDays(deltaMs)
    if (days < 30) return "${days} 天前"
    val months = days / 30
    if (months < 12) return "${months} 个月前"
    val years = days / 365
    return "${years} 年前"
}
