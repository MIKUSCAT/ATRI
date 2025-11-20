package me.atri

import android.app.Application
import me.atri.di.*
import org.koin.android.ext.koin.androidContext
import org.koin.core.context.startKoin

class AtriApplication : Application() {
    override fun onCreate() {
        super.onCreate()

        startKoin {
            androidContext(this@AtriApplication)
            modules(appModule, networkModule, repositoryModule, viewModelModule)
        }
    }
}
