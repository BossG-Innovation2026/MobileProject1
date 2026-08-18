package com.cabiaoshs.attendance.device

import android.app.KeyguardManager
import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators

enum class LockType {
    NONE, DEVICE_CREDENTIAL, BIOMETRIC, MULTI
}

object SecurityManager {

    /** Detects what screen-lock security the phone currently has. */
    fun lockType(context: Context): LockType {
        val keyguard = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        val deviceSecure = keyguard.isDeviceSecure

        val canUseBiometric = when (
            BiometricManager.from(context).canAuthenticate(
                Authenticators.BIOMETRIC_STRONG or Authenticators.BIOMETRIC_WEAK
            )
        ) {
            BiometricManager.BIOMETRIC_SUCCESS -> true
            else -> false
        }

        return when {
            canUseBiometric && deviceSecure -> LockType.MULTI
            canUseBiometric -> LockType.BIOMETRIC
            deviceSecure -> LockType.DEVICE_CREDENTIAL
            else -> LockType.NONE
        }
    }

    /** Human-readable description of the detected lock. */
    fun describeLock(lockType: LockType): String = when (lockType) {
        LockType.NONE -> "No screen lock set"
        LockType.DEVICE_CREDENTIAL -> "PIN / Pattern / Password"
        LockType.BIOMETRIC -> "Biometric (fingerprint / face)"
        LockType.MULTI -> "Biometric + PIN fallback"
    }
}