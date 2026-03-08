package com.puppetcat.knowledgehabitoverlay.overlay

import android.content.Context
import androidx.core.content.edit

class OverlayTimerStore(context: Context) {
  private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  fun read(): TimerSnapshot {
    return TimerSnapshot(
      elapsedMs = prefs.getLong(KEY_ELAPSED_MS, 0L),
      startedAtMs = prefs.getLong(KEY_STARTED_AT_MS, -1L).takeIf { it >= 0L },
      running = prefs.getBoolean(KEY_RUNNING, false),
      action = prefs.getString(KEY_ACTION, "") ?: "",
      overlayX = prefs.getInt(KEY_OVERLAY_X, DEFAULT_X),
      overlayY = prefs.getInt(KEY_OVERLAY_Y, DEFAULT_Y),
      expanded = prefs.getBoolean(KEY_EXPANDED, false)
    )
  }

  fun setAction(action: String) {
    prefs.edit { putString(KEY_ACTION, action.trim()) }
  }

  fun start(nowMs: Long = System.currentTimeMillis()) {
    val snapshot = read()
    if (snapshot.running) {
      return
    }
    prefs.edit {
      putBoolean(KEY_RUNNING, true)
      putLong(KEY_STARTED_AT_MS, nowMs)
    }
  }

  fun pause(nowMs: Long = System.currentTimeMillis()) {
    val snapshot = read()
    if (!snapshot.running || snapshot.startedAtMs == null) {
      return
    }
    val elapsed = snapshot.elapsedMs + (nowMs - snapshot.startedAtMs)
    prefs.edit {
      putBoolean(KEY_RUNNING, false)
      putLong(KEY_ELAPSED_MS, elapsed)
      remove(KEY_STARTED_AT_MS)
    }
  }

  fun reset() {
    prefs.edit {
      putBoolean(KEY_RUNNING, false)
      putLong(KEY_ELAPSED_MS, 0L)
      remove(KEY_STARTED_AT_MS)
    }
  }

  fun setOverlayPosition(x: Int, y: Int) {
    prefs.edit {
      putInt(KEY_OVERLAY_X, x)
      putInt(KEY_OVERLAY_Y, y)
    }
  }

  fun setExpanded(expanded: Boolean) {
    prefs.edit { putBoolean(KEY_EXPANDED, expanded) }
  }

  companion object {
    private const val PREFS_NAME = "overlay-timer"
    private const val KEY_ELAPSED_MS = "elapsed_ms"
    private const val KEY_STARTED_AT_MS = "started_at_ms"
    private const val KEY_RUNNING = "running"
    private const val KEY_ACTION = "action"
    private const val KEY_OVERLAY_X = "overlay_x"
    private const val KEY_OVERLAY_Y = "overlay_y"
    private const val KEY_EXPANDED = "expanded"

    private const val DEFAULT_X = 32
    private const val DEFAULT_Y = 180
  }
}
