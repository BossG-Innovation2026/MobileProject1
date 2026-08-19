package com.cabiaoshs.attendance.ui

import android.app.Application
import android.content.Context
import android.location.LocationManager
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.cabiaoshs.attendance.data.AttendanceRepository
import com.cabiaoshs.attendance.data.DeviceBinding
import com.cabiaoshs.attendance.data.SupabaseHolder
import com.cabiaoshs.attendance.data.isSupabaseConfigured
import com.cabiaoshs.attendance.device.DeviceIdentity
import com.cabiaoshs.attendance.device.LockType
import com.cabiaoshs.attendance.device.SecurityManager
import com.cabiaoshs.attendance.location.LocationFetcher
import io.github.jan.supabase.exceptions.HttpRequestException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

enum class CheckType(val code: String) { IN("in"), OUT("out") }

enum class GpsStatus { GOOD, WEAK, NONE }

sealed interface UiState {
    data object Loading : UiState
    data object ConfigError : UiState
    data class LockRequired(val lockType: LockType) : UiState
    data class LoginRequired(val error: String? = null) : UiState
    data class BindDevice(
        val message: String? = null,
        val busy: Boolean = false,
    ) : UiState
    data class Home(
        val fullName: String,
        val checkedIn: Boolean,
        val lastIn: String? = null,
        val lastOut: String? = null,
        val boundDevice: String? = null,
        val boundDevices: List<DeviceBinding> = emptyList(),
        val maxDevices: Int = 2,
        val gpsStatus: GpsStatus = GpsStatus.NONE,
        val pendingCount: Int = 0,
        val lastSyncAt: String? = null,
        val busy: Boolean = false,
        val busyLabel: String? = null,
        val message: String? = null,
        val messageIsError: Boolean = true,
    ) : UiState
}

/** What to send to the server for one check-in/out attempt. */
data class PendingCheckRequest(val type: CheckType, val mode: String, val note: String)

/** A check-in/out captured offline, waiting to sync. */
private data class PendingCheckEntry(
    val checkType: String,
    val lat: Double,
    val lng: Double,
    val accuracy: Float,
    val checkedAt: String,
    val mode: String,
    val note: String,
)

class AppViewModel(app: Application) : AndroidViewModel(app) {

    private val context: Context get() = getApplication()

    private val prefs = context.getSharedPreferences("attendance", Context.MODE_PRIVATE)
    private val repo: AttendanceRepository
        get() = AttendanceRepository(SupabaseHolder.supabase.client)

    private val _state = MutableStateFlow<UiState>(UiState.Loading)
    val state: StateFlow<UiState> = _state.asStateFlow()

    /** Non-null while a biometric prompt should be shown. */
    private val _pendingBiometric = MutableStateFlow<PendingCheckRequest?>(null)
    val pendingBiometric: StateFlow<PendingCheckRequest?> = _pendingBiometric.asStateFlow()

    private val timeFormat = DateTimeFormatter.ofPattern("h:mm a")

    private var gpsJob: Job? = null

    /** Formats a server ISO timestamp (UTC) in the device's local time zone. */
    private fun formatLocal(iso: String): String =
        runCatching {
            timeFormat.format(OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.systemDefault()))
        }.getOrDefault(iso)

    /** Periodically reads the GPS status while the Home screen is shown. */
    fun startGpsMonitor() {
        if (gpsJob?.isActive == true) return
        gpsJob = viewModelScope.launch {
            while (isActive) {
                refreshGps()
                delay(10_000)
            }
        }
    }

    /** One immediate GPS status read (also used by the indicator tap). */
    fun refreshGps() {
        viewModelScope.launch {
            val current = _state.value as? UiState.Home ?: return@launch
            _state.value = current.copy(gpsStatus = readGpsStatus())
        }
    }

    private suspend fun readGpsStatus(): GpsStatus {
        val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
            ?: return GpsStatus.NONE
        if (!lm.isLocationEnabled) return GpsStatus.NONE
        return withTimeoutOrNull(5000) {
            try {
                val fix = LocationFetcher(context).fetchValid(maxAccuracyMeters = 80f, attempts = 1)
                if (fix.accuracy <= 30f) GpsStatus.GOOD else GpsStatus.WEAK
            } catch (e: Exception) {
                GpsStatus.NONE
            }
        } ?: GpsStatus.NONE
    }

    override fun onCleared() {
        gpsJob?.cancel()
        super.onCleared()
    }

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            try {
                if (!isSupabaseConfigured()) {
                    _state.value = UiState.ConfigError
                    return@launch
                }
                val lock = SecurityManager.lockType(context)
                if (lock == LockType.NONE) {
                    _state.value = UiState.LockRequired(lock)
                    return@launch
                }
                if (repo.isLoggedIn()) {
                    loadHome()
                    syncPending()
                } else {
                    _state.value = UiState.LoginRequired()
                }
            } catch (e: Exception) {
                _state.value = UiState.LoginRequired()
            }
        }
    }

    fun login(employeeId: String) {
        if (_state.value !is UiState.LoginRequired) return
        viewModelScope.launch {
            _state.value = UiState.Loading
            try {
                repo.login(employeeId)
                val devices = repo.myBoundDevices()
                if (devices.isEmpty()) {
                    _state.value = UiState.BindDevice()
                } else {
                    loadHome()
                    syncPending()
                }
            } catch (e: Exception) {
                android.util.Log.w("Attendance", "login failed", e)
                _state.value = UiState.LoginRequired("Invalid employee ID.")
            }
        }
    }

    /** First-login device binding: binds this phone, then opens Home. */
    fun bindDevice() {
        if (_state.value !is UiState.BindDevice) return
        viewModelScope.launch {
            _state.value = UiState.BindDevice(busy = true)
            try {
                repo.bindThisDevice(
                    androidId = DeviceIdentity.androidId(context),
                    deviceName = DeviceIdentity.deviceName(context),
                )
                loadHome()
                syncPending()
            } catch (e: Exception) {
                val friendly = when {
                    e.message?.contains("max_devices_reached") == true ->
                        "This account already has its maximum devices bound. Ask the school admin to release a phone."
                    e.message?.contains("device_bound_to_other_account") == true ->
                        "This phone is already bound to another account."
                    else -> "Could not bind this device. Try again."
                }
                _state.value = UiState.BindDevice(message = friendly)
            }
        }
    }

    fun logout() {
        gpsJob?.cancel()
        viewModelScope.launch {
            try {
                repo.logout()
            } catch (_: Exception) {
            }
            _state.value = UiState.LoginRequired()
        }
    }

    fun onCheckIn(mode: String, note: String) = beginCheck(CheckType.IN, mode, note)

    fun onCheckOut(mode: String, note: String) = beginCheck(CheckType.OUT, mode, note)

    /** Biometric succeeded (or was skipped); proceed with the pending check. */
    fun proceedAfterBiometric(success: Boolean) {
        val request = _pendingBiometric.value ?: return
        _pendingBiometric.value = null
        if (!success) return
        viewModelScope.launch { performCheck(request) }
    }

    fun onBiometricCancel() {
        if (_pendingBiometric.value != null) {
            _pendingBiometric.value = null
            val current = _state.value as? UiState.Home
            if (current != null) {
                _state.value = current.copy(message = "Verification cancelled.", messageIsError = false)
            }
        }
    }

    private fun beginCheck(type: CheckType, mode: String, note: String) {
        val current = _state.value as? UiState.Home ?: return
        if (current.busy) return
        val request = PendingCheckRequest(type, mode, note.trim())
        val biometricRequired = prefs.getBoolean("biometric_required", true)
        if (biometricRequired) {
            _pendingBiometric.value = request
        } else {
            viewModelScope.launch { performCheck(request) }
        }
    }

    private suspend fun performCheck(request: PendingCheckRequest) {
        setBusy(true, "Getting your location…")
        try {
            val fix = LocationFetcher(context).fetchValid()
            val androidId = DeviceIdentity.androidId(context)
            val deviceName = DeviceIdentity.deviceName(context)
            val checkedAt = OffsetDateTime.now().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)
            try {
                val result = when (request.type) {
                    CheckType.IN -> repo.checkIn(
                        fix.latitude, fix.longitude, fix.accuracy,
                        androidId, deviceName, biometric = true,
                        mode = request.mode, checkedAt = checkedAt, note = request.note
                    )
                    CheckType.OUT -> repo.checkOut(
                        fix.latitude, fix.longitude, fix.accuracy,
                        androidId, deviceName, biometric = true,
                        mode = request.mode, checkedAt = checkedAt, note = request.note
                    )
                }
                val dist = result.distanceM?.let { " (${it.toInt()}m from school)" } ?: ""
                recordSyncSuccess()
                postInfo("Time ${if (request.type == CheckType.IN) "in" else "out"} recorded at " +
                    formatLocal(result.checkedAt) + dist)
                loadHome()
            } catch (e: Exception) {
                if (isNetworkError(e)) {
                    enqueue(PendingCheckEntry(
                        checkType = request.type.code,
                        lat = fix.latitude, lng = fix.longitude,
                        accuracy = fix.accuracy, checkedAt = checkedAt,
                        mode = request.mode, note = request.note,
                    ))
                    postInfo("No internet — saved on this phone. It will sync automatically when you're online.")
                    refreshPendingCount()
                } else {
                    postError(e)
                }
            }
        } catch (e: Exception) {
            postError(e)
        } finally {
            setBusy(false, null)
        }
    }

    /** Push queued offline entries to the server, oldest first. */
    fun syncPending() {
        viewModelScope.launch {
            val queue = readQueue()
            if (queue.isEmpty()) {
                postInfo("All entries are up to date.")
                return@launch
            }
            setBusy(true, "Syncing…")
            try {
                val androidId = DeviceIdentity.androidId(context)
                val deviceName = DeviceIdentity.deviceName(context)
                val iterator = queue.iterator()
                var synced = 0
                var kept = 0
                while (iterator.hasNext()) {
                    val e = iterator.next()
                    try {
                        if (e.checkType == "in") {
                            repo.checkIn(
                                e.lat, e.lng, e.accuracy, androidId, deviceName,
                                biometric = true, mode = e.mode, checkedAt = e.checkedAt, note = e.note
                            )
                        } else {
                            repo.checkOut(
                                e.lat, e.lng, e.accuracy, androidId, deviceName,
                                biometric = true, mode = e.mode, checkedAt = e.checkedAt, note = e.note
                            )
                        }
                        iterator.remove()
                        synced++
                    } catch (ex: Exception) {
                        if (isNetworkError(ex)) {
                            kept++
                            break
                        }
                        // Server rejected it (e.g. too old, sequence conflict) — drop and report.
                        iterator.remove()
                    }
                }
                writeQueue(queue)
                if (synced > 0 || queue.isEmpty()) recordSyncSuccess()
                val msg = when {
                    synced > 0 && kept > 0 -> "$synced synced; still offline for the rest."
                    synced > 0 -> "$synced pending entr${if (synced == 1) "y" else "ies"} synced."
                    kept > 0 -> "Still offline — will retry automatically."
                    else -> "Some pending entries were rejected by the server."
                }
                postInfo(msg)
                loadHome()
            } finally {
                setBusy(false, null)
            }
        }
    }

    fun setBiometricRequired(required: Boolean) {
        prefs.edit().putBoolean("biometric_required", required).apply()
    }

    fun isBiometricRequired(): Boolean = prefs.getBoolean("biometric_required", true)

    /* ---------------- offline queue ---------------- */

    private fun readQueue(): MutableList<PendingCheckEntry> {
        val raw = prefs.getString("pending_queue", null) ?: return mutableListOf()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                PendingCheckEntry(
                    checkType = o.getString("checkType"),
                    lat = o.getDouble("lat"),
                    lng = o.getDouble("lng"),
                    accuracy = o.getDouble("accuracy").toFloat(),
                    checkedAt = o.getString("checkedAt"),
                    mode = o.getString("mode"),
                    note = o.optString("note"),
                )
            }.toMutableList()
        } catch (e: Exception) {
            mutableListOf()
        }
    }

    private fun writeQueue(queue: List<PendingCheckEntry>) {
        val arr = JSONArray()
        queue.forEach { e ->
            arr.put(JSONObject().apply {
                put("checkType", e.checkType)
                put("lat", e.lat)
                put("lng", e.lng)
                put("accuracy", e.accuracy.toDouble())
                put("checkedAt", e.checkedAt)
                put("mode", e.mode)
                put("note", e.note)
            })
        }
        prefs.edit().putString("pending_queue", arr.toString()).apply()
    }

    private fun enqueue(entry: PendingCheckEntry) {
        val queue = readQueue()
        queue.add(entry)
        writeQueue(queue)
    }

    private fun refreshPendingCount() {
        val current = _state.value as? UiState.Home ?: return
        _state.value = current.copy(pendingCount = readQueue().size)
    }

    private fun recordSyncSuccess() {
        prefs.edit().putString("last_sync_at", OffsetDateTime.now().toString()).apply()
        val current = _state.value as? UiState.Home ?: return
        _state.value = current.copy(
            lastSyncAt = timeFormat.format(OffsetDateTime.now()),
            pendingCount = readQueue().size,
        )
    }

    /* ---------------- state helpers ---------------- */

    private suspend fun loadHome() {
        val previous = _state.value as? UiState.Home
        _state.value = UiState.Loading
        try {
            val profile = repo.myProfile()
            val records = repo.recentRecords()
            val devices = repo.myBoundDevices()
            val owner = repo.deviceOwner(DeviceIdentity.androidId(context))
            val myId = repo.currentUserId()
            val maxDevices = repo.setting("max_devices_per_account")?.toIntOrNull() ?: 2

            val last = records.firstOrNull()
            val today = LocalDate.now().toString()
            val todayRecords = records.filter { it.checkedAt.take(10) == today }
            val lastIn = todayRecords.firstOrNull { it.checkType == "in" }?.checkedAt
            val lastOut = todayRecords.firstOrNull { it.checkType == "out" }?.checkedAt

            val deviceWarning = owner?.takeIf { it.employeeId != myId }?.let {
                "This phone is already bound to ${it.fullName}. " +
                    "You can log in, but check-ins from this phone will be rejected."
            }

            _state.value = UiState.Home(
                fullName = profile.fullName,
                checkedIn = last?.checkType == "in",
                lastIn = lastIn?.let { formatLocal(it) },
                lastOut = lastOut?.let { formatLocal(it) },
                boundDevice = devices.firstOrNull()?.let {
                    it.deviceName?.takeIf { n -> n.isNotBlank() } ?: it.androidId
                },
                boundDevices = devices,
                maxDevices = maxDevices,
                pendingCount = readQueue().size,
                lastSyncAt = prefs.getString("last_sync_at", null)?.let { formatLocal(it) },
                message = deviceWarning ?: previous?.message,
                messageIsError = deviceWarning != null,
            )
            startGpsMonitor()
        } catch (e: Exception) {
            _state.value = UiState.LoginRequired()
        }
    }

    private fun setBusy(busy: Boolean, label: String?) {
        val current = _state.value as? UiState.Home ?: return
        _state.value = current.copy(busy = busy, busyLabel = label)
    }

    private fun postInfo(message: String) {
        val current = _state.value as? UiState.Home ?: return
        _state.value = current.copy(message = message, messageIsError = false)
    }

    private fun postError(e: Exception, fallback: String = friendlyError(e)) {
        when (val current = _state.value) {
            is UiState.Home -> _state.value = current.copy(
                message = fallback, messageIsError = true
            )
            else -> Unit
        }
    }

    private fun isNetworkError(e: Exception): Boolean {
        if (e is IOException) return true
        if (e is HttpRequestException) return true
        val msg = e.message ?: return false
        val m = msg.lowercase()
        return listOf(
            "failed to connect",
            "unable to resolve host",
            "connection refused",
            "connection reset",
            "timed out",
            "network is unreachable",
            "no internet",
        ).any { m.contains(it) }
    }

    private fun friendlyError(e: Exception): String {
        val msg = e.message ?: e.javaClass.simpleName
        return when {
            msg.contains("outside_radius") ->
                "You are outside the allowed radius. Move closer to the school gate."
            msg.contains("gps_accuracy_too_low") ->
                "GPS signal too weak. Go to an open area and try again."
            msg.contains("already_checked_in") -> "You have already checked in."
            msg.contains("not_checked_in") -> "You have not checked in yet."
            msg.contains("device_mismatch") ->
                "This phone is not the device bound to your account."
            msg.contains("max_devices_reached") ->
                "This account's device slots are full. Ask the admin to unbind one of your phones."
            msg.contains("device_bound_to_other_account") ->
                "This phone is already bound to another account."
            msg.contains("outside_work_hours") ->
                "Check-in is only allowed during work hours."
            msg.contains("account_disabled") ->
                "Your account is disabled. Contact the admin."
            msg.contains("unauthorized") -> "Session expired. Please log in again."
            msg.contains("device_identity_missing") ->
                "Phone identity could not be read."
            msg.contains("invalid_mode") -> "Invalid mode selected."
            msg.contains("future_timestamp") ->
                "The recorded time is in the future. Check your phone clock."
            msg.contains("too_old") ->
                "This entry is older than 24 hours and was rejected."
            msg.contains("mock") || msg.contains("Mock") ->
                "Suspicious location detected. Disable mock locations in developer options."
            msg.contains("SecurityException") -> "Location permission is required."
            msg.contains("accuracy") || msg.contains("GPS fix") ->
                "GPS signal too weak. Wait a moment and try again."
            isNetworkError(e) ->
                "Cannot reach the server. Check your internet connection."
            else -> msg.take(200)
        }
    }
}