package me.atri.ui.sheet

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

enum class SheetTab {
    DIARY, STATUS
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AtriBottomSheet(
    onDismiss: () -> Unit
) {
    var selectedTab by remember { mutableStateOf(SheetTab.DIARY) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ) {
        Column(modifier = Modifier.wrapContentHeight()) {
            TabRow(
                selectedTabIndex = selectedTab.ordinal,
                containerColor = androidx.compose.material3.MaterialTheme.colorScheme.surface
            ) {
                Tab(
                    selected = selectedTab == SheetTab.DIARY,
                    onClick = { selectedTab = SheetTab.DIARY },
                    text = { Text("日记") },
                    modifier = Modifier.height(48.dp)
                )
                Tab(
                    selected = selectedTab == SheetTab.STATUS,
                    onClick = { selectedTab = SheetTab.STATUS },
                    text = { Text("状态") },
                    modifier = Modifier.height(48.dp)
                )
            }

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 300.dp, max = 600.dp)
            ) {
                when (selectedTab) {
                    SheetTab.DIARY -> DiaryTab()
                    SheetTab.STATUS -> StatusTab()
                }
            }
        }
    }
}
