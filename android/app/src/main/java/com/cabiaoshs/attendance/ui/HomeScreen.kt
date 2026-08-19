package com.cabiaoshs.attendance.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.cabiaoshs.attendance.MainActivity

@Composable
fun HomeScreen(
    state: UiState.Home,
    onCheckIn: (note: String) -> Unit,
    onCheckOut: (note: String) -> Unit,
    onOpenSettings: () -> Unit,
    onSync: () -> Unit,
    onRefreshGps: () -> Unit,
    onLocationPermissionNeeded: (type: String, note: String) -> Unit,
    pendingOutsidePrompt: OutsidePrompt?,
    onOutsideConfirm: (note: String) -> Unit,
    onOutsideCancel: () -> Unit,
) {
    val context = LocalContext.current
    fun requestOrCheck(type: String) {
        val granted = ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            if (type == "in") onCheckIn("") else onCheckOut("")
        } else {
            onLocationPermissionNeeded(type, "")
            (context as? MainActivity)?.requestLocationPermissions()
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .imePadding()
            .padding(24.dp),
        verticalArrangement = Arrangement.SpaceBetween,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.Top,
        ) {
            val gpsColor = when (state.gpsStatus) {
                GpsStatus.GOOD -> Color(0xFF2E7D32)
                GpsStatus.WEAK -> Color(0xFFEF6C00)
                GpsStatus.NONE -> Color(0xFFC62828)
            }
            Box(
                modifier = Modifier
                    .padding(top = 12.dp)
                    .size(14.dp)
                    .clip(CircleShape)
                    .background(gpsColor)
                    .clickable(onClick = onRefreshGps)
                    .semantics {
                        contentDescription = when (state.gpsStatus) {
                            GpsStatus.GOOD -> "GPS good"
                            GpsStatus.WEAK -> "GPS weak"
                            GpsStatus.NONE -> "GPS none"
                        }
                    },
            )
            Spacer(Modifier.weight(1f))
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.padding(top = 24.dp),
            ) {
                Text(
                    text = "Cabiao SHS Attendance",
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.primary,
                )
                Text(
                    text = state.fullName,
                    fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.weight(1f))
            Spacer(Modifier.size(14.dp))
        }

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f, fill = false),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Button(
                onClick = { requestOrCheck("in") },
                enabled = !state.busy && !state.checkedIn,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp),
            ) {
                if (state.busy && state.busyLabel == "Getting your location…") {
                    CircularProgressIndicator(strokeWidth = 2.dp)
                } else {
                    Text(
                        text = "TIME IN",
                        fontSize = 22.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
            OutlinedButton(
                onClick = { requestOrCheck("out") },
                enabled = !state.busy && state.checkedIn,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp),
            ) {
                Text(
                    text = "TIME OUT",
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.secondary,
                )
            }
        }

        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(bottom = 8.dp),
        ) {
            val syncing = state.busy && state.busyLabel == "Syncing…"
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center,
                modifier = Modifier.padding(bottom = 4.dp),
            ) {
                val statusText = when {
                    syncing && state.pendingCount > 0 ->
                        "Syncing… (${state.pendingCount} remaining)"
                    state.pendingCount > 0 ->
                        "${state.pendingCount} pending entr${if (state.pendingCount == 1) "y" else "ies"} — saved offline"
                    state.lastSyncAt != null -> "All synced · Last sync ${state.lastSyncAt}"
                    else -> "All synced"
                }
                Text(
                    text = statusText,
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            OutlinedButton(
                onClick = onSync,
                enabled = !state.busy,
                modifier = Modifier.padding(bottom = 8.dp),
            ) {
                Text("SYNC NOW", fontWeight = FontWeight.Bold)
            }

            val summary = buildString {
                if (state.lastIn != null) append("In ${state.lastIn}")
                if (state.lastIn != null && state.lastOut != null) append(" · ")
                if (state.lastOut != null) append("Out ${state.lastOut}")
                if (isEmpty()) append("No record yet today")
                if (state.checkedIn) append(" · not out yet")
            }
            Text(
                text = summary,
                fontSize = 14.sp,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            state.message?.let {
                Spacer(Modifier.height(8.dp))
                Text(
                    text = it,
                    fontSize = 13.sp,
                    textAlign = TextAlign.Center,
                    color = if (state.messageIsError) {
                        MaterialTheme.colorScheme.error
                    } else {
                        MaterialTheme.colorScheme.primary
                    },
                )
            }

            Spacer(Modifier.height(4.dp))
            Text(
                text = "⚙ Settings",
                fontSize = 14.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier
                    .clickable(onClick = onOpenSettings)
                    .padding(8.dp),
            )
        }
    }

    pendingOutsidePrompt?.let {
        var locationNote by rememberSaveable { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = onOutsideCancel,
            title = { Text("Outside the school") },
            text = {
                Column {
                    Text("You are currently outside the school. Please enter your current location.")
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        value = locationNote,
                        onValueChange = { locationNote = it.take(80) },
                        label = { Text("Your current location") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = { onOutsideConfirm(locationNote) },
                    enabled = locationNote.isNotBlank(),
                ) {
                    Text("OK")
                }
            },
            dismissButton = {
                TextButton(onClick = onOutsideCancel) {
                    Text("Cancel")
                }
            },
        )
    }
}