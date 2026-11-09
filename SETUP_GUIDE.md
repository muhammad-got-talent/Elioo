# Elio: A to Z setup guide (phone only, all free)

Do the parts in order. Every command is on its own line. Copy it exactly.

## What you have (in plain words)

Elio has 3 pieces:

1. **Website** (the screen you tap). It goes on **Vercel** (free). Vercel is just a place that shows your website to the world.
2. **Firebase** (login + database + notifications). Google runs it for you. There is nothing to deploy.
3. **Worker** (the AI's computer that writes code and runs commands). It can NOT run on Vercel, because Vercel cannot give the AI a terminal. It runs in a **GitHub Codespace** (free cloud computer). You open it from your phone browser.

The Android app is the same website packed into an APK (Part 7).

## Part 0: Make 4 free accounts

1. GitHub: github.com
2. Firebase: console.firebase.google.com (use a Google account)
3. OpenRouter: openrouter.ai
4. Vercel: vercel.com (choose "Continue with GitHub")

Tip: in your phone browser, open the menu and turn on **Desktop site** for GitHub and Codespaces. They are much easier that way.

## Part 1: Put the code on GitHub

1. On GitHub tap **+** > **New repository**.
2. Name: `elio`. Choose **Public**. Under License choose **MIT License**. Tap **Create repository**.
3. In the repo tap **Code** > **Codespaces** > **Create codespace on main**. Wait until you see a code editor with a terminal at the bottom.
4. In the left file list, tap the three dots (or long-press) > **Upload...** and choose `elio-phase4.zip` from your phone.
5. In the terminal at the bottom, type these lines one by one (press Enter after each):

```
unzip -o elio-phase4.zip
rm elio-phase4.zip
git add -A
git commit -m "Add Elio"
git push
```

6. Refresh your repo page on GitHub. You should see folders `src`, `worker`, `android-overlay` and files like `package.json`.

## Part 2: Set up Firebase

1. Firebase Console > **Create a project**. Name it `elio`. You can turn Google Analytics off. Do NOT add billing.
2. Left menu **Build** > **Authentication** > **Get started** > **Email/Password** > turn on > **Save**.
3. **Build** > **Firestore Database** > **Create database** > choose **Production mode** > pick a location near you > **Enable**.
4. In Firestore open the **Rules** tab. Delete everything. Open `firestore.rules` from your repo, copy all of it, paste it, tap **Publish**.
5. Tap the gear icon > **Project settings**. Scroll to **Your apps** > tap the web icon `</>` > nickname `elio-web` > **Register app**. Copy the `firebaseConfig` block (the part with apiKey, authDomain, and so on). Keep it somewhere handy.

## Part 3: Put the website online with Vercel

1. vercel.com > **Add New...** > **Project**.
2. Find `elio` in the list > **Import**.
3. Leave everything as it is (Vercel detects Vite by itself). Tap **Deploy**.
4. When it finishes you get a link like `elio-abc123.vercel.app`. Copy the part without `https://`.
5. Go back to Firebase Console > **Authentication** > **Settings** > **Authorized domains** > **Add domain** > paste `elio-abc123.vercel.app` > **Add**. (If you skip this, login will say "unauthorized domain".)
6. Open your Vercel link. You see the **Set up Elio** page:
   - Paste the `firebaseConfig` from Part 2.
   - Paste your OpenRouter key (openrouter.ai/keys > Create key).
   - Leave the model as `openrouter/free`. Tap **Save and continue**.
7. Tap **Create account** with your email and a password. You are in.

Your settings are saved only in your own browser. That is how anyone can use their own keys on the same website.

## Part 4: Start the worker (the AI's computer)

1. Firebase Console > gear > **Project settings** > **Service accounts** tab > **Generate new private key** > confirm. A `.json` file downloads. This file is a password. Never put it in the repo or send it to anyone.
2. GitHub > your repo > **Settings** > **Secrets and variables** > **Codespaces** > **New repository secret**.
   - Name: `FIREBASE_SERVICE_ACCOUNT`. Value: open the downloaded file in a text app, copy ALL of it, paste. **Add secret**.
   - Name: `OPENROUTER_API_KEY`. Value: your OpenRouter key. **Add secret**.
3. Your old codespace does not have the secrets yet. Go to repo > **Code** > **Codespaces**, delete the old one (three dots > Delete), then **Create codespace on main** again.
4. In the terminal type these lines one by one:

```
cd worker
npm install
npm run setup-browser
npm start
```

(`npm run setup-browser` takes a few minutes. It is only needed the first time, in a new Codespace.)

5. You should see `Elio worker is running. Waiting for tasks...`. Leave this tab open. If the codespace sleeps (it stops after about 30 minutes without use), open it again and run `cd worker` and `npm start`.

## Part 5: Give Elio its first task

1. Open your Vercel link and sign in.
2. Type: `Make a one-page website for a bakery with a hero, menu and contact section.` Tap **Give task**.
3. Elio replies with a plan. Tap **Start building**.
4. Watch the Progress box. If Elio asks to approve a command, tap **Approve** or **Deny**.
   When files appear, open **Project files** to preview the website or download a zip.
5. When it finishes, Elio places a call (see Part 7 for the phone). On the website a call screen appears while the page is open. Tap **Test call in the app** on the home screen to try it.

## Part 6: Check these if something fails

- **"unauthorized domain"**: you skipped Part 3 step 5.
- **"Missing or insufficient permissions"**: the rules are not published (Part 2 step 4).
- **Worker says "Missing secrets"**: you made the secrets after creating the codespace. Delete it and create a new one.
- **"OpenRouter error 429"**: the free model is busy. Wait a few minutes and tap Retry.
- **Nothing happens after Start building**: the worker is not running. Check the Codespace terminal.

## Part 7: Android app with calls

Follow `ANDROID.md`. Short version:

1. Firebase > Project settings > **Add app** > Android > package name `app.elio.agent` > download `google-services.json`.
2. Give the Manus agent your GitHub repo link, `google-services.json`, and the prompt written in `ANDROID.md`. It builds `app-debug.apk`.
3. Install the APK on your phone, open it, finish setup, tap **Enable call alerts**.

## Part 8: Share it as open source

1. Check the repo has no keys: it must NOT contain `google-services.json` or any service-account `.json` (they are git-ignored already).
2. Repo > **Settings** > make sure it is **Public**.
3. Add a short description and topics on the repo main page. Done. Anyone can now copy it, use their own Firebase and OpenRouter keys, and run their own Elio.
