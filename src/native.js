import { Capacitor, registerPlugin } from "@capacitor/core";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

// Bridge to the Android code in android-overlay/. On the website these do nothing.
export const isNative = Capacitor.isNativePlatform();
const ElioCall = isNative ? registerPlugin("ElioCall") : null;

async function saveToken(fire, user) {
  const { token } = await ElioCall.getToken();
  await setDoc(doc(fire.db, "users", user.uid, "devices", token), { platform: "android", updatedAt: serverTimestamp() }, { merge: true });
}

// Ask for permission (if needed), then register this phone so Elio can ring it.
export async function enableCallAlerts(fire, user) {
  if (!ElioCall) return { ok: false, reason: "Phone call alerts need the Android app." };
  let perm = await ElioCall.checkPermissions();
  if (perm.notifications !== "granted") perm = await ElioCall.requestPermissions();
  if (perm.notifications !== "granted") return { ok: false, reason: "Notifications are blocked. Allow them in Android settings." };
  await saveToken(fire, user);
  const fs = await ElioCall.canUseFullScreenIntent();
  return { ok: true, fullScreen: fs.allowed };
}

// On every launch, quietly refresh the token if permission was already granted.
export async function refreshToken(fire, user) {
  if (!ElioCall) return;
  const perm = await ElioCall.checkPermissions();
  if (perm.notifications === "granted") await saveToken(fire, user);
}

export async function onCallEvent(cb) {
  return ElioCall ? ElioCall.addListener("callReceived", cb) : null;
}
export const openFullScreenSettings = () => ElioCall && ElioCall.openFullScreenSettings();
export const simulateCall = (delayMs) => ElioCall && ElioCall.simulateCall({ delayMs });
export const endCallNative = () => (ElioCall ? ElioCall.endCall().catch(() => {}) : Promise.resolve());
