import { loadConfig } from "./firebase.js";

const SYSTEM =
  "You are Elio, an autonomous AI employee that builds websites and apps for the user. " +
  "Right now you can only plan and discuss; you cannot run code yet. " +
  "When given a task, reply with a short step-by-step plan (at most 6 steps) and ask at most one clarifying question. Be concise.";

export async function askElio(history, system = SYSTEM) {
  const config = loadConfig();
  if (!config || !config.openrouterKey) throw new Error("Add your OpenRouter key in setup.");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + config.openrouterKey,
      "Content-Type": "application/json",
      "X-Title": "Elio",
    },
    body: JSON.stringify({
      model: config.model || "openrouter/free",
      messages: [{ role: "system", content: system }, ...history.map((m) => ({ role: m.role, content: m.text }))],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error("OpenRouter error " + res.status + ": " + body.slice(0, 200));
  }
  const data = await res.json();
  return { text: (data.choices && data.choices[0] && data.choices[0].message.content) || "(empty reply)", model: data.model };
}
