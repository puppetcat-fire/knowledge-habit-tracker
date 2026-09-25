package com.puppetcat.knowledgehabitoverlay.forest

import android.content.Context
import androidx.core.content.edit
import org.json.JSONArray
import org.json.JSONObject

data class LightUp(
  val nodeId: String,
  val tutorialId: String?,
  val detail: String,
  val timestamp: Long
)

class ForestStore(context: Context) {
  private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  fun readLightUps(): List<LightUp> {
    val raw = prefs.getString(KEY_LIGHTUPS, "[]") ?: "[]"
    val arr = JSONArray(raw)
    return (0 until arr.length()).map { i ->
      val o = arr.getJSONObject(i)
      LightUp(
        nodeId = o.getString("nodeId"),
        tutorialId = o.optString("tutorialId").takeIf { it.isNotBlank() },
        detail = o.optString("detail", ""),
        timestamp = o.getLong("timestamp")
      )
    }
  }

  fun litNodeIds(): Set<String> = readLightUps().map { it.nodeId }.toSet()

  fun isLit(nodeId: String): Boolean = litNodeIds().contains(nodeId)

  fun addLightUp(nodeId: String, tutorialId: String? = null, detail: String = "自证点亮") {
    val list = readLightUps().toMutableList()
    list.add(LightUp(nodeId, tutorialId, detail, System.currentTimeMillis()))
    val arr = JSONArray()
    list.forEach { lu ->
      arr.put(
        JSONObject().apply {
          put("nodeId", lu.nodeId)
          lu.tutorialId?.let { put("tutorialId", it) }
          put("detail", lu.detail)
          put("timestamp", lu.timestamp)
        }
      )
    }
    prefs.edit { putString(KEY_LIGHTUPS, arr.toString()) }
  }

  companion object {
    private const val PREFS_NAME = "forest"
    private const val KEY_LIGHTUPS = "lightups"
  }
}
