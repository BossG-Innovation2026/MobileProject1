package com.cabiaoshs.attendance.data

import com.cabiaoshs.attendance.BuildConfig
import io.github.jan_tennert.supabase.Ktor
import io.github.jan_tennert.supabase.SupabaseClient
import io.github.jan_tennert.supabase.createSupabaseClient
import io.github.jan_tennert.supabase.auth.Auth
import io.github.jan_tennert.supabase.install
import io.github.jan_tennert.supabase.postgrest.Postgrest
import io.ktor.client.engine.okhttp.OkHttp

object SupabaseHolder {

    lateinit var supabase: SupabaseClientWrapper
        private set

    fun init() {
        if (this::supabase.isInitialized) return
        val client = createSupabaseClient(
            supabaseUrl = BuildConfig.SUPABASE_URL,
            supabaseKey = BuildConfig.SUPABASE_ANON_KEY
        ) {
            install(Ktor) { engine = OkHttp }
            install(Auth) {
                autoLoadFromStorage = true
                autoSaveToStorage = true
            }
            install(Postgrest)
        }
        supabase = SupabaseClientWrapper(client)
    }
}

class SupabaseClientWrapper internal constructor(
    val client: SupabaseClient
)