package com.cabiaoshs.attendance.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun HomeScreen(
    state: UiState.Home,
    onCheckIn: (mode: String, note: String) -> Unit,
    onCheckOut: (mode: String, note: String) -> Unit,
    onOpenSettings: () -> Unit,
    onSync: () -> Unit,
) {
    var mode by rememberSaveable { mutableStateOf("inside") }
    var note by rememberSaveable { mutableStateOf("") }
    val outside = mode == "outside"
    val inLabel = if (outside) "CHECK IN" else "TIME IN"
    val outLabel = if (outside) "CHECK OUT" else "TIME OUT"

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.SpaceBetween,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
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

        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                ModeButton(
                    label = "Inside the school",
                    selected = !outside,
                    onClick = { mode = "inside" },
                    modifier = Modifier.weight(1f),
                )
                ModeButton(
                    label = "Outside",
                    selected = outside,
                    onClick = { mode = "outside" },
                    modifier = Modifier.weight(1f),
                )
            }

            if (outside) {
                OutlinedTextField(
                    value = note,
                    onValueChange = { note = it.take(80) },
                    label = { Text("Describe your location (optional)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            Button(
                onClick = { onCheckIn(mode, note) },
                enabled = !state.busy && !state.checkedIn,
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
            ) {
                if (state.busy && state.busyLabel == "Getting your location…") {
                    CircularProgressIndicator(strokeWidth = 2.dp)
                } else {
                    Text(
                        text = inLabel,
                        fontSize = 22.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
            OutlinedButton(
                onClick = { onCheckOut(mode, note) },
                enabled = !state.busy && state.checkedIn,
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
            ) {
                Text(
                    text = outLabel,
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
            if (state.pendingCount > 0) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center,
                    modifier = Modifier.padding(bottom = 4.dp),
                ) {
                    Text(
                        text = "${state.pendingCount} pending entr${if (state.pendingCount == 1) "y" else "ies"} — saved offline",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.secondary,
                    )
                    Text(
                        text = "  Sync now",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier
                            .clickable(onClick = onSync)
                            .padding(4.dp),
                    )
                }
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
}

@Composable
private fun ModeButton(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (selected) {
        Button(
            onClick = onClick,
            colors = ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.primaryContainer,
                contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
            ),
            modifier = modifier,
        ) {
            Text(label, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
        }
    } else {
        OutlinedButton(
            onClick = onClick,
            modifier = modifier,
        ) {
            Text(label, fontSize = 14.sp)
        }
    }
}