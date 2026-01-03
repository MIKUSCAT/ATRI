package me.atri.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * 自定义扩展颜色，用于消息气泡等特殊场景
 */
data class AtriExtendedColors(
    val messageBubbleAtri: Color,
    val messageBubbleUser: Color,
    val textPrimary: Color,
    val textSecondary: Color
)

val LocalAtriColors = staticCompositionLocalOf {
    AtriExtendedColors(
        messageBubbleAtri = MessageBubbleAtriLight,
        messageBubbleUser = MessageBubbleUserLight,
        textPrimary = TextPrimaryLight,
        textSecondary = TextSecondaryLight
    )
}

private val LightColorScheme = lightColorScheme(
    primary = AtriBlue,
    onPrimary = Color.White,
    primaryContainer = MessageBubbleAtriLight,
    onPrimaryContainer = TextPrimaryLight,
    secondary = AtriPink,
    onSecondary = Color.White,
    secondaryContainer = AtriPinkLight,
    onSecondaryContainer = TextPrimaryLight,
    background = BackgroundLight,
    onBackground = TextPrimaryLight,
    surface = SurfaceLight,
    onSurface = TextPrimaryLight,
    surfaceVariant = SurfaceVariantLight,
    onSurfaceVariant = TextSecondaryLight,
    outline = OutlineLight,
    outlineVariant = OutlineLight.copy(alpha = 0.5f),
    error = Color(0xFFB00020),
    onError = Color.White,
)

private val DarkColorScheme = darkColorScheme(
    primary = AtriBlueLight,
    onPrimary = Color.Black,
    primaryContainer = MessageBubbleAtriDark,
    onPrimaryContainer = TextPrimaryDark,
    secondary = AtriPinkLight,
    onSecondary = Color.Black,
    secondaryContainer = Color(0xFF4A2C3A),
    onSecondaryContainer = TextPrimaryDark,
    background = BackgroundDark,
    onBackground = TextPrimaryDark,
    surface = SurfaceDark,
    onSurface = TextPrimaryDark,
    surfaceVariant = SurfaceVariantDark,
    onSurfaceVariant = TextSecondaryDark,
    outline = OutlineDark,
    outlineVariant = OutlineDark.copy(alpha = 0.5f),
    error = Color(0xFFCF6679),
    onError = Color.Black,
)

private val LightExtendedColors = AtriExtendedColors(
    messageBubbleAtri = MessageBubbleAtriLight,
    messageBubbleUser = MessageBubbleUserLight,
    textPrimary = TextPrimaryLight,
    textSecondary = TextSecondaryLight
)

private val DarkExtendedColors = AtriExtendedColors(
    messageBubbleAtri = MessageBubbleAtriDark,
    messageBubbleUser = MessageBubbleUserDark,
    textPrimary = TextPrimaryDark,
    textSecondary = TextSecondaryDark
)

@Composable
fun AtriTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme
    val extendedColors = if (darkTheme) DarkExtendedColors else LightExtendedColors

    CompositionLocalProvider(LocalAtriColors provides extendedColors) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = Typography,
            content = content
        )
    }
}

/**
 * 便捷访问扩展颜色
 */
object AtriTheme {
    val colors: AtriExtendedColors
        @Composable
        get() = LocalAtriColors.current
}
