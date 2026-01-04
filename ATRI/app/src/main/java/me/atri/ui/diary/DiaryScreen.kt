package me.atri.ui.diary

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import me.atri.data.api.response.DiaryEntryDto
import org.koin.androidx.compose.koinViewModel
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

// 金黄色装饰条
private val DiaryAccentColor = Color(0xFFFFB300)

@Composable
fun DiaryScreen(
    onNavigateBack: () -> Unit,
    viewModel: DiaryViewModel = koinViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    var swipeOffset by remember { mutableStateOf(0f) }
    val swipeThreshold = 60f

    BackHandler(enabled = uiState.selectedEntry != null) {
        viewModel.closeDiary()
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .pointerInput(uiState.selectedEntry) {
                detectHorizontalDragGestures(
                    onDragStart = { swipeOffset = 0f },
                    onDragEnd = {
                        if (swipeOffset > swipeThreshold) {
                            if (uiState.selectedEntry != null) {
                                viewModel.closeDiary()
                            } else {
                                onNavigateBack()
                            }
                        }
                        swipeOffset = 0f
                    },
                    onDragCancel = { swipeOffset = 0f },
                    onHorizontalDrag = { _, dragAmount ->
                        swipeOffset += dragAmount
                    }
                )
            }
    ) {
        AnimatedContent(
            targetState = uiState.selectedEntry?.date,
            transitionSpec = {
                if (targetState != null) {
                    (slideInHorizontally { it } + fadeIn()) togetherWith
                            (slideOutHorizontally { -it / 3 } + fadeOut())
                } else {
                    (slideInHorizontally { -it / 3 } + fadeIn()) togetherWith
                            (slideOutHorizontally { it } + fadeOut())
                }
            },
            label = "diary_transition"
        ) { selectedDate ->
            if (selectedDate != null) {
                val selectedEntry = uiState.selectedEntry
                    ?: uiState.entries.firstOrNull { it.date == selectedDate }
                if (selectedEntry != null) {
                    DiaryDetailScreen(
                        entry = selectedEntry,
                        errorMessage = uiState.error,
                        isRegenerating = uiState.isRegeneratingEntry,
                        onRegenerate = { viewModel.regenerateEntry(it) },
                        onNavigateBack = viewModel::closeDiary
                    )
                } else {
                    DiaryListScreen(
                        uiState = uiState,
                        onNavigateBack = onNavigateBack,
                        onRefresh = { viewModel.refresh() },
                        onOpenDiary = { viewModel.openDiary(it) }
                    )
                }
            } else {
                DiaryListScreen(
                    uiState = uiState,
                    onNavigateBack = onNavigateBack,
                    onRefresh = { viewModel.refresh() },
                    onOpenDiary = { viewModel.openDiary(it) }
                )
            }
        }
    }
}

@Composable
private fun DiaryListScreen(
    uiState: DiaryUiState,
    onNavigateBack: () -> Unit,
    onRefresh: () -> Unit,
    onOpenDiary: (DiaryEntryDto) -> Unit
) {
    Scaffold(
        topBar = {
            DiaryListTopBar(
                entryCount = uiState.entries.size,
                onNavigateBack = onNavigateBack,
                onRefresh = onRefresh
            )
        }
    ) { padding ->
        when {
            uiState.isLoading -> {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(padding),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    CircularProgressIndicator()
                    Spacer(modifier = Modifier.height(12.dp))
                    Text("日记正在整理中，请稍候")
                }
            }

            uiState.entries.isEmpty() -> {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(padding)
                        .padding(horizontal = 32.dp),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Box(
                        modifier = Modifier
                            .size(120.dp)
                            .clip(RoundedCornerShape(60.dp))
                            .background(
                                Brush.radialGradient(
                                    colors = listOf(
                                        MaterialTheme.colorScheme.primary.copy(alpha = 0.12f),
                                        MaterialTheme.colorScheme.primary.copy(alpha = 0.04f)
                                    )
                                )
                            ),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.Edit,
                            contentDescription = null,
                            modifier = Modifier.size(48.dp),
                            tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.6f)
                        )
                    }
                    Spacer(modifier = Modifier.height(24.dp))
                    Text(
                        text = "还没有日记",
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "和 ATRI 聊聊天吧，她会在每天结束时\n把今天的故事写进日记里",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                        lineHeight = MaterialTheme.typography.bodyMedium.lineHeight * 1.4
                    )
                }
            }

            else -> {
                LazyColumn(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(padding),
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp)
                ) {
                    items(uiState.entries, key = { it.id }) { entry ->
                        DiaryCard(entry = entry) { onOpenDiary(entry) }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DiaryListTopBar(
    entryCount: Int,
    onNavigateBack: () -> Unit,
    onRefresh: () -> Unit
) {
    TopAppBar(
        title = {
            Column {
                Text("日记本", style = MaterialTheme.typography.titleLarge)
                if (entryCount > 0) {
                    Text(
                        text = "${entryCount} 篇日记",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        },
        navigationIcon = {
            IconButton(onClick = onNavigateBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
            }
        },
        actions = {
            TextButton(onClick = onRefresh) {
                Text("刷新", style = MaterialTheme.typography.labelLarge)
            }
        }
    )
}

@Composable
private fun DiaryCard(
    entry: DiaryEntryDto,
    onClick: () -> Unit
) {
    val dateLabel = buildDiaryPreviewLabel(entry.date)
    val preview = entry.summary?.takeIf { it.isNotBlank() }
        ?: entry.content?.take(50)?.takeIf { it.isNotBlank() }
        ?: "点开看看这一天的记录"

    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 0.dp,
        shadowElevation = 0.dp,
        onClick = onClick
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalAlignment = Alignment.Top
        ) {
            // 金黄色装饰条
            Box(
                modifier = Modifier
                    .width(4.dp)
                    .height(48.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(DiaryAccentColor)
            )
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Text(
                    text = dateLabel,
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                    color = MaterialTheme.colorScheme.onSurface
                )
                Text(
                    text = preview,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DiaryDetailScreen(
    entry: DiaryEntryDto,
    errorMessage: String?,
    isRegenerating: Boolean,
    onRegenerate: (String) -> Unit,
    onNavigateBack: () -> Unit
) {
    val scrollState = rememberScrollState()
    val content = entry.content?.ifBlank { null } ?: "这一天还没有生成日记。"
    val wordCount = content.length
    var showRegenerateConfirm by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color.Transparent
                )
            )
        },
        containerColor = MaterialTheme.colorScheme.background
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(scrollState)
                .padding(horizontal = 24.dp)
        ) {
            Spacer(modifier = Modifier.height(8.dp))

            // 大标题 - 日期
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = buildDetailTitle(entry.date),
                    style = MaterialTheme.typography.headlineMedium.copy(
                        fontWeight = FontWeight.Bold,
                        fontSize = 26.sp
                    ),
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.weight(1f)
                )
                IconButton(
                    onClick = { showRegenerateConfirm = true },
                    enabled = !isRegenerating
                ) {
                    if (isRegenerating) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            strokeWidth = 2.dp
                        )
                    } else {
                        Icon(
                            imageVector = Icons.Outlined.Refresh,
                            contentDescription = "重新生成日记",
                            modifier = Modifier.size(20.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            // 元信息行
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = buildDetailDate(entry.date),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = "·",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = "共 $wordCount 字",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                entry.mood?.takeIf { it.isNotBlank() }?.let { mood ->
                    Text(
                        text = "·",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = mood,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            errorMessage?.takeIf { it.isNotBlank() }?.let { message ->
                Spacer(modifier = Modifier.height(10.dp))
                Text(
                    text = message,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error
                )
            }

            Spacer(modifier = Modifier.height(32.dp))

            // 正文内容 - 直接显示，无背景框
            Text(
                text = content,
                style = MaterialTheme.typography.bodyLarge.copy(
                    lineHeight = 28.sp
                ),
                color = MaterialTheme.colorScheme.onSurface
            )

            Spacer(modifier = Modifier.height(48.dp))
        }
    }

    if (showRegenerateConfirm) {
        AlertDialog(
            onDismissRequest = { showRegenerateConfirm = false },
            confirmButton = {
                TextButton(
                    onClick = {
                        showRegenerateConfirm = false
                        onRegenerate(entry.date)
                    },
                    enabled = !isRegenerating
                ) {
                    Text(if (isRegenerating) "生成中..." else "重新生成")
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { showRegenerateConfirm = false },
                    enabled = !isRegenerating
                ) {
                    Text("取消")
                }
            },
            title = { Text("重新生成日记") },
            text = { Text("会覆盖当前日记内容，并更新记忆向量，可能需要一点时间。") }
        )
    }
}

// 列表预览标签：2024年12月21日 · 周六
@Composable
private fun buildDiaryPreviewLabel(date: String): String {
    return runCatching {
        val parsed = LocalDate.parse(date)
        val weekday = parsed.dayOfWeek.getDisplayName(java.time.format.TextStyle.SHORT, Locale.CHINA)
        parsed.format(DateTimeFormatter.ofPattern("yyyy年M月d日")) + " · " + weekday
    }.getOrElse { date }
}

// 详情页大标题：12月21日
@Composable
private fun buildDetailTitle(date: String): String {
    return runCatching {
        val parsed = LocalDate.parse(date)
        parsed.format(DateTimeFormatter.ofPattern("M月d日"))
    }.getOrElse { date }
}

// 详情页元信息日期：12月21日 23:48（使用 createdAt 或默认时间）
@Composable
private fun buildDetailDate(date: String): String {
    return runCatching {
        val parsed = LocalDate.parse(date)
        val weekday = parsed.dayOfWeek.getDisplayName(java.time.format.TextStyle.FULL, Locale.CHINA)
        parsed.format(DateTimeFormatter.ofPattern("yyyy年M月d日")) + " " + weekday
    }.getOrElse { date }
}
