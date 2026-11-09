import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "firebase/auth";
import { addDoc, collection, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { getFirebase, loadConfig, saveConfig, clearConfig, parseFirebaseConfig } from "./firebase.js";
import { askElio } from "./openrouter.js";
import Logo from "./Logo.jsx";
import { ApprovalCard, FilesPanel } from "./Files.jsx";
import { IncomingCall, CallScreen, CallSetupCard } from "./Call.jsx";
import { isNative, refreshToken, onCallEvent } from "./native.js";

function Setup({ onDone }) {
  const [fb, setFb] = useState("");
  const [key, setKey] = useState("");
  const [model, setModel] = useState("openrouter/free");
  const [error, setError] = useState("");
  function save() {
    try {
      const firebase = parseFirebaseConfig(fb);
      saveConfig({ firebase, openrouterKey: key.trim(), model: model.trim() || "openrouter/free" });
      onDone();
    } catch (e) { setError(e.message); }
  }
  return (
    <main className="card">
      <Logo size={56} />
      <h1>Set up Elio</h1>
      <p className="muted">Elio runs on your own accounts. Nothing here is sent to us, and it stays in this browser.</p>
      <label htmlFor="fb">Firebase web config</label>
      <textarea id="fb" rows="8" value={fb} onChange={(e) => setFb(e.target.value)} placeholder={'{ apiKey: "...", authDomain: "...", projectId: "...", appId: "..." }'} />
      <label htmlFor="or">OpenRouter API key</label>
      <input id="or" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-or-..." />
      <label htmlFor="md">AI model</label>
      <input id="md" value={model} onChange={(e) => setModel(e.target.value)} />
      <p className="muted">Default openrouter/free picks a free model for you. You can use any model slug ending in :free.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" onClick={save}>Save and continue</button>
    </main>
  );
}

function Login({ fire, onReset }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  async function go(create) {
    setError("");
    try {
      const fn = create ? createUserWithEmailAndPassword : signInWithEmailAndPassword;
      await fn(fire.auth, email, password);
    } catch (e) { setError(e.message); }
  }
  return (
    <main className="card">
      <Logo size={56} />
      <h1>Welcome to Elio</h1>
      <label htmlFor="em">Email</label>
      <input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <label htmlFor="pw">Password</label>
      <input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" onClick={() => go(false)}>Sign in</button>
      <button onClick={() => go(true)}>Create account</button>
      <button className="link" onClick={onReset}>Change setup</button>
    </main>
  );
}

function Home({ fire, user, open }) {
  const [text, setText] = useState("");
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState("");
  const col = collection(fire.db, "users", user.uid, "tasks");
  useEffect(() => {
    const q = query(col, orderBy("createdAt", "desc"));
    return onSnapshot(q, (s) => setTasks(s.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => setError(e.message));
  }, [user.uid]);
  async function add() {
    const t = text.trim();
    if (!t) return;
    try {
      const ref = await addDoc(col, { text: t, status: "queued", createdAt: serverTimestamp() });
      await addDoc(collection(fire.db, "users", user.uid, "tasks", ref.id, "messages"), { role: "user", text: t, createdAt: serverTimestamp() });
      setText("");
      open({ id: ref.id, text: t });
    } catch (e) { setError(e.message); }
  }
  return (
    <main className="card wide">
      <header className="row"><Logo /><button className="link" onClick={() => signOut(fire.auth)}>Sign out</button></header>
      <h1>What should Elio work on?</h1>
      <textarea rows="4" value={text} onChange={(e) => setText(e.target.value)} placeholder="Build a landing page for my bakery..." aria-label="Task" />
      <button className="primary" onClick={add}>Give task</button>
      {error && <p className="error" role="alert">{error}</p>}
      <ul className="tasks">
        {tasks.map((t) => (
          <li key={t.id}>
            <button className="item" onClick={() => open({ id: t.id, text: t.text })}>
              <span>{t.text}</span><em>{t.status}</em>
            </button>
          </li>
        ))}
      </ul>
      <CallSetupCard fire={fire} user={user} />
    </main>
  );
}

function TaskView({ fire, user, task, back }) {
  const taskRef = doc(fire.db, "users", user.uid, "tasks", task.id);
  const col = collection(fire.db, "users", user.uid, "tasks", task.id, "messages");
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [status, setStatus] = useState("");
  const [events, setEvents] = useState([]);
  const handled = useRef(null);
  const endRef = useRef(null);

  useEffect(() => {
    const q = query(col, orderBy("createdAt", "asc"));
    return onSnapshot(q, (s) => setMsgs(s.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => setError(e.message));
  }, [task.id]);

  useEffect(() => onSnapshot(taskRef, (s) => setStatus((s.data() || {}).status || "")), [task.id]);

  useEffect(() => {
    const q = query(collection(fire.db, "users", user.uid, "tasks", task.id, "events"), orderBy("createdAt", "asc"));
    return onSnapshot(q, (s) => setEvents(s.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }, [task.id]);

  const working = status === "build" || status === "working";

  useEffect(() => {
    const last = msgs[msgs.length - 1];
    if (working || !last || last.role !== "user" || handled.current === last.id) return;
    handled.current = last.id;
    (async () => {
      setBusy(true);
      setError("");
      try {
        const r = await askElio(msgs);
        await addDoc(col, { role: "assistant", text: r.text, model: r.model || "", createdAt: serverTimestamp() });
        await updateDoc(taskRef, { status: "planned" });
      } catch (e) { setError(e.message); }
      setBusy(false);
    })();
  }, [msgs, tick, working]);

  useEffect(() => { endRef.current && endRef.current.scrollIntoView({ behavior: "smooth" }); }, [msgs.length, busy]);

  async function send() {
    const t = text.trim();
    if (!t) return;
    setText("");
    try {
      await addDoc(col, { role: "user", text: t, createdAt: serverTimestamp() });
      if (!working) await updateDoc(taskRef, { status: "queued" });
    } catch (e) { setError(e.message); }
  }
  function retry() { handled.current = null; setTick(tick + 1); }

  return (
    <main className="card wide">
      <header className="row"><button className="link" onClick={back}>Back</button><Logo /></header>
      <h2 className="title">{task.text}</h2>
      <div className="chat" aria-live="polite">
        {msgs.map((m) => (<div key={m.id} className={"bubble " + m.role}>{m.text}</div>))}
        {busy && <div className="bubble assistant muted">Elio is thinking...</div>}
        <div ref={endRef} />
      </div>
      <div className="row">
        <span className="status">Status: {status || "new"}</span>
        {!working && <button className="primary small" onClick={() => updateDoc(taskRef, { status: "build" })}>Start building</button>}
      </div>
      <ApprovalCard fire={fire} user={user} task={task} />
      {events.length > 0 && (
        <ul className="events" aria-label="Progress">
          {events.map((e) => (<li key={e.id} className={"ev " + e.type}><b>{e.type}</b> {e.text}</li>))}
        </ul>
      )}
      <FilesPanel fire={fire} user={user} task={task} />
      {error && (<p className="error" role="alert">{error} <button className="link" onClick={retry}>Retry</button></p>)}
      <div className="composer">
        <textarea rows="2" value={text} onChange={(e) => setText(e.target.value)} placeholder="Give Elio a new instruction..." aria-label="Message" />
        <button className="primary" onClick={send}>Send</button>
      </div>
    </main>
  );
}

// Watches for calls from Elio (works on the website and in the Android app).
function useCalls(fire, user) {
  const [call, setCall] = useState(null);
  const wantAccept = useRef(null);
  const uid = user ? user.uid : null;
  useEffect(() => {
    if (!fire || !uid) return;
    const q = query(collection(fire.db, "users", uid, "calls"), where("status", "==", "ringing"));
    return onSnapshot(q, (s) => {
      const fresh = s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((c) => !c.createdAt || Date.now() - c.createdAt.toMillis() < 60000);
      setCall((cur) => {
        if (cur) return !cur.accepted && !cur.local && !fresh.some((c) => c.id === cur.id) ? null : cur;
        return fresh[0] ? { ...fresh[0], accepted: wantAccept.current === fresh[0].id } : null;
      });
    });
  }, [uid, !!fire]);
  useEffect(() => {
    if (!isNative) return;
    let handle = null;
    onCallEvent((ev) => {
      if (ev.callId === "test") {
        setCall({ id: "test", local: true, reason: "test", taskId: null, message: "This is a test call. Calls from Elio will ring just like this.", accepted: ev.action === "accept" });
        return;
      }
      if (ev.action === "accept") {
        wantAccept.current = ev.callId;
        setCall((cur) => (cur && cur.id === ev.callId ? { ...cur, accepted: true } : cur));
      }
    }).then((h) => { handle = h; });
    return () => { if (handle) handle.remove(); };
  }, []);
  return [call, setCall];
}

export default function App() {
  const [configured, setConfigured] = useState(!!loadConfig());
  const [user, setUser] = useState(undefined);
  const [task, setTask] = useState(null);
  const fire = configured ? getFirebase() : null;
  const [call, setCall] = useCalls(fire, user);
  useEffect(() => {
    if (fire && user && isNative) refreshToken(fire, user).catch(() => {});
  }, [user && user.uid]);
  useEffect(() => {
    if (!fire) return;
    return onAuthStateChanged(fire.auth, (u) => setUser(u || null));
  }, [configured]);
  if (!fire) return <Setup onDone={() => setConfigured(true)} />;
  if (user === undefined) return <main className="card"><p className="muted">Loading...</p></main>;
  if (!user) return <Login fire={fire} onReset={() => { clearConfig(); setConfigured(false); }} />;
  if (call && !call.accepted) return <IncomingCall fire={fire} user={user} call={call} onAnswer={() => setCall({ ...call, accepted: true })} onClose={() => setCall(null)} />;
  if (call && call.accepted) return <CallScreen fire={fire} user={user} call={call} onEnd={() => setCall(null)} />;
  if (task) return <TaskView fire={fire} user={user} task={task} back={() => setTask(null)} />;
  return <Home fire={fire} user={user} open={setTask} />;
}
