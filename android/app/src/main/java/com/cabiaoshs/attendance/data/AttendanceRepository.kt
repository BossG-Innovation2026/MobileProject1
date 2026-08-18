package com.cabiaoshs.attendance.data

import com.cabiaoshs.attendance.BuildConfig
import io.github.jan_tennert.supabase.SupabaseClient
import io.github.jan_tennert.supabase.auth.providers.Email
import io.github.jan_tennert.supabase.postgrest.decodeAs
import io.github.jan_tennert.supabase.postgrest.decodeList
import io.github.jan_tennert.supabase.postgrest.decodeSingle
import io.github.jan_tennert.supabase.postgrest.from
import io.github.jan_tennert.supabase.postgrest.query.Order
import io.github.jan_tennert.supabase.postgrest.rpc
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Serializable
data class CheckResult(
    val id: String,
    @SerialName("check_type") val checkType: String,
    @SerialName("checked_at") val checkedAt: String,
    @SerialName("distance_m") val distanceM: Double? = null,
)

@Serializable
data class AttendanceRecord(
    val id: String,
    @SerialName("check_type") val checkType: String,
    @SerialName("checked_at") val checkedAt: String,
    @SerialName("distance_m") val distanceM: Double? = null,
    val note: String? = null,
)

@Serializable
data class EmployeeProfile(
    @SerialName("full_name") val fullName: String,
)

@Serializable
data class DeviceBinding(
    @SerialName("device_name") val deviceName: String? = null,
    @SerialName("android_id") val androidId: String,
    @SerialName("bound_at") val boundAt: String,
)

class AttendanceRepository(private val client: SupabaseClient) {

    suspend fun isLoggedIn(): Boolean = client.auth.currentSessionOrNull != null

    suspend fun currentUserId(): String? = client.auth.currentUserOrNull?.id

    suspend fun login(email: String, password: String) {
        client.auth.signInWith(Email) {
            this.email = email.trim()
            this.password = password
        }
    }

    suspend fun logout() = client.auth.signOut()

    suspend fun myProfile(): EmployeeProfile =
        client.postgrest.from("employees")
            .select { filter { eq("id", client.auth.currentUserOrNull!!.id) } }
            .decodeSingle<EmployeeProfile>()

    suspend fun myBoundDevice(): DeviceBinding? = try {
        client.postgrest.from("devices")
            .select { filter { eq("employee_id", client.auth.currentUserOrNull!!.id) } }
            .decodeSingle<DeviceBinding>()
    } catch (e: Exception) {
        null
    }

    suspend fun recentRecords(limit: Int = 30): List<AttendanceRecord> =
        client.postgrest.from("attendance")
            .select {
                filter { eq("employee_id", client.auth.currentUserOrNull!!.id) }
                order("checked_at", Order.DESCENDING)
                limit(limit)
            }
            .decodeList<AttendanceRecord>()

    suspend fun checkIn(
        lat: Double,
        lng: Double,
        accuracy: Float,
        androidId: String,
        deviceName: String,
        biometric: Boolean,
    ): CheckResult = rpc("check_in", lat, lng, accuracy, androidId, deviceName, biometric)

    suspend fun checkOut(
        lat: Double,
        lng: Double,
        accuracy: Float,
        androidId: String,
        deviceName: String,
        biometric: Boolean,
    ): CheckResult = rpc("check_out", lat, lng, accuracy, androidId, deviceName, biometric)

    private suspend fun rpc(
        function: String,
        lat: Double,
        lng: Double,
        accuracy: Float,
        androidId: String,
        deviceName: String,
        biometric: Boolean,
    ): CheckResult =
        client.postgrest.rpc(
            function = function,
            parameters = buildJsonObject {
                put("p_lat", lat)
                put("p_lng", lng)
                put("p_accuracy", accuracy.toDouble())
                put("p_android_id", androidId)
                put("p_device_name", deviceName)
                put("p_biometric", biometric)
            }
        ).decodeAs<CheckResult>()
}

/** True when the Supabase project credentials were filled in. */
fun isSupabaseConfigured(): Boolean =
    BuildConfig.SUPABASE_URL.isNotBlank() && BuildConfig.SUPABASE_ANON_KEY.isNotBlank()