package me.atri.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
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
    var showClearConfirm by remember { mutableStateOf(false) }

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
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            var apiUrl by rememberSaveable { mutableStateOf("") }
            var userName by rememberSaveable { mutableStateOf("") }
            var appToken by rememberSaveable { mutableStateOf("") }
            var importUserId by remember { mutableStateOf("") }
            var initialized by rememberSaveable { mutableStateOf(false) }

            LaunchedEffect(uiState.apiUrl, uiState.userName, uiState.appToken) {
                if (!initialized && uiState.apiUrl.isNotEmpty()) {
                    apiUrl = uiState.apiUrl
                    userName = uiState.userName
                    appToken = uiState.appToken
                    initialized = true
                }
            }

            SettingsCard(title = "连接配置") {
                OutlinedTextField(
                    value = apiUrl,
                    onValueChange = { apiUrl = it },
                    label = { Text("API 地址") },
                    placeholder = { Text("https://your-server.example.com") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )
                Button(
                    onClick = { viewModel.updateApiUrl(apiUrl) },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !uiState.isLoading
                ) {
                    Text(if (uiState.isLoading) "保存中..." else "保存 API 地址")
                }
                OutlinedTextField(
                    value = appToken,
                    onValueChange = { appToken = it },
                    label = { Text("鉴权 Token (X-App-Token)") },
                    placeholder = { Text("填入与你的 API 配置一致的 Token") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )
                Button(
                    onClick = { viewModel.updateAppToken(appToken) },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = appToken.isNotBlank()
                ) {
                    Text("保存 Token")
                }
            }

            SettingsCard(title = "个人信息") {
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
                    label = { Text("当前 UID") },
                    modifier = Modifier.fillMaxWidth(),
                    readOnly = true,
                    trailingIcon = {
                        TextButton(onClick = { clipboard.setText(AnnotatedString(uiState.userId)) }) {
                            Text("复制")
                        }
                    }
                )
                OutlinedTextField(
                    value = importUserId,
                    onValueChange = { importUserId = it },
                    label = { Text("导入旧 UID") },
                    placeholder = { Text("粘贴之前备份的 UID") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )
                Button(
                    onClick = { viewModel.importUserId(importUserId) },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = importUserId.isNotBlank()
                ) {
                    Text("使用这个 UID")
                }
            }

            SettingsCard(title = "数据同步") {
                Text(
                    text = "从服务器拉取最近 30 天的聊天记录到本地，可在侧边栏按日期浏览。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Button(
                    onClick = { viewModel.syncHistory() },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !uiState.isSyncing
                ) {
                    Text(if (uiState.isSyncing) "同步中..." else "一键同步聊天记录")
                }
            }

            SettingsCard(title = "隐私与数据") {
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

            uiState.statusMessage?.let { message ->
                Text(
                    text = message,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.tertiary,
                    modifier = Modifier.padding(top = 4.dp)
                )
            }
        }

        if (showClearConfirm) {
            AlertDialog(
                onDismissRequest = { showClearConfirm = false },
                confirmButton = {
                    TextButton(onClick = {
                        showClearConfirm = false
                        viewModel.clearMemories()
                    }) {
                        Text("确认清空")
                    }
                },
                dismissButton = {
                    TextButton(onClick = { showClearConfirm = false }) {
                        Text("再想想")
                    }
                },
                title = { Text("清空记忆数据") },
                text = { Text("此操作会删除本地所有聊天、日记，并让 ATRI 使用全新的身份，旧记忆将不再被引用。") }
            )
        }
    }
}

@Composable
private fun SettingsCard(
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
            verticalArrangement = Arrangement.spacedBy(12.dp)
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
