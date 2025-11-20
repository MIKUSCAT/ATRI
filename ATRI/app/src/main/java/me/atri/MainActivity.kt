package me.atri

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.core.view.WindowCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import me.atri.data.datastore.PreferencesStore
import me.atri.ui.chat.ChatScreen
import me.atri.ui.diary.DiaryScreen
import me.atri.ui.settings.SettingsScreen
import me.atri.ui.theme.AtriTheme
import me.atri.ui.welcome.WelcomeScreen
import org.koin.android.ext.android.inject
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.collectLatest

class MainActivity : ComponentActivity() {
    private val preferencesStore: PreferencesStore by inject()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = true
        setContent {
            AtriTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    AtriApp(preferencesStore)
                }
            }
        }
    }

}

@Composable
fun AtriApp(preferencesStore: PreferencesStore) {
    val lifecycleOwner = LocalLifecycleOwner.current
    var isFirstLaunch by remember { mutableStateOf<Boolean?>(null) }
    LaunchedEffect(preferencesStore, lifecycleOwner) {
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            preferencesStore.isFirstLaunch.collectLatest { value ->
                isFirstLaunch = value
            }
        }
    }
    var showSettings by remember { mutableStateOf(false) }
    var showDiary by remember { mutableStateOf(false) }
    var chatWelcomeDismissed by rememberSaveable { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    when {
        isFirstLaunch == null -> {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator()
            }
        }
        isFirstLaunch == true -> {
            WelcomeScreen { userName, avatarPath ->
                scope.launch {
                    preferencesStore.setUserName(userName)
                    if (!avatarPath.isNullOrBlank()) {
                        preferencesStore.setAtriAvatarPath(avatarPath)
                    }
                    preferencesStore.setFirstLaunch(false)
                }
            }
        }
        showSettings -> SettingsScreen(onNavigateBack = { showSettings = false })
        showDiary -> DiaryScreen(onNavigateBack = { showDiary = false })
        else -> {
            ChatScreen(
                onOpenSettings = { showSettings = true },
                onOpenDiary = { showDiary = true },
                welcomeDismissed = chatWelcomeDismissed,
                onDismissWelcome = { chatWelcomeDismissed = true }
            )
        }
    }
}
