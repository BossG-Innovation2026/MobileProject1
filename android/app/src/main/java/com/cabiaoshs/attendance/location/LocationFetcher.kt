package com.cabiaoshs.attendance.location

import android.content.Context
import android.location.Location
import com.cabiaoshs.attendance.device.DeviceIdentity
import com.google.android.gms.location.Priority
import com.google.android.gms.location.LocationServices
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

class LocationException(message: String) : Exception(message)

/**
 * Fetches a high-accuracy GPS fix and rejects weak or spoofed fixes:
 *  - accuracy must be within [maxAccuracyMeters]
 *  - mock-location (fake GPS) fixes are rejected
 *  - a bogus 0,0 fix is rejected
 */
class LocationFetcher(private val context: Context) {

    private val fused = LocationServices.getFusedLocationProviderClient(context)

    suspend fun fetchValid(
        maxAccuracyMeters: Float = 30f,
        attempts: Int = 5
    ): Location {
        val token = CancellationTokenSource()
        var last: Location? = null

        repeat(attempts) {
            val fix = getCurrentFix(token)
            if (fix != null) {
                last = fix
                if (fix.isTrustworthy(context) && fix.accuracy > 0f && fix.accuracy <= maxAccuracyMeters) {
                    return fix
                }
            }
            delay(1500)
        }

        val best = last
        if (best != null && best.accuracy > 0f && best.accuracy <= maxAccuracyMeters) {
            throw LocationException("Suspicious location fix rejected. Disable mock locations and try again.")
        }
        if (best != null && best.accuracy > maxAccuracyMeters) {
            throw LocationException(
                "GPS signal too weak (accuracy ${best.accuracy.toInt()}m, need ≤ ${maxAccuracyMeters.toInt()}m). " +
                    "Move to an open area and try again."
            )
        }
        throw LocationException("Could not get a GPS fix. Check that location is enabled and try again.")
    }

    private suspend fun getCurrentFix(token: CancellationTokenSource): Location? =
        suspendCancellableCoroutine { cont ->
            fused.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, token.token)
                .addOnSuccessListener { cont.resume(it) }
                .addOnFailureListener { cont.resume(null) }
        }

    private fun Location.isTrustworthy(context: Context): Boolean {
        if (latitude == 0.0 && longitude == 0.0) return false
        // isFromMockProvider is deprecated on newer APIs but still catches
        // the common spoofing apps; ALLOW_MOCK_LOCATION is the developer-options flag.
        @Suppress("DEPRECATION")
        if (isFromMockProvider) return false
        if (DeviceIdentity.isMockLocationAllowed(context)) return false
        return true
    }
}