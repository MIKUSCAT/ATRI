package me.atri.worker

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import me.atri.data.api.AtriApiService
import me.atri.data.datastore.PreferencesStore
import me.atri.utils.NotificationHelper
import org.koin.core.component.KoinComponent
import org.koin.core.component.inject
import java.util.TimeZone

class ProactiveCheckWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params), KoinComponent {

    private val apiService: AtriApiService by inject()
    private val preferencesStore: PreferencesStore by inject()
    private val notificationHelper: NotificationHelper by inject()

    override suspend fun doWork(): Result {
        return try {
            val userId = preferencesStore.getUserId() ?: return Result.success()
            val timeZone = TimeZone.getDefault().id

            val response = apiService.checkProactiveMessage(userId, timeZone)
            
            if (response.isSuccessful) {
                val body = response.body()
                if (body?.hasMessage == true && body.message != null) {
                    notificationHelper.showProactiveNotification(body.message)
                }
                Result.success()
            } else {
                Result.retry()
            }
        } catch (e: Exception) {
            e.printStackTrace()
            Result.retry()
        }
    }
}