import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// BYOK: every installation uses its own config, stored only in this browser.
const KEY = "elio.config";

export function loadConfig() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}
export function saveConfig(config) { localStorage.setItem(KEY, JSON.stringify(config)); }
export function clearConfig() { localStorage.removeItem(KEY); }

export function parseFirebaseConfig(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No config object found.");
  const json = match[0]
    .replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":')
    .replace(/'/g, '"')
    .replace(/,\s*}/g, "}");
  const config = JSON.parse(json);
  for (const k of ["apiKey", "authDomain", "projectId", "appId"]) {
    if (!config[k]) throw new Error("Missing field: " + k);
  }
  return config;
}

export function getFirebase() {
  const config = loadConfig();
  if (!config || !config.firebase) return null;
  const app = getApps()[0] || initializeApp(config.firebase);
  return { app, auth: getAuth(app), db: getFirestore(app) };
}
