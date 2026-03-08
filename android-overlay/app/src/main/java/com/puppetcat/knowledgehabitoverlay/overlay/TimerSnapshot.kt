package com.puppetcat.knowledgehabitoverlay.overlay

data class TimerSnapshot(
  val elapsedMs: Long,
  val startedAtMs: Long?,
  val running: Boolean,
  val action: String,
  val overlayX: Int,
  val overlayY: Int,
  val expanded: Boolean
) {
  fun currentElapsedMs(nowMs: Long = System.currentTimeMillis()): Long {
    return if (running && startedAtMs != null) {
      elapsedMs + (nowMs - startedAtMs)
    } else {
      elapsedMs
    }
  }
}
