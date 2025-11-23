# ATRI 前端改造方案：GPT 风格输入框 (InputBar)

本文档详细描述了将 `ATRI/app/src/main/java/me/atri/ui/chat/InputBar.kt` 改造为 ChatGPT 风格（极简药丸形态 + 微交互发送按钮）的完整方案。

---

## 1. 核心设计理念

*   **去繁就简 (Minimalism)**：彻底移除原有的高光 (`drawBehind`)、阴影 (`shadow`) 和描边 (`border`)，回归最纯粹的 UI 形态。
*   **胶囊容器 (The Pill)**：使用 `RoundedCornerShape(26.dp)` 配合低透明度的灰色背景，打造“悬浮”在底部的轻盈感。
*   **状态感知 (State Awareness)**：发送按钮不再是静态的，而是通过颜色动画 (`animateColorAsState`) 在“不可用（灰/透）”与“可用（黑/白）”之间平滑过渡，提供细腻的视觉反馈。

---

## 2. 代码改造步骤

请打开 `ATRI/app/src/main/java/me/atri/ui/chat/InputBar.kt`，按照以下逻辑进行替换。

### 2.1 准备工作：引入必要的动画状态

在 `InputBar` Composable 函数内部，`Column` 开始之前，定义发送按钮的颜色动画。

```kotlin
// ... (保留原有的 state 定义：text, attachments, imagePickerLauncher)

// === 新增：发送按钮的微交互动画状态 ===
val canSend = text.isNotBlank() || attachments.isNotEmpty()

// 按钮背景色：无内容时透明，有内容时变为深色（OnSurface）
val targetBtnBg = if (canSend) MaterialTheme.colorScheme.onSurface else Color.Transparent
val btnBgColor by animateColorAsState(
    targetValue = targetBtnBg,
    label = "btnBg",
    animationSpec = tween(durationMillis = 200)
)

// 图标颜色：无内容时灰色，有内容时反白（Surface）
val targetIconTint = if (canSend) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)
val iconTintColor by animateColorAsState(
    targetValue = targetIconTint,
    label = "iconTint",
    animationSpec = tween(durationMillis = 200)
)
// ==========================================

Column(
    modifier = Modifier
        .fillMaxWidth()
        .padding(horizontal = 16.dp, vertical = 12.dp) // 调整：增加外边距，增加呼吸感
) {
    // ... (保留 ReferencePreview 和 attachments LazyRow 逻辑不变)
```

### 2.2 核心重构：替换容器与布局

找到原有的 `Box` 容器（包含 `.shadow` 和 `.drawBehind` 的那个），将其**完全删除**，替换为以下 `Surface` 结构。

```kotlin
    // === 核心改造区域：GPT 风格输入胶囊 ===
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(26.dp), // 经典的胶囊圆角
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f), // 极浅的灰色背景
        tonalElevation = 0.dp
    ) {
        Row(
            modifier = Modifier
                .padding(start = 8.dp, end = 8.dp, top = 4.dp, bottom = 4.dp), // 紧凑的内边距
            verticalAlignment = Alignment.Bottom // 底部对齐，适应多行输入
        ) {
            // 1. 左侧附件按钮：去背景化
            IconButton(
                onClick = { imagePickerLauncher.launch("image/*") },
                enabled = enabled && attachments.size < MAX_ATTACHMENTS,
                modifier = Modifier.padding(bottom = 4.dp) // 微调对齐
            ) {
                Icon(
                    imageVector = Icons.Outlined.Add,
                    contentDescription = "添加附件",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
                )
            }

            // 2. 中间输入框：透明化
            TextField(
                value = text,
                onValueChange = { text = it },
                modifier = Modifier.weight(1f), // 占据剩余空间
                placeholder = { 
                    Text(
                        "Message ATRI", 
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                    ) 
                },
                maxLines = 5, // 允许输入更多行
                enabled = enabled,
                textStyle = MaterialTheme.typography.bodyLarge,
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = Color.Transparent,
                    unfocusedContainerColor = Color.Transparent,
                    disabledContainerColor = Color.Transparent,
                    focusedIndicatorColor = Color.Transparent, // 去除底部指示线
                    unfocusedIndicatorColor = Color.Transparent,
                    disabledIndicatorColor = Color.Transparent,
                    cursorColor = MaterialTheme.colorScheme.primary
                )
            )

            // 3. 右侧发送按钮：应用动画状态
            IconButton(
                onClick = {
                    if (isProcessing) onCancelProcessing()
                    else if (canSend) {
                        onSendMessage(text, attachments.toList())
                        text = ""
                        attachments.clear()
                    }
                },
                enabled = enabled, // 始终可点击，只是无内容时视觉上“置灰”
                modifier = Modifier
                    .padding(bottom = 4.dp)
                    .background(btnBgColor, CircleShape) // 应用动画背景色
                    .size(32.dp) // 按钮尺寸
            ) {
                if (isProcessing) {
                    // Loading 状态：保持反白
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        color = MaterialTheme.colorScheme.surface,
                        strokeWidth = 2.dp
                    )
                } else {
                    // 发送图标：始终显示上箭头，颜色由动画控制
                    Icon(
                        imageVector = Icons.Rounded.ArrowUpward,
                        contentDescription = "发送",
                        tint = iconTintColor,
                        modifier = Modifier.size(18.dp)
                    )
                }
            }
        }
    }
    // === 核心改造结束 ===
```

---

## 3. 完整代码参考 (Snippet)

为方便对照，以下是改造后的 `InputBar` 函数主体结构：

```kotlin
@Composable
fun InputBar(
    enabled: Boolean = true,
    isProcessing: Boolean = false,
    reference: ChatUiState.ReferencedMessage? = null,
    onClearReference: () -> Unit = {},
    onToggleReferenceAttachment: (String) -> Unit = {},
    onCancelProcessing: () -> Unit = {},
    onSendMessage: (String, List<PendingAttachment>) -> Unit
) {
    val context = LocalContext.current
    var text by remember { mutableStateOf("") }
    val attachments = remember { mutableStateListOf<PendingAttachment>() }

    // ... (ImagePickerLauncher 代码不变)

    // 动画状态定义
    val canSend = text.isNotBlank() || attachments.isNotEmpty()
    val targetBtnBg = if (canSend) MaterialTheme.colorScheme.onSurface else Color.Transparent
    val btnBgColor by animateColorAsState(targetBtnBg, label = "btnBg")
    val targetIconTint = if (canSend) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)
    val iconTintColor by animateColorAsState(targetIconTint, label = "iconTint")

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp)
    ) {
        // ... (ReferencePreview 和 Attachments 逻辑不变)

        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(26.dp),
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f),
            tonalElevation = 0.dp
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.Bottom
            ) {
                IconButton(
                    onClick = { imagePickerLauncher.launch("image/*") },
                    enabled = enabled && attachments.size < MAX_ATTACHMENTS,
                    modifier = Modifier.padding(bottom = 4.dp)
                ) {
                    Icon(
                        Icons.Outlined.Add,
                        contentDescription = "添加附件",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
                    )
                }

                TextField(
                    value = text,
                    onValueChange = { text = it },
                    modifier = Modifier.weight(1f),
                    placeholder = { 
                        Text("Message ATRI", color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)) 
                    },
                    maxLines = 5,
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = Color.Transparent,
                        unfocusedContainerColor = Color.Transparent,
                        focusedIndicatorColor = Color.Transparent,
                        unfocusedIndicatorColor = Color.Transparent,
                        // ... 其他颜色设置为 Transparent
                    )
                )

                IconButton(
                    onClick = { /* 发送逻辑 */ },
                    modifier = Modifier
                        .padding(bottom = 4.dp)
                        .background(btnBgColor, CircleShape)
                        .size(32.dp)
                ) {
                    if (isProcessing) {
                         CircularProgressIndicator(
                            modifier = Modifier.size(18.dp), 
                            color = MaterialTheme.colorScheme.surface
                        )
                    } else {
                        Icon(
                            Icons.Rounded.ArrowUpward, 
                            contentDescription = "发送", 
                            tint = iconTintColor, 
                            modifier = Modifier.size(18.dp)
                        )
                    }
                }
            }
        }
    }
}