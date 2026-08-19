package com.cabiaoshs.attendance

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.biometric.BiometricPrompt
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.cabiaoshs.attendance.data.SupabaseHolder
import com.cabiaoshs.attendance.ui.AppViewModel
import com.cabiaoshs.attendance.ui.CheckType
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter

class MainActivity : FragmentActivity() {

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { }

    private lateinit var viewModel: AppViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        installCrashCatcher()
        try {
            SupabaseHolder.init()
        } catch (_: Exception) {
            // A broken supabase client must not kill the app; refresh() shows an error state.
        }
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
                val request = pending ?: return@LaunchedEffect
                showBiometricPrompt(request.type)
            }
            App(viewModel)
        }
    }

    private fun installCrashCatcher() {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { _, throwable ->
            try {
                val stack = StringWriter().apply {
                    throwable.printStackTrace(PrintWriter(this))
                }.toString()
                getSharedPreferences("attendance", MODE_PRIVATE)
                    .edit().putString("last_crash", stack).apply()
                File(filesDir, "crash.txt").writeText(stack)
            } catch (_: Exception) {
            }
            previous?.uncaughtException(Thread.currentThread(), throwable)
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

        val canUseBiometric = try {
            BiometricManager.from(this).canAuthenticate(
                Authenticators.BIOMETRIC_STRONG or Authenticators.BIOMETRIC_WEAK
            ) == BiometricManager.BIOMETRIC_SUCCESS
        } catch (_: Exception) {
            false
        }

        // Screen lock (PIN / pattern / password) is ALWAYS allowed; biometrics
        // are only offered when the device reports them healthy.
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