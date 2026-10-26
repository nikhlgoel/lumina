# Release builds shrink and obfuscate. NewPipeExtractor finds its services by reflection and ships a
# JavaScript engine (Rhino); stripping either breaks search and playback in ways a debug build never
# shows. Verify any change here on a release build, not a debug one.
-keep class org.schabi.newpipe.extractor.** { *; }
-dontwarn org.schabi.newpipe.extractor.**
-keep class org.mozilla.javascript.** { *; }
-dontwarn org.mozilla.javascript.**
-dontwarn org.mozilla.classfile.**
-dontwarn javax.script.**
-dontwarn jdk.dynalink.**
-keep class com.grack.nanojson.** { *; }
-dontwarn com.google.protobuf.**
