# Elio

An open-source autonomous AI employee. Give it a task and it plans, writes code, runs commands and fixes bugs. When it has news, it calls you inside the app.

Free to run. Bring your own keys: nothing is hosted for you and no secrets live in this repo.

New here? Read **SETUP_GUIDE.md** for the full step-by-step guide.

## Quick start (about 15 minutes, all from a phone)

**A. Firebase (website + data)**
1. console.firebase.google.com > create a project (no billing).
2. Authentication > enable **Email/Password**.
3. Firestore Database > create (production mode) > Rules tab > paste `firestore.rules` > Publish.
4. Project settings > Your apps > Web app > copy the `firebaseConfig`.
5. Create a free key at openrouter.ai/keys.

**B. Website**
Open the repo in GitHub Codespaces, then `npm install && npm run dev`. Paste the Firebase config and OpenRouter key on the setup page.

**C. Worker (the AI's computer)**
Follow `worker/README.md`. It runs in a Codespace and does the real work.

**D. Android app**
Follow `ANDROID.md`. It builds an APK with calls and notifications.

## Free-tier notes

Firebase Spark, OpenRouter free models and Codespaces hours all have limits that may change. They are fine for personal use.

## Contributing

Fork, make a branch, open a pull request. Never commit keys, `google-services.json` or service-account files.

## License

MIT, see `LICENSE`.
