package com.cabiaoshs.attendance.ui

import android.app.Application
import android.content.Context
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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter

enum class CheckType { IN, OUT }

sealed interface UiState {
    data object Loading : UiState
    data object ConfigError : UiState
    data class LockRequired(val lockType: LockType) : UiState
    data class LoginRequired(val error: String? = null) : UiState
    data class Home(
        val fullName: String,
        val checkedIn: Boolean,
        val lastIn: String? = null,
        val lastOut: String? = null,
        val boundDevice: String? = null,
        val busy: Boolean = false,
        val busyLabel: String? = null,
        val message: String? = null,
        val messageIsError: Boolean = true,
    ) : UiState
}

class AppViewModel(app: Application) : AndroidViewModel(app) {

    private val context: Context get() = getApplication()

    private val prefs = context.getSharedPreferences("attendance", Context.MODE_PRIVATE)
    private val repo: AttendanceRepository
        get() = AttendanceRepository(SupabaseHolder.supabase.client)

    private val _state = MutableStateFlow<UiState>(UiState.Loading)
    val state: StateFlow<UiState> = _state.asStateFlow()

    /** Non-null while a biometric prompt should be shown. */
    private val _pendingBiometric = MutableStateFlow<CheckType?>(null)
    val pendingBiometric: StateFlow<CheckType?> = _pendingBiometric.asStateFlow()

    private val timeFormat = DateTimeFormatter.ofPattern("h:mm a")

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            if (!isSupabaseConfigured()) {
                _state.value = UiState.ConfigError
                return@launch
            }
            val lock = SecurityManager.lockType(context)
            if (lock == LockType.NONE) {
                _state.value = UiState.LockRequired(lock)
                return@launch
            }
            try {
                if (repo.isLoggedIn()) loadHome() else _state.value = UiState.LoginRequired()
            } catch (e: Exception) {
                _state.value = UiState.LoginRequired()
            }
        }
    }

    fun login(email: String, password: String) {
        if (_state.value !is UiState.LoginRequired) return
        viewModelScope.launch {
            _state.value = UiState.Loading
            try {
                repo.login(email, password)
                loadHome()
            } catch (e: Exception) {
                _state.value = UiState.LoginRequired("Invalid email or password.")
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            try {
                repo.logout()
            } catch (_: Exception) {
            }
            _state.value = UiState.LoginRequired()
        }
    }

    fun onCheckIn() = beginCheck(CheckType.IN)

    fun onCheckOut() = beginCheck(CheckType.OUT)

    /** Biometric succeeded (or was skipped); proceed with the pending check. */
    fun proceedAfterBiometric(success: Boolean) {
        val type = _pendingBiometric.value ?: return
        _pendingBiometric.value = null
        if (!success) return
        viewModelScope.launch { performCheck(type) }
    }

    fun onBiometricCancel() {
        _pendingBiometric.value = null
    }

    private fun beginCheck(type: CheckType) {
        val current = _state.value as? UiState.Home ?: return
        if (current.busy) return
        val biometricRequired = prefs.getBoolean("biometric_required", true)
        if (biometricRequired) {
            _pendingBiometric.value = type
        } else {
            viewModelScope.launch { performCheck(type) }
        }
    }

    private suspend fun performCheck(type: CheckType) {
        setBusy(true, "Getting your location…")
        try {
            val fix = LocationFetcher(context).fetchValid()
            val androidId = DeviceIdentity.androidId(context)
            val deviceName = DeviceIdentity.deviceName(context)
            val result = when (type) {
                CheckType.IN -> repo.checkIn(
                    fix.latitude, fix.longitude, fix.accuracy,
                    androidId, deviceName, biometric = true
                )
                CheckType.OUT -> repo.checkOut(
                    fix.latitude, fix.longitude, fix.accuracy,
                    androidId, deviceName, biometric = true
                )
            }
            val dist = result.distanceM?.let { " (${it.toInt()}m from school)" } ?: ""
            postInfo("Time ${if (type == CheckType.IN) "in" else "out"} recorded at " +
                timeFormat.format(OffsetDateTime.parse(result.checkedAt)) + dist)
            loadHome()
        } catch (e: Exception) {
            postError(e)
        } finally {
            setBusy(false, null)
        }
    }

    fun setBiometricRequired(required: Boolean) {
        prefs.edit().putBoolean("biometric_required", required).apply()
    }

    fun isBiometricRequired(): Boolean = prefs.getBoolean("biometric_required", true)

    private suspend fun loadHome() {
        val previous = _state.value as? UiState.Home
        _state.value = UiState.Loading
        try {
            val profile = repo.myProfile()
            val records = repo.recentRecords()
            val bound = repo.myBoundDevice()

            val last = records.firstOrNull()
            val today = LocalDate.now().toString()
            val todayRecords = records.filter { it.checkedAt.take(10) == today }
            val lastIn = todayRecords.firstOrNull { it.checkType == "in" }?.checkedAt
            val lastOut = todayRecords.firstOrNull { it.checkType == "out" }?.checkedAt

            _state.value = UiState.Home(
                fullName = profile.fullName,
                checkedIn = last?.checkType == "in",
                lastIn = lastIn?.let { timeFormat.format(OffsetDateTime.parse(it)) },
                lastOut = lastOut?.let { timeFormat.format(OffsetDateTime.parse(it)) },
                boundDevice = bound?.deviceName?.takeIf { it.isNotBlank() } ?: bound?.androidId,
                message = previous?.message,
                messageIsError = previous?.messageIsError ?: true,
            )
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
            msg.contains("device_bound_to_other_account") ->
                "This phone is already bound to another account."
            msg.contains("outside_work_hours") ->
                "Check-in is only allowed during work hours."
            msg.contains("account_disabled") ->
                "Your account is disabled. Contact the admin."
            msg.contains("unauthorized") -> "Session expired. Please log in again."
            msg.contains("device_identity_missing") ->
                "Phone identity could not be read."
            msg.contains("mock") || msg.contains("Mock") ->
                "Suspicious location detected. Disable mock locations in developer options."
            msg.contains("SecurityException") -> "Location permission is required."
            msg.contains("accuracy") || msg.contains("GPS fix") ->
                "GPS signal too weak. Wait a moment and try again."
            msg.contains("http") || msg.contains("ConnectException") ||
                msg.contains("UnknownHost") || msg.contains("timeout") ->
                "Cannot reach the server. Check your internet connection."
            else -> msg.take(200)
        }
    }
}