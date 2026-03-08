package com.puppetcat.knowledgehabitoverlay.overlay

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import com.puppetcat.knowledgehabitoverlay.MainActivity
import com.puppetcat.knowledgehabitoverlay.R

class OverlayTimerService : Service() {
  private lateinit var windowManager: WindowManager
  private lateinit var store: OverlayTimerStore
  private var overlayView: View? = null
  private var layoutParams: WindowManager.LayoutParams? = null
  private val handler = Handler(Looper.getMainLooper())
  private val ticker = object : Runnable {
    override fun run() {
      updateOverlayUi()
      handler.postDelayed(this, 250L)
    }
  }

  override fun onCreate() {
    super.onCreate()
    store = OverlayTimerStore(this)
    windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    createNotificationChannel()
    startForeground(NOTIFICATION_ID, buildNotification())
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    handleIntent(intent)
    if (!Settings.canDrawOverlays(this)) {
      stopSelf()
      return START_NOT_STICKY
    }
    if (overlayView == null) {
      showOverlay()
    } else {
      updateOverlayUi()
    }
    return START_STICKY
  }

  override fun onDestroy() {
    handler.removeCallbacksAndMessages(null)
    removeOverlay()
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun handleIntent(intent: Intent?) {
    when (intent?.action) {
      ACTION_START_TIMER -> store.start()
      ACTION_PAUSE_TIMER -> store.pause()
      ACTION_RESET_TIMER -> store.reset()
      ACTION_STOP_OVERLAY -> {
        stopSelf()
        return
      }
      ACTION_UPDATE_ACTION -> store.setAction(intent.getStringExtra(EXTRA_ACTION_TEXT).orEmpty())
      ACTION_TOGGLE_EXPANDED -> {
        val nextExpanded = !store.read().expanded
        store.setExpanded(nextExpanded)
      }
      ACTION_SHOW_OVERLAY, null -> Unit
    }
  }

  private fun showOverlay() {
    val inflater = LayoutInflater.from(this)
    val view = inflater.inflate(R.layout.overlay_timer_view, null)
    val snapshot = store.read()

    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
      PixelFormat.TRANSLUCENT
    ).apply {
      x = snapshot.overlayX
      y = snapshot.overlayY
    }

    bindOverlayControls(view, params)
    windowManager.addView(view, params)
    overlayView = view
    layoutParams = params
    updateOverlayUi()
    handler.post(ticker)
  }

  private fun bindOverlayControls(view: View, params: WindowManager.LayoutParams) {
    view.findViewById<View>(R.id.expandToggle).setOnClickListener {
      handleIntent(Intent(ACTION_TOGGLE_EXPANDED))
      updateOverlayUi()
    }
    view.findViewById<View>(R.id.overlayStart).setOnClickListener {
      handleIntent(Intent(ACTION_START_TIMER))
      updateOverlayUi()
    }
    view.findViewById<View>(R.id.overlayPause).setOnClickListener {
      handleIntent(Intent(ACTION_PAUSE_TIMER))
      updateOverlayUi()
    }
    view.findViewById<View>(R.id.overlayReset).setOnClickListener {
      handleIntent(Intent(ACTION_RESET_TIMER))
      updateOverlayUi()
    }

    view.setOnTouchListener(object : View.OnTouchListener {
      private var startX = 0
      private var startY = 0
      private var rawStartX = 0f
      private var rawStartY = 0f

      override fun onTouch(v: View, event: MotionEvent): Boolean {
        when (event.action) {
          MotionEvent.ACTION_DOWN -> {
            startX = params.x
            startY = params.y
            rawStartX = event.rawX
            rawStartY = event.rawY
            return false
          }

          MotionEvent.ACTION_MOVE -> {
            params.x = startX + (event.rawX - rawStartX).toInt()
            params.y = startY + (event.rawY - rawStartY).toInt()
            windowManager.updateViewLayout(v, params)
            store.setOverlayPosition(params.x, params.y)
            return true
          }
        }
        return false
      }
    })
  }

  private fun updateOverlayUi() {
    val view = overlayView ?: return
    val snapshot = store.read()
    val elapsedMs = snapshot.currentElapsedMs()
    val running = snapshot.running

    view.findViewById<android.widget.TextView>(R.id.overlayTime).text = formatDuration(elapsedMs)
    view.findViewById<android.widget.TextView>(R.id.overlayStatusText).text =
      getString(
        if (running) R.string.timer_running else if (elapsedMs > 0) R.string.timer_paused else R.string.timer_idle
      )
    view.findViewById<android.widget.TextView>(R.id.overlayAction).text =
      if (snapshot.action.isBlank()) "当前动作：尚未开始" else "当前动作：${snapshot.action}"
    view.findViewById<android.widget.TextView>(R.id.expandToggle).text =
      getString(if (snapshot.expanded) R.string.overlay_collapse else R.string.overlay_expand)

    view.findViewById<View>(R.id.overlayControls).visibility =
      if (snapshot.expanded) View.VISIBLE else View.GONE
    view.findViewById<View>(R.id.overlayStatusDot).setBackgroundResource(
      if (running) R.drawable.bg_overlay_status_running else R.drawable.bg_overlay_status_idle
    )
  }

  private fun removeOverlay() {
    overlayView?.let { view ->
      runCatching {
        windowManager.removeView(view)
      }
    }
    overlayView = null
    layoutParams = null
  }

  private fun buildNotification(): Notification {
    val intent = Intent(this, MainActivity::class.java)
    val pendingIntent = PendingIntent.getActivity(
      this,
      0,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setContentTitle(getString(R.string.notification_title))
      .setContentText(getString(R.string.notification_text))
      .setContentIntent(pendingIntent)
      .setOngoing(true)
      .build()
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }
    val manager = getSystemService(NotificationManager::class.java)
    val channel = NotificationChannel(
      CHANNEL_ID,
      getString(R.string.notification_channel_name),
      NotificationManager.IMPORTANCE_LOW
    ).apply {
      description = getString(R.string.notification_channel_description)
    }
    manager.createNotificationChannel(channel)
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

  companion object {
    private const val CHANNEL_ID = "overlay_timer"
    private const val NOTIFICATION_ID = 1001

    const val ACTION_SHOW_OVERLAY = "overlay.show"
    const val ACTION_STOP_OVERLAY = "overlay.stop"
    const val ACTION_START_TIMER = "overlay.start_timer"
    const val ACTION_PAUSE_TIMER = "overlay.pause_timer"
    const val ACTION_RESET_TIMER = "overlay.reset_timer"
    const val ACTION_UPDATE_ACTION = "overlay.update_action"
    const val ACTION_TOGGLE_EXPANDED = "overlay.toggle_expanded"
    const val EXTRA_ACTION_TEXT = "action_text"

    fun createIntent(context: Context, action: String): Intent {
      return Intent(context, OverlayTimerService::class.java).setAction(action)
    }
  }
}
