package me.atri.data.api.response

import kotlinx.serialization.Serializable

/**
 * 服务器返回的“她现在是什么样子”——对应 worker 端 self_model 字段。
 *
 * 字段全部置为可空以容错：worker 实现尚不稳定时，前端走错误分支，
 * 给出“她现在不想被人看”的温柔提示。
 */
@Serializable
data class SelfModelResponse(
    val coreTraits: List<String>? = null,
    val speechStyle: List<String>? = null,
    val relationshipStance: String? = null,
    val emotionalBaseline: String? = null,
    val recentChanges: List<String>? = null,
    val taboos: List<String>? = null,
    val updatedAt: Long? = null
)
