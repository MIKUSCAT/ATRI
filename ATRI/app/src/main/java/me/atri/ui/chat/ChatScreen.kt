package me.atri.ui.chat

import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import coil.request.ImageRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import me.atri.data.db.entity.MessageEntity
import org.koin.androidx.compose.koinViewModel
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.TextStyle
import me.atri.utils.FileUtils.saveAtriAvatar
import java.util.Locale

@Composable
fun TimestampText(timestamp: Long) {
    val bubbleColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.85f)
    val textColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.9f)
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        contentAlignment = Alignment.Center
    ) {
        Surface(
            shape = RoundedCornerShape(12.dp),
            color = bubbleColor,
            tonalElevation = 0.dp
        ) {
            Text(
                text = formatMessageTime(timestamp),
                style = MaterialTheme.typography.labelMedium,
                color = textColor,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp)
            )
        }
    }
}

@Composable
private fun DateHeader(label: String) {
    val bubbleColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.9f)
    val textColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.9f)
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp),
        contentAlignment = Alignment.Center
    ) {
        Surface(
            shape = RoundedCornerShape(12.dp),
            color = bubbleColor,
            tonalElevation = 0.dp
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium,
                color = textColor,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp)
            )
        }
    }
}

// 计算某个日期分组内最后一条消息在列表中的位置
private fun ChatDateSection.lastMessageIndex(): Int = firstIndex + count

private data class SelectedMessageState(
    val message: MessageEntity,
    val anchorBounds: Rect?
)

@Composable
private fun DrawerHeader(
    avatarPath: String,
    welcomeState: ChatViewModel.WelcomeUiState,
    onChangeAvatar: () -> Unit,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val avatarRequest = remember(avatarPath, context) {
        ImageRequest.Builder(context)
            .data(avatarPath.takeIf { it.isNotBlank() })
            .setParameter("refresh", System.currentTimeMillis(), memoryCacheKey = null)
            .crossfade(true)
            .build()
    }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 4.dp),
            horizontalArrangement = Arrangement.Start,
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(
                onClick = onBack,
                modifier = Modifier
                    .size(40.dp)
                    .background(
                        MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.7f),
                        CircleShape
                    )
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "返回",
                    tint = MaterialTheme.colorScheme.onSurface
                )
            }
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = "返回",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        Box(
            modifier = Modifier.size(112.dp),
            contentAlignment = Alignment.Center
        ) {
            val avatarSize = 96.dp
            if (avatarPath.isNotBlank()) {
                AsyncImage(
                    model = avatarRequest,
                    contentDescription = "ATRI 头像",
                    modifier = Modifier
                        .size(avatarSize)
                        .clip(CircleShape),
                    contentScale = ContentScale.Crop
                )
            } else {
                Box(
                    modifier = Modifier
                        .size(avatarSize)
                        .clip(CircleShape)
                        .background(
                            Brush.linearGradient(
                                colors = listOf(Color(0xFF74C5FF), Color(0xFFF8BBD0))
                            )
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "ATRI",
                        style = MaterialTheme.typography.titleMedium,
                        color = Color.White
                    )
                }
            }
            Surface(
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .offset(x = 10.dp, y = 10.dp),
                shape = CircleShape,
                color = MaterialTheme.colorScheme.surface,
                tonalElevation = 4.dp,
                shadowElevation = 8.dp
            ) {
                IconButton(
                    onClick = onChangeAvatar,
                    modifier = Modifier.size(34.dp)
                ) {
                    Icon(Icons.Outlined.Edit, contentDescription = "更换头像", tint = MaterialTheme.colorScheme.primary)
                }
            }
        }
        Text(text = "ATRI", style = MaterialTheme.typography.titleLarge)
        Text(
            text = welcomeState.greeting.ifBlank { buildTimeGreeting() },
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center
        )
    }
}

@Composable
private fun DrawerAction(text: String, onClick: () -> Unit) {
    TextButton(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
    ) {
        Text(text = text, style = MaterialTheme.typography.titleSmall)
    }
}

@Composable
private fun DrawerDateHeader(totalDays: Int) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.Outlined.CalendarMonth,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary
            )
            Text(
                text = "按日期浏览",
                style = MaterialTheme.typography.titleMedium
            )
        }
        Text(
            text = if (totalDays > 0) "$totalDays 天" else "暂无记录",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
private fun DrawerDateBrowser(
    sections: List<ChatDateSection>,
    modifier: Modifier = Modifier,
    onSelect: (ChatDateSection) -> Unit
) {
    val zoneId = remember { ZoneId.systemDefault() }
    val today = remember(zoneId) { LocalDate.now(zoneId) }
    if (sections.isEmpty()) {
        Box(
            modifier = modifier.fillMaxWidth(),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = "还没有聊天记录，先来和 ATRI 聊聊吧。",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )
        }
    } else {
        LazyColumn(
            modifier = modifier.fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            items(sections, key = { it.date }) { section ->
                DateSectionCard(
                    section = section,
                    today = today
                ) {
                    onSelect(section)
                }
            }
        }
    }
}

@Composable
private fun DateSectionCard(
    section: ChatDateSection,
    today: LocalDate,
    onClick: () -> Unit
) {
    val yesterday = remember(today) { today.minusDays(1) }
    val background = when (section.date) {
        today -> MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)
        yesterday -> MaterialTheme.colorScheme.secondary.copy(alpha = 0.12f)
        else -> MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)
    }
    val weekday = section.date.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.getDefault())

    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        color = background,
        tonalElevation = if (section.date == today) 2.dp else 0.dp,
        onClick = onClick
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 18.dp, vertical = 14.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Text(
                    text = section.label,
                    style = MaterialTheme.typography.titleMedium
                )
                Text(
                    text = weekday,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Surface(
                shape = RoundedCornerShape(50),
                color = MaterialTheme.colorScheme.surface.copy(alpha = 0.9f)
            ) {
                Text(
                    text = "共 ${section.count} 条",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                )
            }
        }
    }
}

@Composable
fun ChatScreen(
    viewModel: ChatViewModel = koinViewModel(),
    onOpenSettings: () -> Unit = {},
    onOpenDiary: () -> Unit = {},
    welcomeDismissed: Boolean = false,
    onDismissWelcome: () -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val welcomeState by viewModel.welcomeUiState.collectAsStateWithLifecycle()
    val atriAvatarPath by viewModel.atriAvatarPath.collectAsStateWithLifecycle()
    val listState = rememberLazyListState()
    var selectedMessage by remember { mutableStateOf<SelectedMessageState?>(null) }
    var listBounds by remember { mutableStateOf<Rect?>(null) }
    var inputBarHeight by remember { mutableStateOf(0.dp) }
    var lastImePadding by remember { mutableStateOf(0.dp) }
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val density = LocalDensity.current
    var pendingScrollIndex by rememberSaveable { mutableStateOf<Int?>(null) }
    val showWelcome = !welcomeDismissed
    val avatarPickerScope = rememberCoroutineScope()
    val avatarPickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        if (uri != null) {
            avatarPickerScope.launch {
                val saved = withContext(Dispatchers.IO) { context.saveAtriAvatar(uri) }
                if (!saved.isNullOrBlank()) {
                    viewModel.updateAtriAvatar(saved)
                }
            }
        }
    }

    val imeBottomPadding = WindowInsets.ime.asPaddingValues().calculateBottomPadding()
    val navigationBarPadding = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    val isImeVisible = imeBottomPadding > 0.dp
    val inputBarBottomSpacing = 8.dp
    val baseBottomPadding = inputBarHeight + inputBarBottomSpacing + navigationBarPadding
    val listBottomPadding = if (isImeVisible) {
        imeBottomPadding + baseBottomPadding
    } else {
        baseBottomPadding
    }

    BackHandler(enabled = drawerState.isOpen) {
        scope.launch { drawerState.close() }
    }

    LaunchedEffect(uiState.displayItems.size, showWelcome, listBottomPadding) {
        if (uiState.displayItems.isNotEmpty() && !showWelcome && pendingScrollIndex == null) {
            // 返回时使用无动画滚动，确保最后一条消息完整可见
            val lastIndex = uiState.displayItems.lastIndex
            listState.scrollToItem(lastIndex)
            withFrameNanos { }
            val layoutInfo = listState.layoutInfo
            val lastItem = layoutInfo.visibleItemsInfo.lastOrNull { it.index == lastIndex }
            if (lastItem != null) {
                val visibleBottom = layoutInfo.viewportEndOffset -
                    with(density) { listBottomPadding.toPx() }
                val overflow = lastItem.offset + lastItem.size - visibleBottom
                if (overflow > 0) {
                    listState.scrollBy(overflow.toFloat())
                }
            }
        }
    }

    LaunchedEffect(pendingScrollIndex, showWelcome, uiState.displayItems.size) {
        val target = pendingScrollIndex
        if (!showWelcome && target != null && uiState.displayItems.isNotEmpty()) {
            val bounded = target.coerceIn(0, uiState.displayItems.lastIndex)
            listState.scrollToItem(bounded)
            pendingScrollIndex = null
        }
    }

    LaunchedEffect(imeBottomPadding, showWelcome, uiState.displayItems.size) {
        if (showWelcome || uiState.displayItems.isEmpty()) {
            lastImePadding = imeBottomPadding
            return@LaunchedEffect
        }
        val delta = imeBottomPadding - lastImePadding
        if (delta > 0.dp) {
            listState.scrollBy(with(density) { delta.toPx() })
        }
        lastImePadding = imeBottomPadding
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            ModalDrawerSheet(
                drawerContainerColor = MaterialTheme.colorScheme.surface,
                drawerTonalElevation = 3.dp
            ) {
                Column(
                    modifier = Modifier.fillMaxSize()
                ) {
                    DrawerHeader(
                        avatarPath = atriAvatarPath,
                        welcomeState = welcomeState,
                        onChangeAvatar = { avatarPickerLauncher.launch("image/*") },
                        onBack = {
                            scope.launch { drawerState.close() }
                        }
                    )
                    HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))
                    DrawerDateHeader(totalDays = uiState.dateSections.size)
                    DrawerDateBrowser(
                        sections = uiState.dateSections,
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f),
                        onSelect = { section ->
                            scope.launch {
                                drawerState.close()
                                if (uiState.displayItems.isNotEmpty()) {
                                    val target = section
                                        .lastMessageIndex()
                                        .coerceAtMost(uiState.displayItems.lastIndex)
                                    listState.animateScrollToItem(target)
                                }
                            }
                        }
                    )
                    HorizontalDivider(modifier = Modifier.padding(top = 8.dp))
                    DrawerAction(text = "前往设置") {
                        scope.launch { drawerState.close() }
                        onOpenSettings()
                    }
                }
            }
        }
    ) {
        Scaffold(
            topBar = {
                if (!showWelcome) {
                    ChatTopBar(
                        status = uiState.currentStatus,
                        currentDateLabel = uiState.currentDateLabel,
                        onOpenDrawer = { scope.launch { drawerState.open() } },
                        onOpenDiary = onOpenDiary
                    )
                }
            }
        ) { paddingValues ->
            // 全屏左右滑动：左滑进入日记，右滑打开抽屉
            var swipeOffset by remember { mutableStateOf(0f) }
            val swipeThreshold = 60f   // 滑动阈值（像素）

            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues)
                    .pointerInput(showWelcome, drawerState.isOpen) {
                        // 只在非欢迎界面且抽屉关闭时检测左右滑
                        if (!showWelcome && !drawerState.isOpen) {
                            detectHorizontalDragGestures(
                                onDragStart = {
                                    swipeOffset = 0f
                                },
                                onDragEnd = {
                                    if (swipeOffset < -swipeThreshold) {
                                        onOpenDiary()
                                    } else if (swipeOffset > swipeThreshold) {
                                        scope.launch { drawerState.open() }
                                    }
                                    swipeOffset = 0f
                                },
                                onDragCancel = { swipeOffset = 0f },
                                onHorizontalDrag = { _, dragAmount ->
                                    swipeOffset += dragAmount
                                }
                            )
                        }
                    }
            ) {
                if (showWelcome) {
                    DailyWelcome(
                        state = welcomeState,
                        avatarPath = atriAvatarPath,
                        sessions = uiState.dateSections,
                        onStartChat = {
                            pendingScrollIndex = uiState.displayItems.lastIndex.takeIf { it >= 0 }
                            onDismissWelcome()
                        },
                        onSelectSession = { section ->
                            pendingScrollIndex = section.lastMessageIndex()
                            onDismissWelcome()
                        }
                    )
                } else {
                    LazyColumn(
                        state = listState,
                        modifier = Modifier
                            .fillMaxSize()
                            .onGloballyPositioned { listBounds = it.boundsInRoot() },
                        contentPadding = PaddingValues(
                            start = 16.dp,
                            end = 16.dp,
                            top = 16.dp,
                            bottom = listBottomPadding  // 键盘抬起时预留输入框+键盘高度，收起时保留输入框与底栏
                        ),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        itemsIndexed(
                            uiState.displayItems,
                            key = { _, item ->
                                when (item) {
                                    is ChatItem.MessageItem -> item.message.id
                                    is ChatItem.DateHeaderItem -> "date-${item.date}"
                                }
                            }
                        ) { _, item ->
                            when (item) {
                                is ChatItem.DateHeaderItem -> DateHeader(label = item.label)
                                is ChatItem.MessageItem -> {
                                    Column {
                                        if (item.showTimestamp) {
                                            TimestampText(timestamp = item.message.timestamp)
                                        }
                                        MessageBubble(
                                            message = item.message,
                                            onLongPress = { pressed ->
                                                val anchor = listBounds?.let { bounds ->
                                                    val info = listState.layoutInfo.visibleItemsInfo
                                                        .firstOrNull { it.key == item.message.id }
                                                    info?.let {
                                                        Rect(
                                                            left = bounds.left,
                                                            top = bounds.top + it.offset,
                                                            right = bounds.right,
                                                            bottom = bounds.top + it.offset + it.size
                                                        )
                                                    }
                                                }
                                                selectedMessage = SelectedMessageState(pressed, anchor)
                                            },
                                            onVersionSwitch = { messageId, versionIndex ->
                                                viewModel.switchMessageVersion(messageId, versionIndex)
                                            }
                                        )
                                    }
                                }
                            }
                        }
                        if (uiState.isLoading) {
                            item { TypingIndicator() }
                        }
                    }
                }

                // 悬浮输入框 - 叠加在内容上方
                if (!showWelcome) {
                    Box(
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .fillMaxWidth()
                            .background(
                                Brush.verticalGradient(
                                    colors = listOf(
                                        Color.Transparent,
                                        MaterialTheme.colorScheme.background.copy(alpha = 0.8f),
                                        MaterialTheme.colorScheme.background
                                    ),
                                    startY = 0f,
                                    endY = 150f
                                )
                            )
                            .imePadding()
                            .navigationBarsPadding()
                            .padding(bottom = 8.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .onGloballyPositioned { coordinates ->
                                    val height = with(density) { coordinates.size.height.toDp() }
                                    if (height != inputBarHeight) {
                                        inputBarHeight = height
                                    }
                                }
                        ) {
                            InputBar(
                                enabled = !uiState.isLoading,
                                isProcessing = uiState.isLoading,
                                reference = uiState.referencedMessage,
                                onClearReference = { viewModel.clearReferencedAttachments() },
                                onToggleReferenceAttachment = { url -> viewModel.toggleReferencedAttachment(url) },
                                onCancelProcessing = { viewModel.cancelSending() },
                                onSendMessage = { content, attachments -> viewModel.sendMessage(content, attachments) }
                            )
                        }
                    }
                }

                uiState.error?.let { error ->
                    AtriErrorBanner(
                        message = error,
                        onDismiss = { viewModel.clearError() },
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .padding(16.dp)
                    )
                }
            }
        }
    }

    selectedMessage?.let { selection ->
        MessageActionOverlay(
            message = selection.message,
            anchorBounds = selection.anchorBounds,
            onDismiss = { selectedMessage = null },
            onEdit = { newContent ->
                viewModel.editMessage(selection.message, newContent)
                selectedMessage = null
            },
            onDelete = {
                viewModel.deleteMessage(selection.message.id)
                selectedMessage = null
            },
            onRegenerate = {
                viewModel.regenerateMessage(selection.message)
                selectedMessage = null
            },
            onReference = {
                viewModel.referenceAttachmentsFrom(selection.message)
                selectedMessage = null
            }
        )
    }

    if (uiState.showRegeneratePrompt) {
        AlertDialog(
            onDismissRequest = { viewModel.dismissRegeneratePrompt(false) },
            title = { Text("重新生成 ATRI 的回复？") },
            text = { Text("你编辑了消息，是否让 ATRI 重新回复？") },
            confirmButton = {
                TextButton(onClick = { viewModel.dismissRegeneratePrompt(true) }) { Text("重新生成") }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.dismissRegeneratePrompt(false) }) { Text("保持原样") }
            }
        )
    }

}

@Composable
private fun AtriErrorBanner(
    message: String,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.errorContainer,
        tonalElevation = 4.dp,
        shadowElevation = 6.dp
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "咦，ATRI 这边遇到点小问题~",
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.error
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = message,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onErrorContainer
                )
            }
            TextButton(onClick = onDismiss) {
                Text("好哦")
            }
        }
    }
}
