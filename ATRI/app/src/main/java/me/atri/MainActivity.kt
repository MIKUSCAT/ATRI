package me.atri

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
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
import org.koin.android.ext.android.inject
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

private enum class AppScreen {
    LOADING, CHAT, SETTINGS, DIARY
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

    BackHandler(enabled = showSettings || showDiary) {
        when {
            showSettings -> showSettings = false
            showDiary -> showDiary = false
        }
    }

    // 首次启动时自动标记为非首次，跳过 WelcomeScreen
    LaunchedEffect(isFirstLaunch) {
        if (isFirstLaunch == true) {
            preferencesStore.setFirstLaunch(false)
        }
    }

    val currentScreen = when {
        isFirstLaunch == null -> AppScreen.LOADING
        showSettings -> AppScreen.SETTINGS
        showDiary -> AppScreen.DIARY
        else -> AppScreen.CHAT
    }

    AnimatedContent(
        targetState = currentScreen,
        transitionSpec = {
            when {
                // 进入设置或日记：从右滑入
                targetState == AppScreen.SETTINGS || targetState == AppScreen.DIARY -> {
                    (slideInHorizontally { it / 3 } + fadeIn()) togetherWith
                            (slideOutHorizontally { -it / 3 } + fadeOut())
                }
                // 返回聊天：从左滑入
                initialState == AppScreen.SETTINGS || initialState == AppScreen.DIARY -> {
                    (slideInHorizontally { -it / 3 } + fadeIn()) togetherWith
                            (slideOutHorizontally { it / 3 } + fadeOut())
                }
                else -> fadeIn() togetherWith fadeOut()
            }
        },
        label = "screenTransition"
    ) { screen ->
        when (screen) {
            AppScreen.LOADING -> {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            }
            AppScreen.SETTINGS -> SettingsScreen(onNavigateBack = { showSettings = false })
            AppScreen.DIARY -> DiaryScreen(onNavigateBack = { showDiary = false })
            AppScreen.CHAT -> {
                ChatScreen(
                    onOpenSettings = { showSettings = true },
                    onOpenDiary = { showDiary = true },
                    welcomeDismissed = chatWelcomeDismissed,
                    onDismissWelcome = { chatWelcomeDismissed = true }
                )
            }
        }
    }
}
