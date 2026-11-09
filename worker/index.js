import admin from "firebase-admin";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import http from "node:http";

// Secrets come from environment variables (Codespaces secrets), never from the repo.
const SERVICE_ACCOUNT = process.env.FIREBASE_SERVICE_ACCOUNT;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.ELIO_MODEL || "openrouter/free";
if (!SERVICE_ACCOUNT || !OPENROUTER_KEY) {
  console.error("Missing secrets. Set FIREBASE_SERVICE_ACCOUNT and OPENROUTER_API_KEY (see worker/README.md).");
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(SERVICE_ACCOUNT)) });
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const ROOT = path.resolve("projects");
const MAX_STEPS = 30;

const SYSTEM =
  "You are Elio, an autonomous AI employee that builds websites and apps. " +
  "Work only inside the project folder using the tools. Prefer plain HTML, CSS and JavaScript with no build step unless the user asks for a framework. " +
  "Create files with write_file, check your work with run_command (for example node --check file.js), fix any errors you find. For web pages, use test_page to open the page in a browser and fix every problem it reports. Then call finish with a short summary. " +
  "Never try to read files outside the project folder and never ask for secrets. Do not start long-running servers; commands are stopped after 90 seconds. " +
  "Use call_user only for important updates or when you truly need the user's decision, at most a couple of times. Do not call for small progress.";

const TOOLS = [
  fn("list_files", "List files in the project folder (or a subfolder).", { path: { type: "string" } }, []),
  fn("read_file", "Read a text file in the project folder.", { path: { type: "string" } }, ["path"]),
  fn("write_file", "Create or overwrite a file in the project folder.", { path: { type: "string" }, content: { type: "string" } }, ["path", "content"]),
  fn("run_command", "Run a shell command inside the project folder.", { command: { type: "string" } }, ["command"]),
  fn("test_page", "Open a page of the project in a headless mobile browser and report errors, visible text and broken images. Optionally click CSS selectors in order first.", { path: { type: "string" }, click: { type: "array", items: { type: "string" } } }, []),
  fn("call_user", "Place a voice call to the user for an important update or when you need their decision. You can keep working after calling.", { reason: { type: "string", enum: ["update", "question", "done", "error"] }, message: { type: "string", description: "What you say first when they answer. One or two short sentences." } }, ["reason", "message"]),
  fn("finish", "Call when the task is complete, with a short summary for the user.", { summary: { type: "string" } }, ["summary"]),
];
function fn(name, description, properties, required) {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, required } } };
}

// ---------- safety ----------
function safe(dir, p = ".") {
  const full = path.resolve(dir, p);
  if (full !== dir && !full.startsWith(dir + path.sep)) throw new Error("Path is outside the project folder.");
  return full;
}

function riskReason(cmd) {
  const checks = [
    [/\bsudo\b/, "sudo is not allowed"],
    [/\.\.\//, "cannot leave the project folder"],
    [/(^|[\s"'=:])~/, "cannot use the home folder"],
    [/(^|[\s"'=])\/(?!dev\/null)[A-Za-z]/, "absolute paths are not allowed"],
    [/\b(printenv|env)\b|\$\{?[A-Z_]*(KEY|SECRET|TOKEN|ACCOUNT)/, "reading environment secrets is not allowed"],
    [/\b(ssh|scp|git\s+push|mkfs|dd\s+if=|shutdown|reboot)\b/, "this command is not allowed"],
  ];
  for (const [re, why] of checks) if (re.test(cmd)) return why;
  return null;
}

// Commands that are allowed only if the user approves them in the app.
function needsApproval(cmd) {
  const asks = [
    [/\brm\s+(-\w*[rR]\w*|--recursive)/, "recursive delete"],
    [/\b(curl|wget)\b[^|]*\|\s*(ba|z)?sh\b/, "runs a script downloaded from the internet"],
    [/\bnpm\s+(i|install|add)\b[^&;|]*(-g\b|--global)/, "global install"],
    [/\bgit\s+clone\b/, "downloads a repository"],
    [/\bpip3?\s+install\b/, "installs Python packages"],
  ];
  for (const [re, why] of asks) if (re.test(cmd)) return why;
  return null;
}

// ---------- tools ----------
async function listFiles(dir, p) {
  const base = safe(dir, p || ".");
  const out = [];
  async function walk(d) {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      if (out.length >= 200) return;
      if (e.name === "node_modules" || e.name === ".git" || e.name === ".npm") continue;
      const f = path.join(d, e.name);
      out.push(path.relative(dir, f) + (e.isDirectory() ? "/" : ""));
      if (e.isDirectory()) await walk(f);
    }
  }
  await walk(base);
  return out.join("\n") || "(empty)";
}

function runCommand(dir, command) {
  return new Promise((resolve) => {
    // The AI's commands get a minimal environment, so our secrets are never visible to them.
    const child = spawn("bash", ["-c", command], {
      cwd: dir,
      env: { PATH: process.env.PATH, HOME: dir, CI: "1", npm_config_yes: "true" },
    });
    let out = "";
    const add = (d) => { out += d.toString(); if (out.length > 20000) out = out.slice(-20000); };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    const timer = setTimeout(() => { child.kill("SIGKILL"); out += "\n[stopped after 90 seconds]"; }, 90000);
    child.on("close", (code) => { clearTimeout(timer); resolve("exit code " + code + "\n" + out.slice(-4000)); });
    child.on("error", (e) => { clearTimeout(timer); resolve("could not start: " + e.message); });
  });
}

async function execTool(dir, name, a, log, ctx) {
  if (name === "list_files") { await log("list", a.path || "."); return listFiles(dir, a.path); }
  if (name === "read_file") { await log("read", a.path); return (await fs.readFile(safe(dir, a.path), "utf8")).slice(0, 20000); }
  if (name === "write_file") {
    const f = safe(dir, a.path);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, a.content ?? "");
    await upsertFile(ctx.ref, path.relative(dir, f), a.content ?? "").catch(() => {});
    await log("file", "Wrote " + a.path + " (" + (a.content || "").length + " characters)");
    return "ok";
  }
  if (name === "run_command") {
    const why = riskReason(a.command || "");
    if (why) {
      await log("blocked", "Blocked: " + a.command + " (" + why + ")");
      return "Blocked: " + why + ". Approval is not available yet, so choose a safer approach.";
    }
    const ask = needsApproval(a.command || "");
    if (ask) {
      const ok = await askApproval(ctx, a.command, ask, log);
      if (!ok) { await log("blocked", "Not approved: " + a.command); return "The user did not approve this command. Choose a different approach."; }
    }
    await log("command", a.command);
    const out = await runCommand(dir, a.command);
    await log("output", out.slice(0, 800));
    return out;
  }
  if (name === "finish") { await log("done", a.summary || "Done."); return "ok"; }
  if (name === "test_page") {
    await log("test", a.path || "index.html");
    const r = await testPage(dir, a, ctx);
    await log("test", r.slice(0, 800));
    return r;
  }
  if (name === "call_user") {
    if (ctx.calls >= 3) return "Call limit reached for this task. Keep working without calling.";
    ctx.calls++;
    await placeCall(ctx.ref, ctx.uid, a.reason || "update", a.message || "I have an update.", log);
    return "Call placed. Keep working; the user's replies arrive as messages.";
  }
  throw new Error("Unknown tool: " + name);
}

// ---------- approvals ----------
async function askApproval(ctx, command, why, log) {
  const apRef = ctx.ref.collection("approvals").doc();
  await apRef.set({ command, reason: why, status: "pending", createdAt: FieldValue.serverTimestamp() });
  await log("approval", "Waiting for your approval (" + why + "): " + command);
  if (ctx.calls < 3) {
    ctx.calls++;
    await placeCall(ctx.ref, ctx.uid, "question", "I need your approval to run a command. Please check the app.", log).catch(() => {});
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => { unsub(); apRef.update({ status: "expired" }).catch(() => {}); resolve(false); }, 5 * 60 * 1000);
    const unsub = apRef.onSnapshot((snap) => {
      const st = snap.data() && snap.data().status;
      if (st === "approved" || st === "denied") { clearTimeout(timer); unsub(); resolve(st === "approved"); }
    });
  });
}

// ---------- files for preview and download ----------
const TEXT = new Set([".html", ".css", ".js", ".mjs", ".json", ".md", ".txt", ".svg", ".xml", ".ts", ".tsx", ".jsx", ".py", ".yml", ".yaml", ".csv"]);
const IMAGE = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
const fileId = (rel) => encodeURIComponent(rel.split(path.sep).join("/"));

async function upsertFile(ref, rel, content) {
  const p = rel.split(path.sep).join("/");
  if (!TEXT.has(path.extname(p).toLowerCase()) || content.length > 400000) return;
  await ref.collection("files").doc(fileId(p)).set({ path: p, content, binary: false, updatedAt: FieldValue.serverTimestamp() });
}
async function upsertImage(ref, rel, buffer, mime) {
  const p = rel.split(path.sep).join("/");
  await ref.collection("files").doc(fileId(p)).set({ path: p, dataUrl: "data:" + mime + ";base64," + buffer.toString("base64"), binary: true, updatedAt: FieldValue.serverTimestamp() });
}

async function syncFiles(dir, ref) {
  const found = [];
  async function walk(d) {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      if (found.length >= 120) return;
      if (["node_modules", ".git", ".npm", ".cache"].includes(e.name)) continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) await walk(f); else found.push(f);
    }
  }
  await walk(dir);
  const keep = new Set();
  for (const f of found) {
    const rel = path.relative(dir, f).split(path.sep).join("/");
    const ext = path.extname(rel).toLowerCase();
    const size = (await fs.stat(f)).size;
    if (TEXT.has(ext) && size <= 400000) { await upsertFile(ref, rel, await fs.readFile(f, "utf8")); keep.add(fileId(rel)); }
    else if (IMAGE[ext] && size <= 300000) { await upsertImage(ref, rel, await fs.readFile(f), IMAGE[ext]); keep.add(fileId(rel)); }
  }
  const old = await ref.collection("files").get();
  await Promise.all(old.docs.filter((d) => !keep.has(d.id)).map((d) => d.ref.delete()));
}

// ---------- browser testing ----------
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".txt": "text/plain" };

function serve(dir) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
        if (p.endsWith("/")) p += "index.html";
        const file = safe(dir, "." + p);
        const data = await fs.readFile(file);
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
        res.end(data);
      } catch { res.writeHead(404); res.end("not found"); }
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function testPage(dir, a, ctx) {
  let chromium;
  try { ({ chromium } = await import("playwright")); }
  catch { return "Browser testing is not installed. Ask the user to run: npm run setup-browser (in the worker folder)."; }
  const file = a.path || "index.html";
  try { await fs.access(safe(dir, file)); } catch { return "File not found: " + file; }
  const server = await serve(dir);
  const base = "http://127.0.0.1:" + server.address().port;
  let browser;
  try { browser = await chromium.launch(); }
  catch (e) { server.close(); return "Could not start the browser: " + e.message.slice(0, 200) + ". Ask the user to run: npm run setup-browser"; }
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
    page.on("pageerror", (e) => errors.push("page error: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console error: " + m.text()); });
    page.on("requestfailed", (r) => errors.push("failed request: " + r.url().replace(base, "")));
    await page.goto(base + "/" + file, { waitUntil: "load", timeout: 15000 });
    for (const sel of a.click || []) {
      try { await page.click(sel, { timeout: 3000 }); } catch { errors.push("could not click " + sel); }
    }
    await page.waitForTimeout(500);
    const info = await page.evaluate(() => ({
      title: document.title,
      text: document.body ? document.body.innerText : "",
      buttons: document.querySelectorAll("button, a").length,
      brokenImages: [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).length,
    }));
    const shot = await page.screenshot({ type: "jpeg", quality: 60 });
    await fs.writeFile(path.join(dir, "screenshot.jpg"), shot);
    await upsertImage(ctx.ref, "screenshot.jpg", shot, "image/jpeg").catch(() => {});
    return [
      "Page title: " + (info.title || "(none)"),
      "Visible text: " + (info.text.replace(/\s+/g, " ").slice(0, 400) || "(empty page)"),
      "Buttons and links: " + info.buttons,
      info.brokenImages ? "Broken images: " + info.brokenImages : "",
      errors.length ? "Problems:\n" + errors.slice(0, 10).join("\n") : "No errors found.",
    ].filter(Boolean).join("\n");
  } catch (e) {
    return "Test failed: " + e.message.slice(0, 300);
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
}

// ---------- calling the user ----------
async function placeCall(ref, uid, reason, message, log) {
  const task = (await ref.get()).data() || {};
  const callRef = db.collection("users").doc(uid).collection("calls").doc();
  await callRef.set({ taskId: ref.id, taskTitle: task.text || "", reason, message, status: "ringing", createdAt: FieldValue.serverTimestamp() });
  await log("call", "Calling you: " + message);
  // The in-app screen appears through Firestore. The push below wakes the phone when the app is closed.
  const devices = await db.collection("users").doc(uid).collection("devices").get();
  if (!devices.empty) {
    const res = await admin.messaging().sendEachForMulticast({
      tokens: devices.docs.map((d) => d.id),
      data: { type: "call", callId: callRef.id, taskId: ref.id, title: "Elio is calling", body: message.slice(0, 120) },
      android: { priority: "high", ttl: 45000 },
    });
    res.responses.forEach((r, i) => {
      const code = (r.error && r.error.code) || "";
      if (!r.success && /not-registered|invalid-registration|invalid-argument/.test(code)) devices.docs[i].ref.delete();
    });
  }
  setTimeout(async () => {
    const s = await callRef.get();
    if (s.exists && s.data().status === "ringing") {
      await callRef.update({ status: "missed" });
      await ref.collection("messages").add({ role: "assistant", text: "Missed call from Elio: " + message, createdAt: FieldValue.serverTimestamp() });
    }
  }, 45000);
}

// ---------- model ----------
async function chat(messages) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + OPENROUTER_KEY, "Content-Type": "application/json", "X-Title": "Elio worker" },
      body: JSON.stringify({ model: MODEL, messages, tools: TOOLS }),
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 5000 * attempt));
      continue;
    }
    if (!res.ok) throw new Error("OpenRouter " + res.status + ": " + (await res.text()).slice(0, 200));
    const data = await res.json();
    const msg = data.choices && data.choices[0] && data.choices[0].message;
    if (!msg) throw new Error("Empty response from the model.");
    return msg;
  }
  throw new Error("The model is busy or rate limited. Try again in a few minutes.");
}

// ---------- one task ----------
async function runTask(ref) {
  const uid = ref.parent.parent.id;
  const dir = path.join(ROOT, uid + "-" + ref.id);
  await fs.mkdir(dir, { recursive: true });
  const events = ref.collection("events");
  const msgsCol = ref.collection("messages");
  const ctx = { ref, uid, calls: 0 };
  const log = (type, text) => events.add({ type, text: String(text).slice(0, 2000), createdAt: FieldValue.serverTimestamp() });

  const history = [{ role: "system", content: SYSTEM }];
  const seen = new Set();
  async function pullMessages() {
    const s = await msgsCol.orderBy("createdAt").get();
    for (const d of s.docs) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const m = d.data();
      history.push({ role: m.role === "assistant" ? "assistant" : "user", content: m.text });
    }
  }

  await log("start", "Elio started working.");
  let status = "failed";
  let summary = "";
  try {
    let nudges = 0;
    for (let step = 0; step < MAX_STEPS; step++) {
      await pullMessages(); // picks up new instructions the user sent meanwhile
      const msg = await chat(history);
      const calls = msg.tool_calls || [];
      const clean = { role: "assistant", content: msg.content || "" };
      if (calls.length) clean.tool_calls = calls;
      history.push(clean);
      if (msg.content) await log("thought", msg.content);

      if (!calls.length) {
        if (++nudges > 2) { summary = msg.content || "Stopped without finishing."; break; }
        history.push({ role: "user", content: "Continue using the tools, or call finish when the task is complete." });
        continue;
      }
      nudges = 0;
      let finished = false;
      for (const call of calls) {
        let args = {};
        try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* bad JSON from the model */ }
        let result;
        try { result = await execTool(dir, call.function.name, args, log, ctx); }
        catch (e) { result = "Error: " + e.message; await log("error", e.message); }
        if (call.function.name === "finish") { finished = true; status = "done"; summary = args.summary || "Done."; }
        history.push({ role: "tool", tool_call_id: call.id, content: String(result).slice(0, 6000) });
      }
      if (finished) break;
    }
    if (!summary) summary = "I reached my step limit before finishing. Send a message and press Start building to continue.";
  } catch (e) {
    summary = "I stopped because of an error: " + e.message;
    await log("error", e.message);
  }

  await syncFiles(dir, ref).catch((e) => console.error("File sync failed:", e.message));
  const where = "worker/projects/" + uid + "-" + ref.id;
  await msgsCol.add({
    role: "assistant",
    text: summary + (status === "done" ? "\n\nYour files are in " + where : ""),
    createdAt: FieldValue.serverTimestamp(),
  });
  await ref.update({ status });
  const short = summary.length > 160 ? summary.slice(0, 157) + "..." : summary;
  await placeCall(ref, uid, status === "done" ? "done" : "error", (status === "done" ? "I finished your task. " : "I got stuck. ") + short, log)
    .catch((e) => console.error("Could not place call:", e.message));
}

// ---------- watch for tasks ----------
const running = new Set();
let chain = Promise.resolve();

async function claim(ref) {
  return db.runTransaction(async (t) => {
    const s = await t.get(ref);
    if (s.data().status !== "build") return false;
    t.update(ref, { status: "working" });
    return true;
  });
}

db.collectionGroup("tasks").onSnapshot(
  (snap) => {
    for (const ch of snap.docChanges()) {
      if (ch.type === "removed") continue;
      const ref = ch.doc.ref;
      const status = ch.doc.data().status;
      if (status === "working" && !running.has(ref.path)) { ref.update({ status: "build" }); continue; } // left over from a crash
      if (status !== "build" || running.has(ref.path)) continue;
      running.add(ref.path);
      chain = chain.then(async () => {
        try { if (await claim(ref)) await runTask(ref); }
        catch (e) { console.error("Task failed:", e); }
        finally { running.delete(ref.path); }
      });
    }
  },
  (e) => console.error("Listener error:", e.message)
);

console.log("Elio worker is running. Waiting for tasks...");
