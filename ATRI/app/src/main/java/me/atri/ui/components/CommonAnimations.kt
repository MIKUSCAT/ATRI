package me.atri.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import kotlinx.coroutines.delay

/**
 * 打字机效果文本组件
 * @param text 要显示的完整文本
 * @param enabled 是否启用打字机效果
 * @param delayPerChar 每个字符的延迟时间（毫秒）
 * @param onComplete 打字完成回调
 * @param content 文本渲染内容
 */
@Composable
fun TypewriterText(
    text: String,
    enabled: Boolean = true,
    delayPerChar: Long = 50L,
    onComplete: () -> Unit = {},
    content: @Composable (displayedText: String) -> Unit
) {
    var displayedText by remember { mutableStateOf("") }

    LaunchedEffect(enabled, text) {
        if (enabled && text.isNotEmpty()) {
            displayedText = ""
            text.forEachIndexed { index, _ ->
                delay(delayPerChar)
                displayedText = text.take(index + 1)
            }
            onComplete()
        }
        // enabled=false 时保持空字符串，等待启用后再打字
    }

    content(displayedText)
}

/**
 * 圆形揭示过渡效果状态
 */
class CircleRevealState {
    var isRevealing by mutableStateOf(false)
        private set

    var centerOffset by mutableStateOf(Offset.Zero)
        internal set

    val revealRadius = Animatable(0f)

    suspend fun reveal(onComplete: () -> Unit = {}) {
        isRevealing = true
        revealRadius.animateTo(
            targetValue = 3000f,
            animationSpec = tween(450, easing = FastOutSlowInEasing)
        )
        onComplete()
    }

    fun reset() {
        isRevealing = false
    }
}

@Composable
fun rememberCircleRevealState(): CircleRevealState {
    return remember { CircleRevealState() }
}

/**
 * 圆形揭示过渡效果
 * @param state 揭示状态
 * @param color 揭示圆形的颜色
 */
@Composable
fun CircleRevealOverlay(
    state: CircleRevealState,
    color: Color = Color(0xFF64B5F6),
    modifier: Modifier = Modifier
) {
    if (state.isRevealing && state.revealRadius.value > 0f) {
        Canvas(modifier = modifier.fillMaxSize()) {
            drawCircle(
                color = color,
                radius = state.revealRadius.value,
                center = state.centerOffset
            )
        }
    }
}

/**
 * 带按压效果的按钮包装器
 * @param onPress 按下回调
 * @param onRelease 释放回调
 * @param onClick 点击回调
 * @param content 按钮内容
 */
@Composable
fun PressableButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    onCaptureCenter: (Offset) -> Unit = {},
    content: @Composable (scale: Float) -> Unit
) {
    var isPressed by remember { mutableStateOf(false) }

    val scale by animateFloatAsState(
        targetValue = if (isPressed) 0.96f else 1f,
        animationSpec = spring(dampingRatio = 0.6f),
        label = "buttonScale"
    )

    Box(
        modifier = modifier
            .onGloballyPositioned { coordinates ->
                val position = coordinates.positionInRoot()
                val size = coordinates.size
                onCaptureCenter(
                    Offset(
                        position.x + size.width / 2f,
                        position.y + size.height / 2f
                    )
                )
            }
            .scale(scale)
            .pointerInput(Unit) {
                detectTapGestures(
                    onPress = {
                        isPressed = true
                        tryAwaitRelease()
                        isPressed = false
                    },
                    onTap = { onClick() }
                )
            }
    ) {
        content(scale)
    }
}

/**
 * ATRI 头像组件 - 统一的头像渲染
 * @param avatarPath 头像路径，空时显示默认占位
 * @param size 头像大小
 * @param showGlow 是否显示发光效果
 * @param onClick 点击回调
 */
@Composable
fun AtriAvatar(
    avatarPath: String,
    modifier: Modifier = Modifier,
    size: Dp = 180.dp,
    showGlow: Boolean = false,
    placeholderText: String = "ATRI",
    onClick: (() -> Unit)? = null
) {
    val context = LocalContext.current
    val avatarRequest = remember(avatarPath, context) {
        ImageRequest.Builder(context)
            .data(avatarPath.takeIf { it.isNotBlank() })
            .setParameter("refresh", System.currentTimeMillis(), memoryCacheKey = null)
            .crossfade(true)
            .build()
    }

    Box(
        modifier = modifier.size(if (showGlow) size + 20.dp else size),
        contentAlignment = Alignment.Center
    ) {
        // 发光效果背景
        if (showGlow) {
            Box(
                modifier = Modifier
                    .size(size + 40.dp)
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
        }

        // 头像内容
        val avatarModifier = Modifier
            .size(size)
            .clip(CircleShape)
            .let { mod ->
                if (onClick != null) {
                    mod.pointerInput(Unit) {
                        detectTapGestures(onTap = { onClick() })
                    }
                } else mod
            }

        if (avatarPath.isNotBlank()) {
            AsyncImage(
                model = avatarRequest,
                contentDescription = "ATRI 头像",
                modifier = avatarModifier,
                contentScale = ContentScale.Crop
            )
        } else {
            Box(
                modifier = avatarModifier.background(
                    brush = Brush.linearGradient(
                        colors = listOf(Color(0xFF99CCF2), Color(0xFFFCE4EC))
                    )
                ),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = placeholderText,
                    style = MaterialTheme.typography.headlineMedium,
                    color = Color.White
                )
            }
        }
    }
}
