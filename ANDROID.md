# Build the Elio Android app

You need no PC. Any cloud computer with Node.js 20+ and JDK 21 works (for example the Manus agent computer, a GitHub Codespace, or GitHub Actions).

## 1. Get your push-notification file (free, 2 minutes)

Calls reach a closed app through Firebase Cloud Messaging, and Android needs your own Firebase project baked into the app.

1. Firebase Console > your project > Project settings > General > **Add app > Android**.
2. Package name: `app.elio.agent` (exactly). Skip the other steps.
3. Download `google-services.json` and put it in the repo root (it is git-ignored, never commit it).

No billing is needed. Cloud Messaging is free.

## 2. Build the APK

```
npm install
npm run android:apk
```

The script builds the web app, creates the Android project, installs Elio's call and notification code, copies `google-services.json`, and builds `android/app/build/outputs/apk/debug/app-debug.apk`. The first build downloads Gradle and can take several minutes.

The debug APK is signed automatically and installs directly on a phone (allow "install unknown apps").

## 3. Build it with Manus (copy and paste this prompt)

> Clone https://github.com/YOUR-NAME/elio. I am attaching `google-services.json`; place it in the repo root. Install Node.js 22, JDK 21 and the Android SDK (platform 35, build-tools 35). Run `npm install` then `npm run android:apk`. If a step fails, read the error, fix it and retry. Give me `android/app/build/outputs/apk/debug/app-debug.apk` as a download. Do not change app code unless a build error requires it, and tell me what you changed.

## 4. First run on the phone

1. Open Elio, finish the setup page, sign in.
2. On the home screen, Calls card: tap **Enable call alerts** and allow notifications.
3. If it shows **Allow full-screen calls**, tap it and switch it on (Android 14+ asks for this).
4. Tap **Test call in the app**, then **Test while locked** and lock the phone. It should ring with the call screen.

## How calling works

- The worker places a call: it writes a ringing call in Firestore and sends a high-priority push to your phone.
- App open: the call screen appears at once. App closed or phone locked: Android shows a full-screen ringing notification with Answer and Decline. Declining the notification just dismisses it, and an unanswered call becomes "missed" after 45 seconds (Elio leaves the message in the task).
- Voice uses the phone's own speech recognition and text-to-speech (free, no keys). The AI is text-based, so no WebRTC server is needed. You can also type during a call.
- When you hang up after giving instructions, the task goes back to "build" and the worker continues.

## Known limits

- Phones from some brands (Xiaomi, Oppo, Huawei, Samsung) kill background apps. If calls do not ring while the app is closed, set Elio's battery usage to "Unrestricted" and allow auto-start.
- Free Firebase and OpenRouter limits apply.
- The website shows the call screen only while the page is open. Web push is not included yet.
- The AI voice is your phone's built-in voice, so quality depends on the phone.
