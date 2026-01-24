package me.atri.data.datastore

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.*
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.util.UUID

val Context.appDataStore: DataStore<Preferences> by preferencesDataStore(name = "atri_prefs")

class PreferencesStore(private val dataStore: DataStore<Preferences>) {

    companion object {
        private val USER_ID = stringPreferencesKey("user_id")
        private val USER_NAME = stringPreferencesKey("user_name")
        private val USER_BIRTHDAY = stringPreferencesKey("user_birthday")
        private val INTIMACY_POINTS = intPreferencesKey("intimacy_points")
        private val IS_FIRST_LAUNCH = booleanPreferencesKey("is_first_launch")
        private val API_URL = stringPreferencesKey("api_url")
        private val API_KEY = stringPreferencesKey("api_key")
        private val APP_TOKEN = stringPreferencesKey("app_token")
        private val MODEL_NAME = stringPreferencesKey("model_name")
        private val ATRI_AVATAR_PATH = stringPreferencesKey("atri_avatar_path")
        private val LAST_CHAT_DATE = stringPreferencesKey("last_chat_date")
        private val HISTORY_DEDUPE_DONE = booleanPreferencesKey("history_dedupe_done")
    }

    val userId: Flow<String> = dataStore.data.map { it[USER_ID] ?: "" }
    val userName: Flow<String> = dataStore.data.map { it[USER_NAME] ?: "" }
    val userBirthday: Flow<String> = dataStore.data.map { it[USER_BIRTHDAY] ?: "" }
    val intimacyPoints: Flow<Int> = dataStore.data.map { it[INTIMACY_POINTS] ?: 0 }
    val isFirstLaunch: Flow<Boolean> = dataStore.data.map { it[IS_FIRST_LAUNCH] ?: true }
    val apiUrl: Flow<String> = dataStore.data.map { it[API_URL] ?: "https://mikuscat.qzz.io" }
    val apiKey: Flow<String> = dataStore.data.map { it[API_KEY] ?: "" }
    val appToken: Flow<String> = dataStore.data.map { it[APP_TOKEN] ?: "" }
    val modelName: Flow<String> = dataStore.data.map { it[MODEL_NAME] ?: "anthropic.claude-sonnet-4" }
    val atriAvatarPath: Flow<String> = dataStore.data.map { it[ATRI_AVATAR_PATH] ?: "" }
    val lastConversationDate: Flow<String> = dataStore.data.map { it[LAST_CHAT_DATE] ?: "" }
    val historyDedupeDone: Flow<Boolean> = dataStore.data.map { it[HISTORY_DEDUPE_DONE] ?: false }

    suspend fun ensureUserId(): String {
        val current = dataStore.data.first()[USER_ID]
        return if (current.isNullOrEmpty()) {
            val newId = UUID.randomUUID().toString()
            dataStore.edit { it[USER_ID] = newId }
            newId
        } else {
            current
        }
    }

    suspend fun setUserId(userId: String) {
        val trimmed = userId.trim()
        if (trimmed.isNotEmpty()) {
            dataStore.edit { it[USER_ID] = trimmed }
        }
    }

    suspend fun resetUserId(): String {
        val newId = UUID.randomUUID().toString()
        dataStore.edit { it[USER_ID] = newId }
        return newId
    }

    suspend fun setUserName(name: String) { dataStore.edit { it[USER_NAME] = name } }
    suspend fun setUserBirthday(birthday: String) { dataStore.edit { it[USER_BIRTHDAY] = birthday } }
    suspend fun setIntimacyPoints(points: Int) { dataStore.edit { it[INTIMACY_POINTS] = points } }
    suspend fun setFirstLaunch(isFirst: Boolean) { dataStore.edit { it[IS_FIRST_LAUNCH] = isFirst } }
    suspend fun setApiUrl(url: String) {
        dataStore.edit { it[API_URL] = url }
    }

    suspend fun setApiConfig(url: String, key: String, model: String) {
        dataStore.edit {
            it[API_URL] = url
            it[API_KEY] = key
            it[MODEL_NAME] = model
        }
    }

    suspend fun setAppToken(token: String) {
        dataStore.edit { it[APP_TOKEN] = token }
    }

    suspend fun setModelName(model: String) {
        dataStore.edit { it[MODEL_NAME] = model }
    }

    suspend fun incrementIntimacy(delta: Int) {
        dataStore.edit {
            val current = it[INTIMACY_POINTS] ?: 0
            it[INTIMACY_POINTS] = current + delta
        }
    }

    suspend fun setAtriAvatarPath(path: String) {
        dataStore.edit { it[ATRI_AVATAR_PATH] = path }
    }

    suspend fun clearAtriAvatar() {
        dataStore.edit { it.remove(ATRI_AVATAR_PATH) }
    }

    suspend fun setLastConversationDate(date: String) {
        dataStore.edit { it[LAST_CHAT_DATE] = date }
    }

    suspend fun setHistoryDedupeDone(done: Boolean) {
        dataStore.edit { it[HISTORY_DEDUPE_DONE] = done }
    }
}
