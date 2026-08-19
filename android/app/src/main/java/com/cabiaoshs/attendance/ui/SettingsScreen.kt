package com.cabiaoshs.attendance.ui

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.cabiaoshs.attendance.device.DeviceIdentity
import com.cabiaoshs.attendance.device.SecurityManager

@Composable
fun SettingsScreen(
    state: UiState.Home,
    viewModel: AppViewModel,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val lockType = SecurityManager.lockType(context)
    var biometricRequired by rememberBiometricSetting()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                text = "←",
                fontSize = 24.sp,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier
                    .padding(end = 8.dp)
                    .clickable(onClick = onBack),
            )
            Text(
                text = "Settings",
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
            )
        }

        Spacer(Modifier.height(24.dp))

        SettingLabel("Phone security")
        SettingRow(
            label = "Screen lock",
            value = SecurityManager.describeLock(lockType),
        )
        if (lockType == com.cabiaoshs.attendance.device.LockType.NONE) {
            Text(
                text = "Set a screen lock (PIN, pattern, password or biometrics) to use this app.",
                color = MaterialTheme.colorScheme.error,
                fontSize = 13.sp,
                modifier = Modifier.padding(top = 4.dp, bottom = 8.dp),
            )
        }

        HorizontalDivider(Modifier.padding(vertical = 16.dp))

        SettingLabel("Check-in")
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 8.dp),
        ) {
            Column(Modifier.weight(1f)) {
                Text("Require biometric / phone lock", fontWeight = FontWeight.Medium)
                Text(
                    "Ask for fingerprint, face or PIN before every check-in",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Switch(
                checked = biometricRequired,
                onCheckedChange = {
                    biometricRequired = it
                    viewModel.setBiometricRequired(it)
                },
            )
        }

        HorizontalDivider(Modifier.padding(vertical = 16.dp))

        SettingLabel("Device binding")
        SettingRow(
            label = "This phone",
            value = "${DeviceIdentity.deviceName(context)} · ${DeviceIdentity.androidId(context)}",
        )
        SettingRow(
            label = "Bound to account",
            value = state.boundDevice ?: "Not bound yet — binds on first check-in",
        )
        SettingRow(
            label = "Device slots used",
            value = "${state.boundDevices.size} of ${state.maxDevices}",
        )
        state.boundDevices.forEachIndexed { i, d ->
            SettingRow(
                label = "Bound device ${i + 1}",
                value = listOfNotNull(
                    d.deviceName?.takeIf { it.isNotBlank() },
                    d.androidId,
                ).joinToString(" · "),
            )
        }
        Text(
            text = "Each account can use up to ${state.maxDevices} phones. " +
                "To swap a phone, ask the admin to unbind it.",
            fontSize = 12.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 4.dp, bottom = 8.dp),
        )

        HorizontalDivider(Modifier.padding(vertical = 16.dp))

        SettingLabel("Location permission")
        var permissionMsg by remember { mutableStateOf<String?>(null) }
        val permissionLauncher = rememberLauncherForActivityResult(
            ActivityResultContracts.RequestMultiplePermissions()
        ) { grants ->
            permissionMsg = if (grants[Manifest.permission.ACCESS_FINE_LOCATION] == true) {
                "Permission granted."
            } else {
                "Denied. Enable it in system Settings → Apps → Cabiao SHS Attendance → Permissions."
            }
        }
        val granted = ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        SettingRow(
            label = "Status",
            value = if (granted) "Granted" else "Not granted",
        )
        if (!granted) {
            OutlinedButton(
                onClick = {
                    permissionLauncher.launch(
                        arrayOf(
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION,
                        )
                    )
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Request location permission")
            }
        }
        permissionMsg?.let {
            Text(
                text = it,
                color = if (it.startsWith("Permission granted")) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.error
                },
                fontSize = 13.sp,
                modifier = Modifier.padding(top = 8.dp),
            )
        }

        HorizontalDivider(Modifier.padding(vertical = 16.dp))

        OutlinedButton(
            onClick = { viewModel.logout() },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("LOG OUT", color = MaterialTheme.colorScheme.error)
        }
    }
}

@Composable
private fun rememberBiometricSetting(): androidx.compose.runtime.MutableState<Boolean> {
    val context = LocalContext.current
    val prefs = context.getSharedPreferences("attendance", Context.MODE_PRIVATE)
    return androidx.compose.runtime.remember {
        mutableStateOf(prefs.getBoolean("biometric_required", true))
    }
}

@Composable
private fun SettingLabel(text: String) {
    Text(
        text = text,
        fontSize = 12.sp,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(bottom = 4.dp),
    )
}

@Composable
private fun SettingRow(label: String, value: String) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
    ) {
        Text(label, fontWeight = FontWeight.Medium, modifier = Modifier.weight(0.4f))
        Text(
            value,
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(0.6f),
        )
    }
}