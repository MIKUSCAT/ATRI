package me.atri.di

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import me.atri.data.api.AtriApiService
import me.atri.data.datastore.PreferencesStore
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import org.koin.dsl.module
import retrofit2.Retrofit
import java.util.concurrent.TimeUnit

val networkModule = module {
    single {
        val logging = HttpLoggingInterceptor().apply {
            // BODY 会把流式响应一次性读完，流式聊天会卡住，这里改成只看基础日志
            level = HttpLoggingInterceptor.Level.BASIC
        }

        OkHttpClient.Builder()
            .addInterceptor(logging)
            .connectTimeout(60, TimeUnit.SECONDS)
            .readTimeout(180, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build()
    }

    single {
        val preferencesStore = get<PreferencesStore>()
        val baseUrl = runBlocking { preferencesStore.apiUrl.first() }.ifEmpty { "https://api.example.com/" }

        val json = Json {
            ignoreUnknownKeys = true
            isLenient = true
        }

        Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(get())
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
    }

    single<AtriApiService> {
        get<Retrofit>().create(AtriApiService::class.java)
    }
}
