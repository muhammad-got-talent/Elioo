// One command to prepare (and optionally build) the Android app.
//   npm run android:setup   -> prepares the android/ project
//   npm run android:apk     -> prepares it and builds a debug APK
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const run = (cmd, cwd) => execSync(cmd, { stdio: "inherit", cwd });
const cfg = JSON.parse(readFileSync("capacitor.config.json", "utf8"));
const pkg = cfg.appId;
const build = process.argv.includes("--build");

console.log("\n[1/5] Building the web app");
run("npm run build");

if (!existsSync("android")) {
  console.log("\n[2/5] Creating the Android project");
  run("npx cap add android");
} else {
  console.log("\n[2/5] Android project already exists");
}

console.log("\n[3/5] Installing Elio's call and notification code");
const javaDir = path.join("android", "app", "src", "main", "java", ...pkg.split("."));
mkdirSync(javaDir, { recursive: true });
for (const f of readdirSync(path.join("android-overlay", "java"))) {
  const src = readFileSync(path.join("android-overlay", "java", f), "utf8").replaceAll("__PACKAGE__", pkg);
  writeFileSync(path.join(javaDir, f), src);
}

const manifestPath = path.join("android", "app", "src", "main", "AndroidManifest.xml");
let manifest = readFileSync(manifestPath, "utf8");
if (!manifest.includes("ElioMessagingService")) {
  const perms = ["POST_NOTIFICATIONS", "USE_FULL_SCREEN_INTENT", "VIBRATE", "WAKE_LOCK", "RECORD_AUDIO", "MODIFY_AUDIO_SETTINGS"]
    .map((p) => `    <uses-permission android:name="android.permission.${p}" />`)
    .join("\n");
  const queries = `    <uses-feature android:name="android.hardware.microphone" android:required="false" />
    <queries>
        <intent><action android:name="android.speech.RecognitionService" /></intent>
        <intent><action android:name="android.intent.action.TTS_SERVICE" /></intent>
    </queries>
`;
  const components = `        <service android:name=".ElioMessagingService" android:exported="false">
            <intent-filter><action android:name="com.google.firebase.MESSAGING_EVENT" /></intent-filter>
        </service>
        <receiver android:name=".CallActionReceiver" android:exported="false" />
    </application>`;
  manifest = manifest.replace("<application", perms + "\n" + queries + "\n    <application").replace("</application>", components);
  writeFileSync(manifestPath, manifest);
  console.log("  patched AndroidManifest.xml");
}

const gradlePath = path.join("android", "app", "build.gradle");
let gradle = readFileSync(gradlePath, "utf8");
if (!gradle.includes("firebase-messaging")) {
  gradle = gradle.replace(/dependencies\s*\{/, (m) => `${m}
    implementation platform('com.google.firebase:firebase-bom:33.7.0')
    implementation 'com.google.firebase:firebase-messaging'`);
  writeFileSync(gradlePath, gradle);
  console.log("  patched app/build.gradle");
}

console.log("\n[4/5] Firebase config for push notifications");
if (existsSync("google-services.json")) {
  copyFileSync("google-services.json", path.join("android", "app", "google-services.json"));
  console.log("  google-services.json found, push calls enabled");
} else {
  console.log("  WARNING: google-services.json not found in the repo root.");
  console.log("  The app will build, but calls will only ring while the app is open. See ANDROID.md.");
}

console.log("\n[5/5] Syncing Capacitor");
run("npx cap sync android");

if (build) {
  console.log("\nBuilding the APK (first build downloads Gradle and can take several minutes)");
  run(process.platform === "win32" ? "gradlew.bat assembleDebug" : "./gradlew assembleDebug", "android");
  console.log("\nDone. Your APK: android/app/build/outputs/apk/debug/app-debug.apk");
} else {
  console.log("\nDone. Build with: cd android && ./gradlew assembleDebug");
}
