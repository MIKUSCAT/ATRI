package me.atri.ui.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.AnnotatedString
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.koin.androidx.compose.koinViewModel

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
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

            LaunchedEffect(uiState.apiUrl) { apiUrl = uiState.apiUrl }
            LaunchedEffect(uiState.userName) { userName = uiState.userName }
            LaunchedEffect(uiState.modelName) { modelName = uiState.modelName }
            LaunchedEffect(uiState.userId) { importUserId = "" }

            Text(
                text = "API 配置",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.primary
            )

            OutlinedTextField(
                value = apiUrl,
                onValueChange = { apiUrl = it },
                label = { Text("Worker URL") },
                placeholder = { Text("https://atri-worker.2441248911.workers.dev") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )

            Button(
                onClick = {
                    viewModel.updateApiUrl(apiUrl)
                },
                modifier = Modifier.fillMaxWidth(),
                enabled = !uiState.isLoading
            ) {
                Text(if (uiState.isLoading) "保存中..." else "保存 Worker URL")
            }

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

            Text(
                text = "账号 ID",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.primary
            )

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

            Text(
                text = "模型选择",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.primary
            )

            val selectedModel = availableModels.firstOrNull { it.id == modelName }

            OutlinedTextField(
                value = modelName,
                onValueChange = { modelName = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("推理模型 ID") },
                placeholder = { Text("例如：gpt-4o-mini") },
                singleLine = true,
                supportingText = {
                    when {
                        uiState.modelsLoading -> Text("正在向 Worker 请求可用模型...")
                        selectedModel != null -> Text("当前选择：${selectedModel.label}")
                        availableModels.isNotEmpty() -> Text("点按下方卡片可快速切换")
                        else -> Text("暂时无法获取模型列表，可直接输入 ID")
                    }
                }
            )

            if (availableModels.isNotEmpty()) {
                LazyRow(
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    items(availableModels) { option ->
                        ElevatedCard(
                            modifier = Modifier
                                .width(220.dp)
                                .clickable { modelName = option.id }
                        ) {
                            Column(
                                modifier = Modifier
                                    .padding(vertical = 16.dp, horizontal = 12.dp),
                                verticalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                Text(
                                    option.label,
                                    style = MaterialTheme.typography.titleMedium,
                                    color = if (option.id == modelName)
                                        MaterialTheme.colorScheme.primary
                                    else MaterialTheme.colorScheme.onSurface
                                )
                                Text(
                                    option.id,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                option.provider?.let {
                                    Text(
                                        it,
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.tertiary
                                    )
                                }
                            }
                        }
                    }
                }
            }

            TextButton(
                onClick = { viewModel.refreshModelCatalog() },
                enabled = !uiState.modelsLoading
            ) {
                Text(if (uiState.modelsLoading) "模型获取中..." else "重新获取模型列表")
            }

            Button(
                onClick = { viewModel.updateModelName(modelName) },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("保存模型")
            }

            HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))

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
