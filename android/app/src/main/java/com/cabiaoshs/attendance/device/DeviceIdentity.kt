package com.cabiaoshs.attendance.device

import android.content.Context
import android.os.Build
import android.provider.Settings

object DeviceIdentity {

    /** Stable per-phone ID used for device binding. Resets on factory reset. */
    fun androidId(context: Context): String =
        Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID) ?: ""

    fun deviceName(context: Context): String =
        "${Build.MANUFACTURER} ${Build.MODEL}".trim()

    /** True if the user enabled "Allow mock locations" in developer options. */
    fun isMockLocationAllowed(context: Context): Boolean =
        Settings.Secure.getInt(context.contentResolver, Settings.Secure.ALLOW_MOCK_LOCATION, 0) == 1
}