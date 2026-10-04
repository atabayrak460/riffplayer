package com.riffplayer.app

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import com.ryanheise.audioservice.AudioServiceActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * Besides hosting Flutter, this exposes where the phone's sound currently comes out (speaker,
 * Bluetooth, headphones, …) to Dart, and opens the system's output switcher — Android lets only the
 * system connect or switch Bluetooth outputs, so the app shows the current one and hands over to it.
 */
class MainActivity : AudioServiceActivity() {
    private var channel: MethodChannel? = null
    private var deviceCallback: AudioDeviceCallback? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val ch = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL)
        channel = ch
        ch.setMethodCallHandler { call, result ->
            when (call.method) {
                "currentOutput" -> result.success(currentOutput())
                "openSwitcher" -> result.success(openSwitcher())
                "requestBluetoothPermission" -> {
                    requestBluetoothPermission()
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }

        // Tell Dart when a Bluetooth / wired device appears or goes away.
        val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val callback = object : AudioDeviceCallback() {
            override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>?) = notifyChanged()
            override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) = notifyChanged()
        }
        deviceCallback = callback
        audioManager.registerAudioDeviceCallback(callback, Handler(Looper.getMainLooper()))
    }

    override fun onDestroy() {
        val callback = deviceCallback
        if (callback != null) {
            (getSystemService(Context.AUDIO_SERVICE) as AudioManager).unregisterAudioDeviceCallback(callback)
        }
        deviceCallback = null
        channel?.setMethodCallHandler(null)
        super.onDestroy()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PERMISSION_REQUEST) notifyChanged() // names are readable now
    }

    private fun notifyChanged() {
        channel?.invokeMethod("outputChanged", currentOutput())
    }

    private fun hasBluetoothPermission(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

    private fun requestBluetoothPermission() {
        if (!hasBluetoothPermission()) {
            requestPermissions(arrayOf(Manifest.permission.BLUETOOTH_CONNECT), PERMISSION_REQUEST)
        }
    }

    /** {label: String?, needsPermission: Boolean}; label is null when the sound comes out of the phone itself. */
    private fun currentOutput(): Map<String, Any?> {
        val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val devices: List<AudioDeviceInfo> =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                // Android 13+: the devices media would really be routed to right now.
                val attrs = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).build()
                audioManager.getAudioDevicesForAttributes(attrs)
            } else {
                audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).toList()
            }
        // Earlier APIs list everything connected, so prefer the external ones in a fixed order.
        val order = listOf(
            AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
            AudioDeviceInfo.TYPE_BLE_HEADSET,
            AudioDeviceInfo.TYPE_BLE_SPEAKER,
            AudioDeviceInfo.TYPE_USB_HEADSET,
            AudioDeviceInfo.TYPE_USB_DEVICE,
            AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
            AudioDeviceInfo.TYPE_WIRED_HEADSET,
            AudioDeviceInfo.TYPE_HDMI,
        )
        val device = order.firstNotNullOfOrNull { type -> devices.firstOrNull { it.type == type } }
            ?: return mapOf("label" to null, "needsPermission" to false)

        val bluetooth = device.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
            device.type == AudioDeviceInfo.TYPE_BLE_HEADSET || device.type == AudioDeviceInfo.TYPE_BLE_SPEAKER
        val name = device.productName?.toString()?.trim().orEmpty()
        val needsPermission = bluetooth && !hasBluetoothPermission()
        val label = when {
            bluetooth -> if (name.isNotEmpty() && !needsPermission) "Bluetooth: $name" else "Bluetooth speaker"
            device.type == AudioDeviceInfo.TYPE_HDMI -> "HDMI"
            device.type == AudioDeviceInfo.TYPE_USB_HEADSET || device.type == AudioDeviceInfo.TYPE_USB_DEVICE ->
                if (name.isNotEmpty()) "USB: $name" else "USB audio"
            else -> "Headphones"
        }
        return mapOf("label" to label, "needsPermission" to needsPermission)
    }

    /** The system's media-output switcher where there is one, else the Bluetooth settings. */
    private fun openSwitcher(): Boolean {
        val attempts = listOf(
            Intent("com.android.settings.panel.action.MEDIA_OUTPUT")
                .putExtra("com.android.settings.panel.extra.PACKAGE_NAME", packageName),
            Intent(Settings.ACTION_BLUETOOTH_SETTINGS),
        )
        for (intent in attempts) {
            try {
                startActivity(intent)
                return true
            } catch (_: Exception) {
                // try the next one
            }
        }
        return false
    }

    companion object {
        private const val CHANNEL = "com.riffplayer.app/audio_output"
        private const val PERMISSION_REQUEST = 4711
    }
}
