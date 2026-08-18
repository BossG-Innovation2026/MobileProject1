# Keep Kotlin serialization generated classes
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class kotlinx.serialization.json.** { kotlinx.serialization.KSerializer serializer(...); }

# Supabase / Ktor
-keep class io.github.jan_tennert.supabase.** { *; }
-keep class com.cabiaoshs.attendance.data.** { *; }