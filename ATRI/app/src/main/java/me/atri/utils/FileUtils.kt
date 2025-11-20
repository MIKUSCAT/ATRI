package me.atri.utils

import android.content.Context
import android.net.Uri
import androidx.core.net.toFile
import androidx.core.net.toUri
import java.io.File
import java.util.UUID

object FileUtils {

    fun Context.createChatFilesByContents(uris: List<Uri>): List<Uri> {
        val newUris = mutableListOf<Uri>()
        val dir = this.filesDir.resolve("upload")
        if (!dir.exists()) {
            dir.mkdirs()
        }

        uris.forEach { uri ->
            val fileName = UUID.randomUUID().toString()
            val file = dir.resolve(fileName)

            runCatching {
                this.contentResolver.openInputStream(uri)?.use { inputStream ->
                    file.outputStream().use { outputStream ->
                        inputStream.copyTo(outputStream)
                    }
                }
                newUris.add(file.toUri())
            }.onFailure {
                it.printStackTrace()
            }
        }

        return newUris
    }

    fun Context.deleteChatFiles(uris: List<Uri>) {
        uris.filter { it.toString().startsWith("file:") }.forEach { uri ->
            val file = uri.toFile()
            if (file.exists()) {
                file.delete()
            }
        }
    }

    fun Context.deleteAllChatFiles() {
        val dir = this.filesDir.resolve("upload")
        if (dir.exists()) {
            dir.deleteRecursively()
        }
    }

    fun Context.getChatFilesCount(): Pair<Int, Long> {
        val dir = filesDir.resolve("upload")
        if (!dir.exists()) {
            return Pair(0, 0)
        }
        val files = dir.listFiles() ?: return Pair(0, 0)
        val count = files.size
        val size = files.sumOf { it.length() }
        return Pair(count, size)
    }

    fun Context.saveAtriAvatar(source: Uri): String? {
        val targetDir = filesDir.resolve("atri").apply { if (!exists()) mkdirs() }
        val targetFile = targetDir.resolve("avatar.jpg")
        return runCatching {
            contentResolver.openInputStream(source)?.use { input ->
                targetFile.outputStream().use { output ->
                    input.copyTo(output)
                }
            } ?: error("无法读取头像文件")
            targetFile.absolutePath
        }.getOrNull()
    }
}
