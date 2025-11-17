package me.atri.ui.welcome

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.shape.CircleShape
import coil.compose.AsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import me.atri.ui.components.ProfileAvatar
import me.atri.utils.FileUtils.saveAtriAvatar
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material3.Icon

@Composable
fun WelcomeScreen(
    onComplete: (String, String?) -> Unit
) {
    var userName by remember { mutableStateOf("") }
    var avatarPath by remember { mutableStateOf<String?>(null) }
    var isSavingAvatar by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    val avatarPickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri ->
        if (uri != null) {
            scope.launch {
                isSavingAvatar = true
                val saved = withContext(Dispatchers.IO) { context.saveAtriAvatar(uri) }
                avatarPath = saved
                isSavingAvatar = false
            }
        }
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Box(
                modifier = Modifier.size(160.dp),
                contentAlignment = Alignment.Center
            ) {
                val avatarSize = 120.dp
                if (avatarPath.isNullOrBlank()) {
                    ProfileAvatar(size = avatarSize)
                } else {
                    AsyncImage(
                        model = avatarPath,
                        contentDescription = "ATRI 头像",
                        modifier = Modifier
                            .size(avatarSize)
                            .clip(CircleShape)
                    )
                }

                Surface(
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .offset(x = 14.dp, y = 14.dp),
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.surface,
                    tonalElevation = 6.dp,
                    shadowElevation = 10.dp
                ) {
                    IconButton(
                        onClick = { avatarPickerLauncher.launch("image/*") },
                        modifier = Modifier.size(40.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.PhotoCamera,
                            contentDescription = "选择头像",
                            tint = MaterialTheme.colorScheme.primary
                        )
                    }
                }
            }

            if (isSavingAvatar) {
                Text(
                    text = "正在保存头像...",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 8.dp)
                )
            } else {
                Spacer(modifier = Modifier.height(8.dp))
            }

            Spacer(modifier = Modifier.height(32.dp))

            Text(
                text = "你好，我是 ATRI",
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.primary
            )

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = "很高兴认识你～",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )

            Spacer(modifier = Modifier.height(48.dp))

            OutlinedTextField(
                value = userName,
                onValueChange = { userName = it.trimStart() },
                label = { Text("你叫什么名字呢？") },
                placeholder = { Text("请输入你的名字") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )

            Spacer(modifier = Modifier.height(24.dp))

            Button(
                onClick = {
                    if (userName.isNotBlank()) {
                        onComplete(userName.trim(), avatarPath)
                    }
                },
                modifier = Modifier.fillMaxWidth(),
                enabled = userName.isNotBlank()
            ) {
                Text("开始聊天")
            }
        }
    }
}
