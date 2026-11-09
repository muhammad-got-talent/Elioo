import { useEffect, useRef, useState } from "react";
import { addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, updateDoc } from "firebase/firestore";
import Logo from "./Logo.jsx";
import { askElio } from "./openrouter.js";
import { speak, listen, stopVoice, startRing, stopRing, prepareMic } from "./voice.js";
import { isNative, enableCallAlerts, openFullScreenSettings, simulateCall, endCallNative } from "./native.js";

const callDoc = (fire, user, id) => doc(fire.db, "users", user.uid, "calls", id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BYE = /\b(bye|goodbye|that'?s all|hang up|talk later)\b/i;
const LABELS = { update: "Task update", question: "Needs your input", done: "Task finished", error: "Needs attention", test: "Test call" };

function Icon({ kind }) {
  return kind === "accept" ? (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0A0A0A" strokeWidth="2.5"><path d="M5 12 L10 17 L19 7" /></svg>
  ) : (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0A0A0A" strokeWidth="2.5"><path d="M6 6 L18 18 M18 6 L6 18" /></svg>
  );
}

export function IncomingCall({ fire, user, call, onAnswer, onClose }) {
  useEffect(() => {
    startRing();
    const t = setTimeout(onClose, 45000);
    return () => { stopRing(); clearTimeout(t); };
  }, []);
  async function decline() {
    stopRing();
    if (!call.local) await updateDoc(callDoc(fire, user, call.id), { status: "declined" }).catch(() => {});
    onClose();
  }
  return (
    <main className="call ringing" aria-label="Incoming call">
      <div className="pulse ring"><Logo size={88} /></div>
      <p className="muted">Incoming call</p>
      <h1>Elio</h1>
      <p>{LABELS[call.reason] || "Call"}{call.taskTitle ? ": " + call.taskTitle : ""}</p>
      <div className="actions">
        <button className="round decline" aria-label="Decline" onClick={decline}><Icon kind="decline" /></button>
        <button className="round accept" aria-label="Answer" onClick={() => { stopRing(); onAnswer(); }}><Icon kind="accept" /></button>
      </div>
    </main>
  );
}

function callSystem(call, events) {
  return (
    "You are Elio, an AI employee on a live voice call with your user. Reply in one or two short spoken sentences. No markdown, no lists, no emojis. " +
    "If the user gives an instruction or asks for a change, confirm it briefly and say you will get on it right after the call. If they say goodbye, say a short goodbye." +
    (call.taskTitle ? "\nTask: " + call.taskTitle : "") +
    (events ? "\nRecent progress:\n" + events : "")
  );
}

export function CallScreen({ fire, user, call, onEnd }) {
  const [lines, setLines] = useState([]);
  const [phase, setPhase] = useState("connecting");
  const [note, setNote] = useState("");
  const [text, setText] = useState("");
  const alive = useRef(true);
  const finished = useRef(false);
  const spoke = useRef(false);
  const history = useRef([]);
  const queue = useRef([]);
  const system = useRef("");
  const taskRef = call.taskId ? doc(fire.db, "users", user.uid, "tasks", call.taskId) : null;

  const add = (who, t) => setLines((l) => [...l, { who, t }]);
  async function persist(role, t) {
    if (taskRef) await addDoc(collection(taskRef, "messages"), { role, text: t, via: "call", createdAt: serverTimestamp() }).catch(() => {});
  }
  async function say(t) {
    add("elio", t);
    history.current.push({ role: "assistant", text: t });
    setPhase("speaking");
    try { await speak(t); } catch { /* keep the call going even if speech fails */ }
  }
  async function handle(t) {
    add("you", t);
    history.current.push({ role: "user", text: t });
    await persist("user", t);
    if (BYE.test(t)) { await say("Okay, talk soon."); return true; }
    spoke.current = true;
    setPhase("thinking");
    try {
      const r = await askElio(history.current, system.current);
      await persist("assistant", r.text);
      await say(r.text);
    } catch (e) {
      setNote(e.message);
      await say("Sorry, I lost my connection for a moment.");
    }
    return false;
  }
  async function finish() {
    if (finished.current) return;
    finished.current = true;
    await stopVoice();
    if (!call.local) await updateDoc(callDoc(fire, user, call.id), { status: "ended" }).catch(() => {});
    if (spoke.current && taskRef) {
      try {
        const s = await getDoc(taskRef);
        const st = (s.data() || {}).status;
        if (st !== "build" && st !== "working") await updateDoc(taskRef, { status: "build" }); // resume work with the new instructions
      } catch { /* ignore */ }
    }
    await endCallNative();
    onEnd();
  }

  useEffect(() => {
    alive.current = true;
    (async () => {
      if (!call.local) await updateDoc(callDoc(fire, user, call.id), { status: "accepted" }).catch(() => {});
      let events = "";
      if (taskRef) {
        try {
          const m = await getDocs(query(collection(taskRef, "messages"), orderBy("createdAt", "desc"), limit(12)));
          history.current = m.docs.map((d) => ({ role: d.data().role, text: d.data().text })).reverse();
          const e = await getDocs(query(collection(taskRef, "events"), orderBy("createdAt", "desc"), limit(8)));
          events = e.docs.map((d) => d.data().type + ": " + d.data().text).reverse().join("\n");
        } catch { /* the call still works without context */ }
      }
      system.current = callSystem(call, events);
      await prepareMic().catch(() => setNote("Microphone blocked. You can type instead."));
      await say(call.message);
      let silent = 0;
      while (alive.current) {
        setPhase("listening");
        let heard = queue.current.shift() || "";
        if (!heard) {
          try { heard = await listen(); }
          catch { if (!queue.current.length) { setNote("I could not hear you. Type a message below."); await sleep(2500); } }
          if (!heard) heard = queue.current.shift() || "";
        }
        if (!alive.current) break;
        if (!heard.trim()) {
          if (++silent >= 5) { await say("I can't hear you, so I'll let you go. Call me back anytime."); break; }
          continue;
        }
        silent = 0;
        if (await handle(heard.trim())) break;
      }
      await finish();
    })();
    return () => { alive.current = false; stopVoice(); };
  }, []);

  function sendTyped() {
    const t = text.trim();
    if (!t) return;
    setText("");
    queue.current.push(t);
    stopVoice(); // interrupts listening so the typed message is used right away
  }
  function end() { alive.current = false; stopVoice(); }

  const status = { connecting: "Connecting...", speaking: "Elio is speaking", listening: "Listening", thinking: "Thinking" }[phase];
  return (
    <main className="call" aria-label="Call with Elio">
      <div className={"pulse " + phase}><Logo size={72} /></div>
      <h1>Elio</h1>
      <p className="muted">{status}</p>
      <div className="transcript" aria-live="polite">
        {lines.slice(-6).map((l, i) => (<p key={i} className={l.who}><b>{l.who === "you" ? "You" : "Elio"}</b> {l.t}</p>))}
      </div>
      {note && <p className="error" role="alert">{note}</p>}
      <div className="composer">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendTyped()} placeholder="Type instead of speaking..." aria-label="Type a message" />
        <button onClick={sendTyped}>Send</button>
      </div>
      <button className="round decline end" aria-label="End call" onClick={end}><Icon kind="decline" /></button>
    </main>
  );
}

export function CallSetupCard({ fire, user }) {
  const [msg, setMsg] = useState("");
  const [full, setFull] = useState(null);
  async function enable() {
    try {
      const r = await enableCallAlerts(fire, user);
      if (!r.ok) setMsg(r.reason);
      else { setFull(r.fullScreen); setMsg("Call alerts are on for this phone."); }
    } catch (e) { setMsg(e.message); }
  }
  async function testInApp() {
    await addDoc(collection(fire.db, "users", user.uid, "calls"), {
      taskId: null, taskTitle: "", reason: "test", status: "ringing",
      message: "This is a test call from Elio. If you can hear me, calls work.",
      createdAt: serverTimestamp(),
    });
  }
  return (
    <section className="panel">
      <h3>Calls</h3>
      <p className="muted">Elio rings you here when it has news.</p>
      {isNative && <button onClick={enable}>Enable call alerts</button>}
      {isNative && full === false && <button onClick={openFullScreenSettings}>Allow full-screen calls</button>}
      {isNative && <button onClick={() => { simulateCall(8000); setMsg("Lock your phone now. It will ring in 8 seconds."); }}>Test while locked</button>}
      <button onClick={testInApp}>Test call in the app</button>
      {msg && <p className="muted" role="status">{msg}</p>}
    </section>
  );
}
