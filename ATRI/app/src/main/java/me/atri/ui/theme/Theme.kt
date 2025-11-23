package me.atri.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LightColorScheme = lightColorScheme(
    primary = AtriBlue,
    onPrimary = Color.White,
    primaryContainer = MessageBubbleAtri,
    secondary = AtriPink,
    background = BackgroundLight,
    surface = BackgroundLight,
    error = Color(0xFFB00020),
)

private val DarkColorScheme = darkColorScheme(
    primary = AtriBlue,
    onPrimary = Color.Black,
    primaryContainer = Color(0xFF2C3E50),
    secondary = AtriPink,
    background = BackgroundDark,
    surface = Color(0xFF2C2C2C),
)

@Composable
fun AtriTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content
    )
}
