package com.puppetcat.knowledgehabitoverlay

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.material.button.MaterialButton
import com.puppetcat.knowledgehabitoverlay.overlay.OverlayTimerService
import com.puppetcat.knowledgehabitoverlay.overlay.OverlayTimerStore

class MainActivity : AppCompatActivity() {
  private lateinit var store: OverlayTimerStore
  private val handler = Handler(Looper.getMainLooper())
  private val ticker = object : Runnable {
    override fun run() {
      render()
      handler.postDelayed(this, 250L)
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(R.layout.activity_main)

    store = OverlayTimerStore(this)
    requestNotificationPermissionIfNeeded()
    bindActions()
  }

  override fun onStart() {
    super.onStart()
    render()
    handler.post(ticker)
  }

  override fun onStop() {
    handler.removeCallbacksAndMessages(null)
    super.onStop()
  }

  override fun onResume() {
    super.onResume()
    render()
  }

  private fun bindActions() {
    findViewById<MaterialButton>(R.id.permissionButton).setOnClickListener {
      openOverlayPermissionSettings()
    }

    findViewById<MaterialButton>(R.id.startOverlayButton).setOnClickListener {
      val actionText = findViewById<EditText>(R.id.actionInput).text?.toString().orEmpty()
      store.setAction(actionText)
      if (!Settings.canDrawOverlays(this)) {
        openOverlayPermissionSettings()
        return@setOnClickListener
      }
      ContextCompat.startForegroundService(
        this,
        OverlayTimerService.createIntent(this, OverlayTimerService.ACTION_SHOW_OVERLAY)
      )
      render()
    }

    findViewById<MaterialButton>(R.id.stopOverlayButton).setOnClickListener {
      startService(OverlayTimerService.createIntent(this, OverlayTimerService.ACTION_STOP_OVERLAY))
    }

    findViewById<MaterialButton>(R.id.startTimerButton).setOnClickListener {
      val actionText = findViewById<EditText>(R.id.actionInput).text?.toString().orEmpty()
      store.setAction(actionText)
      startService(OverlayTimerService.createIntent(this, OverlayTimerService.ACTION_START_TIMER))
      render()
    }

    findViewById<MaterialButton>(R.id.pauseTimerButton).setOnClickListener {
      startService(OverlayTimerService.createIntent(this, OverlayTimerService.ACTION_PAUSE_TIMER))
      render()
    }

    findViewById<MaterialButton>(R.id.resetTimerButton).setOnClickListener {
      startService(OverlayTimerService.createIntent(this, OverlayTimerService.ACTION_RESET_TIMER))
      render()
    }
  }

  private fun render() {
    val snapshot = store.read()
    val elapsedMs = snapshot.currentElapsedMs()
    val timerText = findViewById<TextView>(R.id.timerText)
    val statusText = findViewById<TextView>(R.id.statusText)
    val actionInput = findViewById<EditText>(R.id.actionInput)

    timerText.text = formatDuration(elapsedMs)
    statusText.setText(
      when {
        snapshot.running -> R.string.timer_running
        elapsedMs > 0 -> R.string.timer_paused
        else -> R.string.timer_idle
      }
    )

    if (actionInput.hasFocus().not() && actionInput.text.isNullOrBlank() && snapshot.action.isNotBlank()) {
      actionInput.setText(snapshot.action)
      actionInput.setSelection(actionInput.text?.length ?: 0)
    }
  }

  private fun openOverlayPermissionSettings() {
    val intent = Intent(
      Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
      Uri.parse("package:$packageName")
    )
    startActivity(intent)
  }

  private fun requestNotificationPermissionIfNeeded() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      return
    }
    requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 100)
  }

  private fun formatDuration(ms: Long): String {
    val totalSeconds = ms / 1000L
    val hours = totalSeconds / 3600L
    val minutes = (totalSeconds % 3600L) / 60L
    val seconds = totalSeconds % 60L
    return listOf(hours, minutes, seconds).joinToString(":") { value ->
      value.toString().padStart(2, '0')
    }
  }
}
