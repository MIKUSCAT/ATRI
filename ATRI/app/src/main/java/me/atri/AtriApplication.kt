package me.atri

import android.app.Application
import coil.ImageLoader
import coil.ImageLoaderFactory
import me.atri.di.*
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import org.koin.android.ext.koin.androidContext
import org.koin.core.context.startKoin
import org.koin.java.KoinJavaComponent.getKoin
import java.util.concurrent.TimeUnit

class AtriApplication : Application(), ImageLoaderFactory {
    override fun onCreate() {
        super.onCreate()

        startKoin {
            androidContext(this@AtriApplication)
            modules(appModule, networkModule, repositoryModule, viewModelModule)
        }
    }

    override fun newImageLoader(): ImageLoader {
        val configProvider = runCatching { getKoin().get<DynamicConfigProvider>() }.getOrNull()
        if (configProvider == null) {
            return ImageLoader.Builder(this).build()
        }

        val okHttpClient = OkHttpClient.Builder()
            .addInterceptor(MediaAuthInterceptor(configProvider))
            .connectTimeout(60, TimeUnit.SECONDS)
            .readTimeout(180, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build()

        return ImageLoader.Builder(this)
            .okHttpClient(okHttpClient)
            .build()
    }

    private class MediaAuthInterceptor(
        private val configProvider: DynamicConfigProvider
    ) : Interceptor {
        override fun intercept(chain: Interceptor.Chain): okhttp3.Response {
            val request = chain.request()
            val url = request.url
            if (!url.encodedPath.startsWith("/media/")) {
                return chain.proceed(request)
            }

            val token = configProvider.getToken()
            val baseUrl = configProvider.getBaseUrl().toHttpUrlOrNull()
            val newUrl = if (baseUrl != null) {
                url.newBuilder()
                    .scheme(baseUrl.scheme)
                    .host(baseUrl.host)
                    .port(baseUrl.port)
                    .build()
            } else {
                url
            }

            val builder = request.newBuilder().url(newUrl)
            if (token.isNotEmpty()) {
                builder.addHeader("X-App-Token", token)
            }
            return chain.proceed(builder.build())
        }
    }
}
