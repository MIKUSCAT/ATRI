package me.atri.ui.welcome

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import me.atri.ui.chat.buildTimeGreeting
import me.atri.ui.components.AtriAvatar
import me.atri.ui.components.CircleRevealOverlay
import me.atri.ui.components.TypewriterText
import me.atri.ui.components.rememberCircleRevealState
import me.atri.utils.FileUtils.saveAtriAvatar

@Composable
fun WelcomeScreen(
    onComplete: (String, String?) -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var userName by remember { mutableStateOf("") }
    var avatarPath by remember { mutableStateOf<String?>(null) }
    var startTypewriter by remember { mutableStateOf(false) }

    val greeting = remember { buildTimeGreeting() }
    val revealState = rememberCircleRevealState()

    LaunchedEffect(Unit) {
        delay(300)
        startTypewriter = true
    }

    val avatarLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        if (uri != null) {
            scope.launch {
                val saved = withContext(Dispatchers.IO) {
                    context.saveAtriAvatar(uri)
                }
                if (!saved.isNullOrBlank()) {
                    avatarPath = saved
                }
            }
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = MaterialTheme.colorScheme.background
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .statusBarsPadding()
                    .imePadding()
                    .padding(horizontal = 32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                AtriAvatar(
                    avatarPath = avatarPath ?: "",
                    size = 160.dp,
                    onClick = { avatarLauncher.launch("image/*") }
                )

                Spacer(modifier = Modifier.height(8.dp))

                Text(
                    text = "点击设置头像",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                Spacer(modifier = Modifier.height(32.dp))

                TypewriterText(
                    text = greeting,
                    enabled = startTypewriter
                ) { displayedText ->
                    Text(
                        text = displayedText,
                        style = MaterialTheme.typography.headlineMedium,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(horizontal = 16.dp)
                    )
                }

                Spacer(modifier = Modifier.height(48.dp))

                OutlinedTextField(
                    value = userName,
                    onValueChange = { userName = it },
                    placeholder = { Text("我该怎么称呼你？") },
                    singleLine = true,
                    shape = RoundedCornerShape(16.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp)
                )

                Spacer(modifier = Modifier.height(32.dp))

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
                                revealState.reveal {
                                    onComplete(userName.ifBlank { "夏生" }, avatarPath)
                                }
                            }
                        },
                        modifier = Modifier
                            .width(220.dp)
                            .height(52.dp),
                        shape = MaterialTheme.shapes.extraLarge
                    ) {
                        Text("开始今天的对话")
                    }
                }

                Spacer(modifier = Modifier.height(48.dp))
            }
        }

        CircleRevealOverlay(state = revealState)
    }
}
