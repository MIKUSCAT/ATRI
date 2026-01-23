package me.atri.di

import me.atri.ui.chat.ChatViewModel
import me.atri.ui.diary.DiaryViewModel
import me.atri.ui.settings.SettingsViewModel
import org.koin.androidx.viewmodel.dsl.viewModel
import org.koin.dsl.module

val viewModelModule = module {
    viewModel { ChatViewModel(get(), get(), get()) }
    viewModel { SettingsViewModel(get(), get(), get(), get()) }
    viewModel { DiaryViewModel(get()) }
}
