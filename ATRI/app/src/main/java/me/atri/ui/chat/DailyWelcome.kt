package me.atri.ui.chat

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Divider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import kotlinx.coroutines.delay

@Composable
fun DailyWelcome(
    state: ChatViewModel.WelcomeUiState,
    avatarPath: String,
    sessions: List<ChatDateSection>,
    onStartChat: () -> Unit,
    onSelectSession: (ChatDateSection) -> Unit
) {
    var startTypewriter by remember { mutableStateOf(false) }
    var displayedGreeting by remember { mutableStateOf("") }
    var isPressed by remember { mutableStateOf(false) }
    var showReveal by remember { mutableStateOf(false) }
    var buttonCenter by remember { mutableStateOf(Offset.Zero) }

    val greeting = if (state.greeting.isNotBlank()) state.greeting else "你好，我一直在等你出现。"

    LaunchedEffect(startTypewriter, greeting) {
        if (startTypewriter && greeting.isNotEmpty()) {
            displayedGreeting = ""
            greeting.forEachIndexed { index, _ ->
                delay(50)
                displayedGreeting = greeting.take(index + 1)
            }
        }
    }

    LaunchedEffect(state.isLoading) {
        if (!state.isLoading) {
            delay(200)
            startTypewriter = true
        }
    }

    val scale by animateFloatAsState(
        targetValue = if (isPressed) 0.96f else 1f,
        animationSpec = spring(dampingRatio = 0.6f),
        label = "buttonScale"
    )

    val revealRadius = remember { Animatable(0f) }

    LaunchedEffect(showReveal) {
        if (showReveal) {
            revealRadius.animateTo(
                targetValue = 3000f,
                animationSpec = tween(450, easing = FastOutSlowInEasing)
            )
            onStartChat()
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

                AtriHeroAvatar(avatarPath = avatarPath)

                Spacer(modifier = Modifier.height(32.dp))

                Text(
                    text = displayedGreeting,
                    style = MaterialTheme.typography.headlineMedium,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 16.dp)
                )

                Spacer(modifier = Modifier.height(56.dp))

                Box(
                    modifier = Modifier
                        .onGloballyPositioned { coordinates ->
                            val position = coordinates.positionInRoot()
                            val size = coordinates.size
                            buttonCenter = Offset(
                                position.x + size.width / 2f,
                                position.y + size.height / 2f
                            )
                        }
                ) {
                    Button(
                        onClick = {
                            isPressed = true
                            showReveal = true
                        },
                        modifier = Modifier
                            .width(220.dp)
                            .height(52.dp)
                            .scale(scale)
                            .pointerInput(Unit) {
                                detectTapGestures(
                                    onPress = {
                                        isPressed = true
                                        tryAwaitRelease()
                                        isPressed = false
                                    }
                                )
                            },
                        shape = MaterialTheme.shapes.extraLarge
                    ) {
                        Text("开始今天的对话")
                    }
                }

                Spacer(modifier = Modifier.weight(1f))
            }
        }

        if (showReveal && revealRadius.value > 0f) {
            androidx.compose.foundation.Canvas(modifier = Modifier.fillMaxSize()) {
                drawCircle(
                    color = Color(0xFF64B5F6),
                    radius = revealRadius.value,
                    center = buttonCenter
                )
            }
        }
    }
}

@Composable
fun DailyWelcomeLoading() {
    Surface(modifier = Modifier.fillMaxSize()) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding(),
            contentAlignment = Alignment.Center
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                CircularProgressIndicator()
                Text(
                    text = "正在准备欢迎语...",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center
                )
            }
        }
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
            Divider()
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

@Composable
private fun AtriHeroAvatar(avatarPath: String) {
    val context = LocalContext.current
    val avatarRequest = remember(avatarPath, context) {
        ImageRequest.Builder(context)
            .data(avatarPath.takeIf { it.isNotBlank() })
            .setParameter("refresh", System.currentTimeMillis(), memoryCacheKey = null)
            .crossfade(true)
            .build()
    }

    Box(
        modifier = Modifier.size(200.dp),
        contentAlignment = Alignment.Center
    ) {
        Box(
            modifier = Modifier
                .size(220.dp)
                .background(
                    brush = Brush.radialGradient(
                        colors = listOf(
                            MaterialTheme.colorScheme.primary.copy(alpha = 0.12f),
                            Color.Transparent
                        )
                    ),
                    shape = CircleShape
                )
        )

        if (avatarPath.isNotBlank()) {
            AsyncImage(
                model = avatarRequest,
                contentDescription = "ATRI 头像",
                modifier = Modifier
                    .size(180.dp)
                    .clip(CircleShape),
                contentScale = ContentScale.Crop
            )
        } else {
            Box(
                modifier = Modifier
                    .size(180.dp)
                    .clip(CircleShape)
                    .background(
                        brush = Brush.linearGradient(
                            colors = listOf(Color(0xFF99CCF2), Color(0xFFFCE4EC))
                        )
                    ),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "ATRI",
                    style = MaterialTheme.typography.headlineMedium,
                    color = Color.White
                )
            }
        }
    }
}
