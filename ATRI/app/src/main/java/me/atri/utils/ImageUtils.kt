package me.atri.utils

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.core.net.toUri
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

object ImageUtils {
    
    fun Context.compressImage(
        uri: Uri,
        maxWidth: Int = 1024,
        maxHeight: Int = 1024,
        quality: Int = 85
    ): Uri? {
        return try {
            val inputStream = contentResolver.openInputStream(uri) ?: return null
            val originalBitmap = BitmapFactory.decodeStream(inputStream)
            inputStream.close()

            val scaledBitmap = scaleBitmap(originalBitmap, maxWidth, maxHeight)
            
            val compressedFile = File(cacheDir, "compressed_${UUID.randomUUID()}.jpg")
            FileOutputStream(compressedFile).use { out ->
                scaledBitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)
            }
            
            originalBitmap.recycle()
            scaledBitmap.recycle()
            
            compressedFile.toUri()
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }

    private fun scaleBitmap(bitmap: Bitmap, maxWidth: Int, maxHeight: Int): Bitmap {
        val width = bitmap.width
        val height = bitmap.height

        if (width <= maxWidth && height <= maxHeight) {
            return bitmap
        }

        val ratio = minOf(
            maxWidth.toFloat() / width,
            maxHeight.toFloat() / height
        )

        val newWidth = (width * ratio).toInt()
        val newHeight = (height * ratio).toInt()

        return Bitmap.createScaledBitmap(bitmap, newWidth, newHeight, true)
    }

    fun Context.clearCompressedImages() {
        cacheDir.listFiles { file ->
            file.name.startsWith("compressed_")
        }?.forEach { it.delete() }
    }
}
