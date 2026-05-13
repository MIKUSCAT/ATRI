package me.atri.di

import me.atri.data.UserDataManager
import me.atri.data.repository.ChatRepository
import me.atri.data.repository.DiaryRepository
import org.koin.android.ext.koin.androidContext
import org.koin.dsl.module

val repositoryModule = module {
    single { ChatRepository(get(), get(), get(), get(), androidContext()) }
    single { DiaryRepository(get(), get()) }
    single { UserDataManager(get(), get()) }
}
