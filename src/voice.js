import { Capacitor } from "@capacitor/core";

// Voice for calls. On Android it uses the phone's own speech engines (free, no keys).
// On the website it uses the browser's Web Speech API (works best in Chrome).
const native = Capacitor.isNativePlatform();
let webRecognition = null;

export async function prepareMic() {
  if (!native) return;
  const { SpeechRecognition } = await import("@capacitor-community/speech-recognition");
  const p = await SpeechRecognition.requestPermissions();
  if (p.speechRecognition !== "granted") throw new Error("Microphone permission denied");
}

export async function speak(text) {
  if (native) {
    const { TextToSpeech } = await import("@capacitor-community/text-to-speech");
    await TextToSpeech.speak({ text, lang: "en-US", rate: 1.0, pitch: 1.0, volume: 1.0 });
    return;
  }
  if (!("speechSynthesis" in window)) return;
  await new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.onend = resolve;
    u.onerror = resolve;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  });
}

// Listens for one phrase and returns it as text.
export async function listen() {
  if (native) {
    const { SpeechRecognition } = await import("@capacitor-community/speech-recognition");
    const r = await SpeechRecognition.start({ language: "en-US", maxResults: 1, partialResults: false, popup: false });
    return (r.matches && r.matches[0]) || "";
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) throw new Error("This browser has no speech recognition. Type your message instead.");
  return new Promise((resolve, reject) => {
    const rec = new SR();
    webRecognition = rec;
    rec.lang = "en-US";
    rec.onresult = (e) => resolve(e.results[0][0].transcript);
    rec.onerror = (e) => (e.error === "no-speech" || e.error === "aborted" ? resolve("") : reject(new Error(e.error)));
    rec.onend = () => resolve("");
    rec.start();
  });
}

export async function stopVoice() {
  try {
    if (native) {
      const { SpeechRecognition } = await import("@capacitor-community/speech-recognition");
      const { TextToSpeech } = await import("@capacitor-community/text-to-speech");
      await SpeechRecognition.stop().catch(() => {});
      await TextToSpeech.stop().catch(() => {});
    } else {
      if (webRecognition) webRecognition.abort();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    }
  } catch { /* nothing to stop */ }
}

// Simple ring: two tones every 2.5 seconds, plus vibration where supported.
let ctx = null;
let timer = null;
export function startRing() {
  stopRing();
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const beep = () => {
      [0, 0.45].forEach((t, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = i ? 520 : 440;
        g.gain.value = 0.12;
        o.connect(g);
        g.connect(ctx.destination);
        o.start(ctx.currentTime + t);
        o.stop(ctx.currentTime + t + 0.35);
      });
      if (navigator.vibrate) navigator.vibrate([400, 200, 400]);
    };
    beep();
    timer = setInterval(beep, 2500);
  } catch { /* audio not allowed yet */ }
}
export function stopRing() {
  if (timer) clearInterval(timer);
  timer = null;
  if (ctx) ctx.close().catch(() => {});
  ctx = null;
  if (navigator.vibrate) navigator.vibrate(0);
}
