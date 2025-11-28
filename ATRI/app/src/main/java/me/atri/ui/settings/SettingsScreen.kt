package me.atri.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.KeyboardArrowUp
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.koin.androidx.compose.koinViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onNavigateBack: () -> Unit,
    viewModel: SettingsViewModel = koinViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val clipboard = LocalClipboardManager.current

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("设置") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, "返回")
                    }
                }
            )
        }
    ) { paddingValues ->
        var showClearConfirm by remember { mutableStateOf(false) }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            var apiUrl by remember { mutableStateOf(uiState.apiUrl) }
            var userName by remember { mutableStateOf(uiState.userName) }
            var modelName by remember { mutableStateOf(uiState.modelName) }
            var importUserId by remember { mutableStateOf("") }
            val availableModels = uiState.availableModels
            var modelsExpanded by remember { mutableStateOf(false) }

            LaunchedEffect(uiState.apiUrl) { apiUrl = uiState.apiUrl }
            LaunchedEffect(uiState.userName) { userName = uiState.userName }
            LaunchedEffect(uiState.modelName) { modelName = uiState.modelName }
            LaunchedEffect(uiState.userId) { importUserId = "" }

            Surface(
                shape = MaterialTheme.shapes.extraLarge,
                tonalElevation = 1.dp,
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 18.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text(
                        text = "连接配置",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.primary
                    )
                    OutlinedTextField(
                        value = apiUrl,
                        onValueChange = { apiUrl = it },
                        label = { Text("Worker URL") },
                        placeholder = { Text("https://your-worker.example.com") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
                    )
                    Button(
                        onClick = { viewModel.updateApiUrl(apiUrl) },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !uiState.isLoading
                    ) {
                        Text(if (uiState.isLoading) "保存中..." else "保存 Worker URL")
                    }
            ModelSelector(
                modelName = modelName,
                models = availableModels,
                expanded = modelsExpanded,
                modelsLoading = uiState.modelsLoading,
                onToggle = { modelsExpanded = it },
                onRefresh = { viewModel.refreshModelCatalog() },
                onSelect = {
                    modelName = it
                    modelsExpanded = false
                }
            )
                    Button(
                        onClick = { viewModel.updateModelName(modelName) },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !uiState.modelsLoading && modelName != uiState.modelName
                    ) { Text("保存模型") }
                }
            }

            Surface(
                shape = MaterialTheme.shapes.extraLarge,
                tonalElevation = 1.dp,
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 18.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text(
                        text = "个人信息",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.primary
                    )
                    OutlinedTextField(
                        value = userName,
                        onValueChange = { userName = it },
                        label = { Text("你的名字") },
                        placeholder = { Text("请输入你的名字") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
                    )
                    Button(
                        onClick = { viewModel.updateUserName(userName) },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("保存名字")
                    }
                    OutlinedTextField(
                        value = uiState.userId,
                        onValueChange = {},
                        label = { Text("当前账号 ID") },
                        modifier = Modifier.fillMaxWidth(),
                        readOnly = true,
                        trailingIcon = {
                            TextButton(onClick = {
                                clipboard.setText(AnnotatedString(uiState.userId))
                            }) {
                                Text("复制")
                            }
                        }
                    )
                    OutlinedTextField(
                        value = importUserId,
                        onValueChange = { importUserId = it },
                        label = { Text("导入旧账号 ID") },
                        placeholder = { Text("粘贴之前备份的 ID") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
                    )
                    Button(
                        onClick = { viewModel.importUserId(importUserId) },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = importUserId.isNotBlank()
                    ) {
                        Text("使用这个 ID")
                    }
                }
            }

            Surface(
                shape = MaterialTheme.shapes.extraLarge,
                tonalElevation = 1.dp,
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 18.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text(
                        text = "隐私与数据",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.primary
                    )
                    Text(
                        text = "如果想让 ATRI 完全忘记你，可以清空本地聊天、日记，并重新生成一个新的用户标识。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Button(
                        onClick = { showClearConfirm = true },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !uiState.isClearing
                    ) {
                        Text(if (uiState.isClearing) "清空中..." else "清空记忆与聊天")
                    }
                }
            }

            uiState.statusMessage?.let { message ->
                Text(
                    text = message,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.tertiary,
                    modifier = Modifier.padding(top = 4.dp)
                )
            }

            if (uiState.showModelSavedDialog) {
                AlertDialog(
                    onDismissRequest = { viewModel.dismissModelSavedDialog() },
                    confirmButton = {
                        TextButton(onClick = { viewModel.dismissModelSavedDialog() }) {
                            Text("好的")
                        }
                    },
                    title = { Text("模型已保存") },
                    text = { Text("已切换到新的推理模型。") }
                )
            }

            if (showClearConfirm) {
                AlertDialog(
                    onDismissRequest = {
                        showClearConfirm = false
                    },
                    confirmButton = {
                        TextButton(onClick = {
                            showClearConfirm = false
                            viewModel.clearMemories()
                        }) {
                            Text("确认清空")
                        }
                    },
                    dismissButton = {
                        TextButton(onClick = {
                            showClearConfirm = false
                        }) {
                            Text("再想想")
                        }
                    },
                    title = { Text("清空记忆数据") },
                    text = {
                        Text("此操作会删除本地所有聊天、日记，并让 ATRI 使用全新的身份，旧记忆将不再被引用。")
                    }
                )
            }
        }
    }
}

@Composable
private fun ModelSelector(
    modelName: String,
    models: List<SettingsUiState.ModelOption>,
    expanded: Boolean,
    modelsLoading: Boolean,
    onToggle: (Boolean) -> Unit,
    onRefresh: () -> Unit,
    onSelect: (String) -> Unit
) {
    val selectedModel = models.firstOrNull { it.id == modelName }
    val listScroll = rememberScrollState()

    LaunchedEffect(expanded, modelsLoading, models.size) {
        if (expanded && models.isEmpty() && !modelsLoading) {
            onRefresh()
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            OutlinedTextField(
                value = selectedModel?.id ?: modelName.ifBlank { "暂未选择" },
                onValueChange = {},
                readOnly = true,
                singleLine = true,
                label = { Text("模型设置") },
                modifier = Modifier.weight(1f),
                trailingIcon = {
                    IconButton(onClick = { onToggle(!expanded) }) {
                        Icon(
                            imageVector = if (expanded) Icons.Outlined.KeyboardArrowUp else Icons.Outlined.KeyboardArrowDown,
                            contentDescription = if (expanded) "收起模型列表" else "展开模型列表"
                        )
                    }
                }
            )
            IconButton(onClick = onRefresh, enabled = !modelsLoading) {
                Icon(
                    imageVector = Icons.Outlined.Refresh,
                    contentDescription = "刷新模型列表"
                )
            }
        }
        if (expanded) {
            if (modelsLoading && models.isEmpty()) {
                Text(
                    text = "正在获取模型列表...",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Surface(
                shape = RectangleShape,
                tonalElevation = 0.dp,
                border = androidx.compose.foundation.BorderStroke(
                    1.dp,
                    MaterialTheme.colorScheme.outline.copy(alpha = 0.6f)
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 280.dp)
            ) {
                Column(
                    verticalArrangement = Arrangement.spacedBy(0.dp),
                    modifier = Modifier.verticalScroll(listScroll)
                ) {
                    models.forEachIndexed { index, option ->
                        val isSelected = option.id == modelName
                        val bg = if (isSelected) {
                            MaterialTheme.colorScheme.primary.copy(alpha = 0.08f)
                        } else MaterialTheme.colorScheme.surface
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onSelect(option.id) }
                                .background(bg)
                                .padding(horizontal = 14.dp, vertical = 12.dp)
                        ) {
                            Text(
                                text = "· ${option.id}",
                                style = MaterialTheme.typography.bodyMedium
                            )
                        }
                        if (index != models.lastIndex) {
                            androidx.compose.material3.Divider()
                        }
                    }
                }
            }
        }
    }
}
