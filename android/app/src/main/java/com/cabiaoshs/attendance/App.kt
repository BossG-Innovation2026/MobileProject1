package com.cabiaoshs.attendance

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.cabiaoshs.attendance.ui.AppViewModel
import com.cabiaoshs.attendance.ui.HomeScreen
import com.cabiaoshs.attendance.ui.LoginScreen
import com.cabiaoshs.attendance.ui.SettingsScreen
import com.cabiaoshs.attendance.ui.UiState
import com.cabiaoshs.attendance.ui.theme.AttendanceTheme

@Composable
fun App(viewModel: AppViewModel = viewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    var showSettings by rememberSaveable { mutableStateOf(false) }

    // If the app crashed last time, show the stack trace before anything else.
    val context = LocalContext.current
    var crashText by remember {
        mutableStateOf(
            context.getSharedPreferences("attendance", Context.MODE_PRIVATE)
                .getString("last_crash", null)
        )
    }

    AttendanceTheme {
        if (crashText != null) {
            CrashReport(
                text = crashText!!,
                onDismiss = {
                    context.getSharedPreferences("attendance", Context.MODE_PRIVATE)
                        .edit().remove("last_crash").apply()
                    crashText = null
                }
            )
            return@AttendanceTheme
        }
        when (val s = state) {
            UiState.Loading -> CenteredText("Loading…", showSpinner = true)
            UiState.ConfigError -> CenteredText(
                "Supabase project not configured.\n\nOpen android/gradle.properties and set\nSUPABASE_URL and SUPABASE_ANON_KEY,\nthen rebuild."
            )
            is UiState.LockRequired -> CenteredText(
                "⚠ No screen lock set\n\nSet a PIN, pattern, password or\nbiometric lock on this phone to\nuse the attendance app."
            )
            is UiState.LoginRequired -> LoginScreen(
                error = s.error,
                onLogin = viewModel::login,
            )
            is UiState.Home -> {
                if (showSettings) {
                    SettingsScreen(s, viewModel, onBack = { showSettings = false })
                } else {
                    HomeScreen(
                        state = s,
                        onCheckIn = viewModel::onCheckIn,
                        onCheckOut = viewModel::onCheckOut,
                        onOpenSettings = { showSettings = true },
                        onSync = viewModel::syncPending,
                    )
                }
            }
        }
    }
}

@Composable
private fun CrashReport(text: String, onDismiss: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = "The app crashed on the last launch. Please send this to the developer:",
            fontSize = 14.sp,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.error,
        )
        Text(
            text = text,
            fontSize = 10.sp,
            textAlign = TextAlign.Start,
            modifier = Modifier
                .padding(top = 12.dp, bottom = 16.dp)
                .verticalScroll(rememberScrollState()),
            color = MaterialTheme.colorScheme.onSurface,
        )
        Button(
            onClick = onDismiss,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Dismiss")
        }
    }
}

@Composable
private fun CenteredText(text: String, showSpinner: Boolean = false) {
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (showSpinner) {
            CircularProgressIndicator()
        }
        Text(
            text = text,
            fontSize = 15.sp,
            fontWeight = if (showSpinner) FontWeight.Normal else FontWeight.SemiBold,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.padding(top = 16.dp),
        )
    }
}