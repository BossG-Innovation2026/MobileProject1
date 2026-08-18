package com.cabiaoshs.attendance

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
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

    AttendanceTheme {
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
                    )
                }
            }
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