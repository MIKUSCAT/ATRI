package me.atri.data.api

import me.atri.data.api.request.ChatRequest
import me.atri.data.api.request.ConversationDeleteRequest
import me.atri.data.api.request.ConversationLogRequest
import me.atri.data.api.response.DiaryEntryResponse
import me.atri.data.api.response.DiaryListResponse
import me.atri.data.api.response.LastConversationResponse
import me.atri.data.api.response.BioChatResponse
import me.atri.data.api.response.ModelListResponse
import me.atri.data.api.response.UploadResponse
import me.atri.data.api.response.ProactiveCheckResponse
import me.atri.data.api.response.ProactiveSettings
import okhttp3.RequestBody
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Query
import retrofit2.http.Streaming

interface AtriApiService {
    @POST("/api/v1/chat")
    suspend fun sendBioMessage(@Body request: ChatRequest): Response<BioChatResponse>

    @POST("/conversation/log")
    suspend fun logConversation(@Body request: ConversationLogRequest): Response<ResponseBody>

    @POST("/conversation/delete")
    suspend fun deleteConversationLogs(@Body request: ConversationDeleteRequest): Response<ResponseBody>

    @Streaming
    @POST("/upload")
    suspend fun uploadAttachment(
        @Header("X-File-Name") fileName: String,
        @Header("X-File-Type") mime: String,
        @Header("X-File-Size") size: Long?,
        @Header("X-User-Id") userId: String,
        @Body body: RequestBody
    ): Response<UploadResponse>

    @GET("/conversation/last")
    suspend fun fetchLastConversation(
        @Query("userId") userId: String,
        @Query("timeZone") timeZone: String? = null,
        @Query("date") date: String? = null
    ): Response<LastConversationResponse>

    @GET("/diary/list")
    suspend fun fetchDiaryList(
        @Query("userId") userId: String,
        @Query("limit") limit: Int = 7
    ): Response<DiaryListResponse>

    @GET("/diary")
    suspend fun fetchDiaryDetail(
        @Query("userId") userId: String,
        @Query("date") date: String
    ): Response<DiaryEntryResponse>

    @GET("/models")
    suspend fun fetchModelList(): Response<ModelListResponse>

    @GET("/proactive/check")
    suspend fun checkProactiveMessage(
        @Query("userId") userId: String,
        @Query("timeZone") timeZone: String
    ): Response<ProactiveCheckResponse>

    @GET("/proactive/settings")
    suspend fun getProactiveSettings(
        @Query("userId") userId: String
    ): Response<ProactiveSettings>

    @POST("/proactive/settings")
    suspend fun updateProactiveSettings(
        @Body settings: ProactiveSettings
    ): Response<Unit>
}
