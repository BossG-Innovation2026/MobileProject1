package com.cabiaoshs.attendance.data

import com.cabiaoshs.attendance.BuildConfig
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

@Serializable
data class CheckResult(
    val id: String,
    @SerialName("check_type") val checkType: String,
    @SerialName("checked_at") val checkedAt: String,
    @SerialName("distance_m") val distanceM: Double? = null,
    val mode: String? = null,
)

@Serializable
data class AttendanceRecord(
    val id: String,
    @SerialName("check_type") val checkType: String,
    @SerialName("checked_at") val checkedAt: String,
    @SerialName("distance_m") val distanceM: Double? = null,
    val mode: String? = null,
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
    @SerialName("bound_at") val boundAt: String? = null,
)

@Serializable
data class DeviceOwner(
    @SerialName("employee_id") val employeeId: String,
    @SerialName("full_name") val fullName: String,
)

class AttendanceRepository(private val client: SupabaseClient) {

    suspend fun isLoggedIn(): Boolean = client.auth.currentSessionOrNull() != null

    suspend fun currentUserId(): String? = client.auth.currentUserOrNull()?.id

    suspend fun login(employeeId: String) {
        // The 7-digit employee ID is also the auth password. Resolve it to
        // the email first (login runs before any session exists, so a direct
        // employees query is invisible).
        val resolved: Map<String, String> = client.postgrest.rpc(
            "resolve_login",
            buildJsonObject { put("p_employee_id", employeeId) }
        )
        val email = resolved["email"] ?: throw IllegalStateException("employee_not_found")
        client.auth.signInWith(Email) {
            this.email = email
            this.password = employeeId
        }
    }

    suspend fun bindThisDevice(androidId: String, deviceName: String) {
        client.postgrest.rpc(
            "resolve_device",
            buildJsonObject {
                put("p_employee_id", client.auth.currentUserOrNull()!!.id)
                put("p_android_id", androidId)
                put("p_device_name", deviceName)
            }
        )
    }

    suspend fun logout() = client.auth.signOut()

    suspend fun myProfile(): EmployeeProfile =
        client.postgrest.from("employees")
            .select { filter { eq("id", client.auth.currentUserOrNull()!!.id) } }
            .decodeSingle<EmployeeProfile>()

    suspend fun myBoundDevices(): List<DeviceBinding> = try {
        client.postgrest.from("devices")
            .select {
                filter { eq("employee_id", client.auth.currentUserOrNull()!!.id) }
                order("bound_at", Order.DESCENDING)
            }
            .decodeList<DeviceBinding>()
    } catch (e: Exception) {
        emptyList()
    }

    /** Raw value of a settings row (e.g. max_devices_per_account). Null when missing. */
    suspend fun setting(key: String): String? = try {
        client.postgrest.from("settings")
            .select { filter { eq("key", key) } }
            .decodeSingle<JsonElement>()
            .jsonObject["value"]
            ?.jsonPrimitive
            ?.contentOrNull
    } catch (e: Exception) {
        null
    }

    /** Which account (if any) currently owns the given phone. Null when unbound. */
    suspend fun deviceOwner(androidId: String): DeviceOwner? = try {
        client.postgrest.rpc(
            function = "device_owner",
            parameters = buildJsonObject { put("p_android_id", androidId) }
        ).decodeSingle<DeviceOwner>()
    } catch (e: Exception) {
        null
    }

    suspend fun recentRecords(limit: Int = 30): List<AttendanceRecord> =
        client.postgrest.from("attendance")
            .select {
                filter { eq("employee_id", client.auth.currentUserOrNull()!!.id) }
                order("checked_at", Order.DESCENDING)
                limit(limit.toLong())
            }
            .decodeList<AttendanceRecord>()

    suspend fun checkIn(
        lat: Double,
        lng: Double,
        accuracy: Float,
        androidId: String,
        deviceName: String,
        biometric: Boolean,
        mode: String,
        checkedAt: String,
        note: String,
    ): CheckResult =
        rpc("check_in", lat, lng, accuracy, androidId, deviceName, biometric, mode, checkedAt, note)

    suspend fun checkOut(
        lat: Double,
        lng: Double,
        accuracy: Float,
        androidId: String,
        deviceName: String,
        biometric: Boolean,
        mode: String,
        checkedAt: String,
        note: String,
    ): CheckResult =
        rpc("check_out", lat, lng, accuracy, androidId, deviceName, biometric, mode, checkedAt, note)

    private suspend fun rpc(
        function: String,
        lat: Double,
        lng: Double,
        accuracy: Float,
        androidId: String,
        deviceName: String,
        biometric: Boolean,
        mode: String,
        checkedAt: String,
        note: String,
    ): CheckResult {
        val params = buildJsonObject {
            put("p_lat", lat)
            put("p_lng", lng)
            put("p_accuracy", accuracy.toDouble())
            put("p_android_id", androidId)
            put("p_device_name", deviceName)
            put("p_biometric", biometric)
            put("p_mode", mode)
            put("p_checked_at", checkedAt)
            put("p_note", note)
        }
        return try {
            client.postgrest.rpc(function = function, parameters = params).decodeAs<CheckResult>()
        } catch (e: Exception) {
            android.util.Log.w("Attendance", "rpc $function failed", e)
            throw e
        }
    }
}

/** True when the Supabase project credentials were filled in. */
fun isSupabaseConfigured(): Boolean =
    BuildConfig.SUPABASE_URL.isNotBlank() && BuildConfig.SUPABASE_ANON_KEY.isNotBlank()