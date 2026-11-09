import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query, updateDoc, where, doc } from "firebase/firestore";
import { isNative } from "./native.js";

export function ApprovalCard({ fire, user, task }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const q = query(collection(fire.db, "users", user.uid, "tasks", task.id, "approvals"), where("status", "==", "pending"));
    return onSnapshot(q, (s) => setItems(s.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }, [task.id]);
  const answer = (id, status) => updateDoc(doc(fire.db, "users", user.uid, "tasks", task.id, "approvals", id), { status });
  if (!items.length) return null;
  return (
    <section className="panel approval" aria-live="assertive">
      {items.map((a) => (
        <div key={a.id}>
          <h3>Elio needs your approval</h3>
          <p className="muted">{a.reason}</p>
          <pre className="code">{a.command}</pre>
          <div className="row">
            <button onClick={() => answer(a.id, "denied")}>Deny</button>
            <button className="primary small" onClick={() => answer(a.id, "approved")}>Approve</button>
          </div>
        </div>
      ))}
    </section>
  );
}

function buildPreview(files) {
  const by = Object.fromEntries(files.map((f) => [f.path, f]));
  const clean = (p) => p.replace(/^\.\//, "");
  let html = (by["index.html"] && by["index.html"].content) || "";
  html = html.replace(/<link[^>]+href=["']([^"']+\.css)["'][^>]*>/gi, (m, href) => (by[clean(href)] ? "<style>" + by[clean(href)].content + "</style>" : m));
  html = html.replace(/<script([^>]*?)\ssrc=["']([^"']+\.js)["']([^>]*)><\/script>/gi, (m, a, src, b) => (by[clean(src)] ? "<script" + a + b + ">" + by[clean(src)].content + "<\/script>" : m));
  html = html.replace(/(src|href)=["']([^"':#]+\.(?:png|jpe?g|gif|webp|svg))["']/gi, (m, attr, p) => {
    const f = by[clean(p)];
    if (!f) return m;
    const url = f.binary ? f.dataUrl : "data:image/svg+xml;utf8," + encodeURIComponent(f.content);
    return attr + '="' + url + '"';
  });
  return html;
}

export function FilesPanel({ fire, user, task }) {
  const [files, setFiles] = useState([]);
  const [open, setOpen] = useState(null);
  const [preview, setPreview] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    const q = query(collection(fire.db, "users", user.uid, "tasks", task.id, "files"), orderBy("path", "asc"));
    return onSnapshot(q, (s) => setFiles(s.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }, [task.id]);

  async function download() {
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      for (const f of files) {
        if (f.binary) zip.file(f.path, f.dataUrl.split(",")[1], { base64: true });
        else zip.file(f.path, f.content);
      }
      const name = "elio-project.zip";
      if (isNative) {
        const b64 = await zip.generateAsync({ type: "base64" });
        const { Filesystem, Directory } = await import("@capacitor/filesystem");
        const { Share } = await import("@capacitor/share");
        await Filesystem.writeFile({ path: name, data: b64, directory: Directory.Cache });
        const { uri } = await Filesystem.getUri({ path: name, directory: Directory.Cache });
        await Share.share({ title: "Elio project", url: uri });
      } else {
        const blob = await zip.generateAsync({ type: "blob" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        URL.revokeObjectURL(a.href);
      }
    } catch (e) { setMsg("Download failed: " + e.message); }
  }

  if (!files.length) return null;
  const hasIndex = files.some((f) => f.path === "index.html");
  const current = files.find((f) => f.path === open);
  return (
    <section className="panel">
      <h3>Project files ({files.length})</h3>
      <div className="row">
        {hasIndex && <button onClick={() => setPreview(!preview)}>{preview ? "Hide preview" : "Preview"}</button>}
        <button onClick={download}>Download zip</button>
      </div>
      {msg && <p className="error" role="alert">{msg}</p>}
      {preview && hasIndex && <iframe className="preview" title="Preview" sandbox="allow-scripts" srcDoc={buildPreview(files)} />}
      <ul className="filelist">
        {files.map((f) => (<li key={f.id}><button className="link" onClick={() => setOpen(open === f.path ? null : f.path)}>{f.path}</button></li>))}
      </ul>
      {current && (current.binary ? <img className="shot" alt={current.path} src={current.dataUrl} /> : <pre className="code">{current.content}</pre>)}
    </section>
  );
}
