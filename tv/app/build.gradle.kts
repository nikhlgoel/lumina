import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Read once: the release key's location and passwords, if this machine has them (never committed).
val keystoreProps = Properties().apply {
    val file = rootProject.file("keystore.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

android {
    namespace = "com.lumina.tv"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.lumina.tv"
        // 25 reaches the oldest Fire TV sticks still in use (Fire OS 5/6); the stick this was built
        // for runs Fire OS 8 = API 30. Targeting 30 matches that device, so behaviour on it is what
        // was tested rather than what a newer Android would do.
        minSdk = 25
        targetSdk = 30
        versionCode = 2
        versionName = "0.1.0"
        // One place for the extractor's version: the dependency below and the About screen both read it.
        buildConfigField("String", "EXTRACTOR_VERSION", "\"v0.26.5\"")
    }

    // Release signing. The key lives outside the repository: tv/keystore.properties (git-ignored) names the keystore and
    // its passwords, see docs/15_FIRE_TV.md. Without that file the release build is produced UNSIGNED (and cannot be
    // installed), never signed with a throwaway key by accident.
    signingConfigs {
        if (keystoreProps.isNotEmpty()) {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // NewPipeExtractor uses java.time and friends, which API 25 devices lack.
        isCoreLibraryDesugaringEnabled = true
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += setOf(
                "/META-INF/{AL2.0,LGPL2.1}",
                "/META-INF/DEPENDENCIES",
                "/META-INF/LICENSE*",
                "/META-INF/NOTICE*",
                "/META-INF/INDEX.LIST",
                "/META-INF/*.kotlin_module",
            )
        }
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }

    lint {
        // "Google Play requires targetSdk 33+" is a store rule, and this app is never published to a
        // store (project rule): it is sideloaded. Targeting 30 is deliberate — it is what Fire OS 8 is —
        // so what was tested on the emulator is what the stick does. Every other lint error still fails the build.
        disable += "ExpiredTargetSdkVersion"
        // Media3 marks much of its API @UnstableApi and this project opts in for the whole module in the Kotlin compiler
        // options below, where the compiler enforces it. Android lint does not read that setting and reports every use
        // as an error (35 false alarms), which hid any real lint finding. Everything else still fails the build.
        disable += "UnsafeOptInUsageError"
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
        // Media3 marks most of its API @UnstableApi (stable in practice, the label is about its
        // binary-compatibility promise), and the TV UI toolkit marks parts of itself experimental.
        optIn.addAll(
            "androidx.media3.common.util.UnstableApi",
            "androidx.tv.material3.ExperimentalTvMaterial3Api",
            "androidx.compose.foundation.ExperimentalFoundationApi",
            "androidx.compose.ui.ExperimentalComposeUiApi",
            "kotlinx.coroutines.ExperimentalCoroutinesApi",
        )
    }
}

dependencies {
    // The _nio variant, not the plain one: NewPipeExtractor calls java.net.URLEncoder.encode(String,
    // Charset) and friends, which Android only has from API 33. With the plain artifact every search
    // died on a Fire OS 8 device (API 30) with "No static method encode". Found by running it.
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs_nio:2.1.5")

    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.10.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.10.0")
    implementation("androidx.activity:activity-compose:1.12.2")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")

    // Library versions are pinned to the last releases built for compileSdk 36. The newest AndroidX
    // (mid-2026) requires AGP 9.1+ and compileSdk 37, which this build deliberately does not use.
    val bom = platform("androidx.compose:compose-bom:2025.12.01")
    implementation(bom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.tv:tv-material:1.1.0")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("androidx.media3:media3-exoplayer:1.9.0")
    implementation("androidx.media3:media3-ui:1.9.0")
    implementation("androidx.media3:media3-session:1.9.0")
    implementation("androidx.media3:media3-datasource-okhttp:1.9.0")

    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("io.coil-kt:coil-compose:2.7.0")
    // Draws the QR code on the "Use your phone" screen. Pure Java, Apache-2.0, no permissions.
    implementation("com.google.zxing:core:3.5.3")

    // Background playlist sync (2.10.x: 2.11+ wants a newer toolchain, see the note on versions above).
    implementation("androidx.work:work-runtime-ktx:2.10.5")
    // Picks a colour out of the artwork so Now Playing can be tinted by the song, as the big apps do.
    implementation("androidx.palette:palette-ktx:1.0.0")

    // The streaming-site extractor. GPL-3.0: this is why the whole tv/ project is GPL-3.0 even though
    // the PC app is MIT. See tv/LICENSE and tv/README.md.
    implementation("com.github.TeamNewPipe:NewPipeExtractor:v0.26.5")

    testImplementation("junit:junit:4.13.2")
    // Android's org.json is a stub on the plain JVM that unit tests run on; this is the real one.
    testImplementation("org.json:json:20240303")
    // A real HTTP server in the tests: the sign-in flow and the phone page are tested over actual requests.
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
}
