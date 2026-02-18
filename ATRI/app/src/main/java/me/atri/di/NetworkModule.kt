package me.atri.di

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import me.atri.data.api.AtriApiService
import me.atri.data.datastore.PreferencesStore
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import org.koin.dsl.module
import retrofit2.Retrofit
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * 动态配置提供者，避免在拦截器中使用 runBlocking
 * 通过缓存 + 协程更新的方式实现非阻塞读取
 */
class DynamicConfigProvider(private val preferencesStore: PreferencesStore) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val cachedToken = AtomicReference("")
    private val cachedBaseUrl = AtomicReference(DEFAULT_BASE_URL)

    init {
        // 初始化时异步加载配置
        refreshConfig()
        // 监听配置变化
        observeConfigChanges()
    }

    fun getToken(): String = cachedToken.get()
    fun getBaseUrl(): String = cachedBaseUrl.get()

    fun refreshConfig() {
        scope.launch {
            try {
                cachedToken.set(preferencesStore.appToken.first().trim())
                val url = preferencesStore.apiUrl.first().trim()
                cachedBaseUrl.set(url.ifEmpty { DEFAULT_BASE_URL })
            } catch (e: Exception) {
                // 加载失败时保持默认值
            }
        }
    }

    private fun observeConfigChanges() {
        scope.launch {
            preferencesStore.appToken.collect { token ->
                cachedToken.set(token.trim())
            }
        }
        scope.launch {
            preferencesStore.apiUrl.collect { url ->
                cachedBaseUrl.set(url.trim().ifEmpty { DEFAULT_BASE_URL })
            }
        }
    }

    companion object {
        // 占位符 URL，实际由用户配置的 API 地址替换
        const val DEFAULT_BASE_URL = "https://localhost"
    }
}

/**
 * 动态 BaseUrl 拦截器
 * 每次请求时从 ConfigProvider 获取最新的 baseUrl
 */
class DynamicBaseUrlInterceptor(private val configProvider: DynamicConfigProvider) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): okhttp3.Response {
        val originalRequest = chain.request()
        val originalUrl = originalRequest.url

        val newBaseUrl = configProvider.getBaseUrl().toHttpUrlOrNull()
            ?: return chain.proceed(originalRequest)

        // 替换 host 和 scheme
        val newUrl = originalUrl.newBuilder()
            .scheme(newBaseUrl.scheme)
            .host(newBaseUrl.host)
            .port(newBaseUrl.port)
            .build()

        val newRequest = originalRequest.newBuilder()
            .url(newUrl)
            .build()

        return chain.proceed(newRequest)
    }
}

/**
 * Token 认证拦截器
 * 非阻塞地从 ConfigProvider 获取 token
 */
class TokenInterceptor(private val configProvider: DynamicConfigProvider) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): okhttp3.Response {
        val token = configProvider.getToken()
        val request = if (token.isNotEmpty()) {
            chain.request().newBuilder()
                .addHeader("X-App-Token", token)
                .build()
        } else {
            chain.request()
        }
        return chain.proceed(request)
    }
}

val networkModule = module {
    // 配置提供者单例
    single { DynamicConfigProvider(get()) }

    single {
        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BASIC
        }

        val configProvider = get<DynamicConfigProvider>()

        OkHttpClient.Builder()
            .addInterceptor(logging)
            .addInterceptor(TokenInterceptor(configProvider))
            .addInterceptor(DynamicBaseUrlInterceptor(configProvider))
            .connectTimeout(60, TimeUnit.SECONDS)
            .readTimeout(180, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build()
    }

    single {
        val json = Json {
            ignoreUnknownKeys = true
            isLenient = true
        }

        // 使用占位 baseUrl，实际 URL 由拦截器动态替换
        Retrofit.Builder()
            .baseUrl(DynamicConfigProvider.DEFAULT_BASE_URL)
            .client(get())
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
    }

    single<AtriApiService> {
        get<Retrofit>().create(AtriApiService::class.java)
    }
}
