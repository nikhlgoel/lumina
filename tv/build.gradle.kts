// Versions are pinned on purpose. Gradle 8.14 + AGP 8.13 + Kotlin 2.2 is a combination that is known
// to build together; AGP 9 changed several build conventions and is not worth the risk for a first
// release. Revisit once the app is stable.
plugins {
    id("com.android.application") version "8.13.2" apply false
    id("org.jetbrains.kotlin.android") version "2.2.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.2.21" apply false
}
