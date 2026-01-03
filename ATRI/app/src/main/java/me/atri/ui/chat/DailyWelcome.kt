package me.atri.ui.chat

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import me.atri.ui.components.AtriAvatar
import me.atri.ui.components.CircleRevealOverlay
import me.atri.ui.components.TypewriterText
import me.atri.ui.components.rememberCircleRevealState

@Composable
fun DailyWelcome(
    state: ChatViewModel.WelcomeUiState,
    avatarPath: String,
    sessions: List<ChatDateSection>,
    onStartChat: () -> Unit,
    onSelectSession: (ChatDateSection) -> Unit
) {
    var startTypewriter by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val revealState = rememberCircleRevealState()

    // 只在 isLoading 变为 false 时捕获 greeting，避免中途变化导致跳动
    var capturedGreeting by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(state.isLoading) {
        if (!state.isLoading) {
            // 捕获最终的 greeting
            capturedGreeting = state.greeting.ifBlank { "你好，我一直在等你出现。" }
            delay(100)
            startTypewriter = true
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Surface(modifier = Modifier.fillMaxSize()) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .statusBarsPadding()
                    .padding(horizontal = 32.dp)
                    .padding(top = 24.dp, bottom = 32.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Spacer(modifier = Modifier.height(32.dp))

                AtriAvatar(
                    avatarPath = avatarPath,
                    size = 180.dp,
                    showGlow = true
                )

                Spacer(modifier = Modifier.height(32.dp))

                // 加载时显示加载指示，加载完成后显示问候语
                if (capturedGreeting == null) {
                    CircularProgressIndicator(
                        modifier = Modifier.padding(vertical = 16.dp),
                        strokeWidth = 2.dp
                    )
                } else {
                    TypewriterText(
                        text = capturedGreeting!!,
                        enabled = startTypewriter
                    ) { displayedText ->
                        Text(
                            text = displayedText,
                            style = MaterialTheme.typography.headlineMedium,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(horizontal = 16.dp)
                        )
                    }
                }

                Spacer(modifier = Modifier.height(56.dp))

                Box(
                    modifier = Modifier.onGloballyPositioned { coordinates ->
                        val position = coordinates.positionInRoot()
                        val size = coordinates.size
                        revealState.centerOffset = Offset(
                            position.x + size.width / 2f,
                            position.y + size.height / 2f
                        )
                    }
                ) {
                    Button(
                        onClick = {
                            scope.launch {
                                revealState.reveal { onStartChat() }
                            }
                        },
                        modifier = Modifier
                            .width(220.dp)
                            .height(52.dp),
                        shape = MaterialTheme.shapes.extraLarge,
                        enabled = capturedGreeting != null
                    ) {
                        Text("开始今天的对话")
                    }
                }

                Spacer(modifier = Modifier.weight(1f))
            }
        }

        CircleRevealOverlay(state = revealState)
    }
}

@Composable
private fun DiaryNotebook(
    sessions: List<ChatDateSection>,
    onSelectSession: (ChatDateSection) -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(32.dp),
        tonalElevation = 6.dp,
        border = BorderStroke(
            width = 1.dp,
            color = MaterialTheme.colorScheme.outline.copy(alpha = 0.12f)
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp, vertical = 18.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Edit,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary
                    )
                    Text(
                        text = "对话日记",
                        style = MaterialTheme.typography.titleMedium
                    )
                }
                Text(
                    text = "挑选想继续的日期",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            HorizontalDivider()
            SessionList(
                sessions = sessions,
                onSelectSession = onSelectSession,
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f, fill = true)
            )
        }
    }
}

@Composable
private fun SessionList(
    sessions: List<ChatDateSection>,
    onSelectSession: (ChatDateSection) -> Unit,
    modifier: Modifier = Modifier
) {
    if (sessions.isEmpty()) {
        Box(
            modifier = modifier.fillMaxWidth(),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = "还没有任何对话记录，先和 ATRI 开启第一天吧。",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )
        }
    } else {
        LazyColumn(
            modifier = modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            items(sessions, key = { it.date }) { section ->
                SessionCard(section = section) {
                    onSelectSession(section)
                }
            }
        }
    }
}

@Composable
private fun SessionCard(
    section: ChatDateSection,
    onClick: () -> Unit
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(22.dp),
        color = MaterialTheme.colorScheme.primary.copy(alpha = 0.05f),
        tonalElevation = 0.dp,
        onClick = onClick
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 14.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Box(
                    modifier = Modifier
                        .width(4.dp)
                        .height(44.dp)
                        .background(
                            brush = Brush.verticalGradient(
                                colors = listOf(
                                    MaterialTheme.colorScheme.primary.copy(alpha = 0.4f),
                                    MaterialTheme.colorScheme.primary
                                )
                            ),
                            shape = RoundedCornerShape(2.dp)
                        )
                )
                Column {
                    Text(
                        text = section.label,
                        style = MaterialTheme.typography.titleMedium
                    )
                    Text(
                        text = "共 ${section.count} 条消息",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            Text(
                text = "进入",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary
            )
        }
    }
}
