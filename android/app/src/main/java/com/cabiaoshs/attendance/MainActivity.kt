package com.cabiaoshs.attendance

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.biometric.BiometricPrompt
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.core.content.ContextCompat
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.cabiaoshs.attendance.data.SupabaseHolder
import com.cabiaoshs.attendance.ui.AppViewModel
import com.cabiaoshs.attendance.ui.CheckType

class MainActivity : ComponentActivity() {

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { }

    private lateinit var viewModel: AppViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        SupabaseHolder.init()
        viewModel = ViewModelProvider(this)[AppViewModel::class.java]

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED
        ) {
            permissionLauncher.launch(
                arrayOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION,
                )
            )
        }

        setContent {
            val pending by viewModel.pendingBiometric.collectAsStateWithLifecycle()
            LaunchedEffect(pending) {
                val type = pending ?: return@LaunchedEffect
                showBiometricPrompt(type)
            }
            App(viewModel)
        }
    }

    private fun showBiometricPrompt(type: CheckType) {
        val action = if (type == CheckType.IN) "time in" else "time out"
        val prompt = BiometricPrompt(
            this,
            ContextCompat.getMainExecutor(this),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    viewModel.proceedAfterBiometric(true)
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    viewModel.onBiometricCancel()
                }

                override fun onAuthenticationFailed() {
                    // keep prompt open, user may retry
                }
            }
        )

        val canUseBiometric = BiometricManager.from(this).canAuthenticate(
            Authenticators.BIOMETRIC_STRONG or Authenticators.BIOMETRIC_WEAK
        ) == BiometricManager.BIOMETRIC_SUCCESS

        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Verify identity")
            .setSubtitle("Confirm to record your $action")
            .setAllowedAuthenticators(
                if (canUseBiometric) {
                    Authenticators.BIOMETRIC_STRONG or Authenticators.DEVICE_CREDENTIAL
                } else {
                    Authenticators.DEVICE_CREDENTIAL
                }
            )
            .build()

        prompt.authenticate(promptInfo)
    }
}