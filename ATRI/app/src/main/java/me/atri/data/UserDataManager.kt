package me.atri.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import me.atri.data.datastore.PreferencesStore
import me.atri.data.db.AtriDatabase

class UserDataManager(
    private val database: AtriDatabase,
    private val preferencesStore: PreferencesStore
) {
    suspend fun clearLocalDataAndResetUser(): String {
        withContext(Dispatchers.IO) {
            database.clearAllTables()
        }
        return preferencesStore.resetUserId()
    }
}
