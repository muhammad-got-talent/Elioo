# Elio worker

The worker is Elio's computer. It watches Firestore for tasks marked "build", asks the AI what to do, and runs the AI's file and command tools inside `worker/projects/<task>/`. Progress streams back to the app.

## Set it up (from a phone, free)

1. In Firebase Console: Project settings > Service accounts > **Generate new private key**. A JSON file downloads. Treat it like a password and never commit it.
2. On GitHub: open this repo > Settings > Secrets and variables > **Codespaces** > New repository secret. Add:
   - `FIREBASE_SERVICE_ACCOUNT`: paste the whole JSON
   - `OPENROUTER_API_KEY`: your OpenRouter key
   - `ELIO_MODEL` (optional): defaults to `openrouter/free`
3. Open the repo in a Codespace (Code > Codespaces > Create), so the secrets load.
4. Run:

```
cd worker
npm install
npm run setup-browser
npm start
```

`npm run setup-browser` downloads a headless Chrome (a few minutes, once). It lets Elio open the pages it builds, find errors and take a screenshot. Everything else works without it.

Leave it running. In the app, open a task and tap **Start building**.

## Calls

The AI can call you with the `call_user` tool, and Elio always calls when a task finishes or gets stuck. Calls need the Android app set up per `ANDROID.md`. Without it, calls still ring on the website while the page is open.

## Approvals, preview and download

- Risky-but-useful commands (recursive delete, downloading scripts, global installs, git clone, pip install) pause and show an **Approve / Deny** card in the app, and Elio calls you. No answer in 5 minutes counts as Deny.
- Files Elio writes appear in the app under **Project files**: view them, **Preview** a simple website, or **Download zip**. Text files and small images up to 400 KB each are kept in your Firestore (the free Spark plan, so no Firebase Storage).

## Safety

- File tools cannot leave the project folder.
- Commands run with a stripped environment, so the AI cannot see your keys.
- Never allowed: sudo, absolute paths, leaving the project folder, reading secrets, ssh, git push.
- Commands stop after 90 seconds. Elio tests pages with its own built-in browser tool instead of dev servers.

## Free-tier notes

Codespaces has a monthly free allowance and sleeps when idle. Reopen it and run `npm start` again. Free OpenRouter models can be slow or rate limited; the worker retries a few times.
