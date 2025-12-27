package me.atri.di

import me.atri.data.datastore.PreferencesStore
import me.atri.data.datastore.appDataStore
import me.atri.data.db.AtriDatabase
import me.atri.utils.NotificationHelper
import org.koin.android.ext.koin.androidContext
import org.koin.dsl.module

val appModule = module {
    single { AtriDatabase.getInstance(androidContext()) }
    single { get<AtriDatabase>().messageDao() }
    single { get<AtriDatabase>().messageVersionDao() }
    single { get<AtriDatabase>().diaryDao() }
    single { get<AtriDatabase>().memoryDao() }
    single { PreferencesStore(androidContext().appDataStore) }
    single { NotificationHelper(androidContext()) }
}
