import React from "react";

/* ============================ API CLIENT ============================ */
// Every call carries the session cookie. A 401 anywhere means the session
// expired, which bubbles up so the shell can drop back to the sign-in screen.

const json = async (path, opts) => {
  const r = await fetch("/api" + path, Object.assign({
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
  }, opts || {}));
  let body = null;
  try { body = await r.json(); } catch (e) { }
  if (!r.ok) {
    const err = new Error((body && body.error) || ("Request failed (" + r.status + ")"));
    err.status = r.status;
    throw err;
  }
  return body;
};

export const api = {
  me: () => json("/auth/me"),
  login: (email, password) => json("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  register: (email, name, password) =>
    json("/auth/register", { method: "POST", body: JSON.stringify({ email, name, password }) }),
  logout: () => json("/auth/logout", { method: "POST" }),
  changePassword: (current, next) =>
    json("/auth/password", { method: "POST", body: JSON.stringify({ current, next }) }),

  listStudies: () => json("/studies"),
  createStudy: study => json("/studies", { method: "POST", body: JSON.stringify({ study }) }),
  getStudy: id => json("/studies/" + id),
  saveStudy: (id, study, note) =>
    json("/studies/" + id, { method: "PUT", body: JSON.stringify({ study, note: note || "" }) }),
  deleteStudy: id => json("/studies/" + id, { method: "DELETE" }),
  revisions: id => json("/studies/" + id + "/revisions"),
  revision: (id, revId) => json("/studies/" + id + "/revisions/" + revId),

  listFiles: id => json("/studies/" + id + "/files"),
  fileUrl: (id, fileId) => "/api/studies/" + id + "/files/" + fileId,
  uploadFile(id, file, kind, label) {
    const fd = new FormData();
    fd.append("kind", kind || "other");
    fd.append("label", label || "");
    fd.append("file", file);
    return fetch("/api/studies/" + id + "/files", { method: "POST", credentials: "same-origin", body: fd })
      .then(async r => {
        const b = await r.json().catch(() => null);
        if (!r.ok) throw new Error((b && b.error) || "Upload failed");
        return b.file;
      });
  },
};

/* ============================ AUTOSAVE ============================ */
// Saves a study a beat after editing stops. Tracks its own state so the header
// can show whether work is safely on the server, and warns before a close if not.
export function useAutosave(id, study, enabled) {
  const [state, setState] = React.useState("saved");   // saved | saving | error | offline
  const [savedAt, setSavedAt] = React.useState(null);
  const [error, setError] = React.useState("");
  const first = React.useRef(true);
  const pending = React.useRef(null);

  React.useEffect(() => {
    if (!enabled || !id) return;
    if (first.current) { first.current = false; return; }
    setState("saving");
    const payload = JSON.stringify(study);
    pending.current = payload;
    const t = setTimeout(() => {
      api.saveStudy(id, JSON.parse(payload))
        .then(r => {
          // Only clear the flag if nothing newer arrived while we were saving.
          if (pending.current === payload) {
            setState("saved"); setSavedAt(r.updated_at); setError("");
          }
        })
        .catch(e => {
          setState(navigator.onLine === false ? "offline" : "error");
          setError(e.message || "Save failed");
        });
    }, 1200);
    return () => clearTimeout(t);
  }, [JSON.stringify(study), id, enabled]);

  React.useEffect(() => {
    const warn = e => { if (state !== "saved") { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state]);

  const saveNow = React.useCallback(note => {
    if (!id) return Promise.resolve();
    setState("saving");
    return api.saveStudy(id, study, note)
      .then(r => { setState("saved"); setSavedAt(r.updated_at); })
      .catch(e => { setState("error"); setError(e.message); throw e; });
  }, [id, study]);

  return { state, savedAt, error, saveNow };
}

/* ============================ SIGN IN ============================ */
export function SignIn(props) {
  const [mode, setMode] = React.useState(props.needsSetup ? "register" : "login");
  const [f, setF] = React.useState({ email: "", name: "", password: "" });
  const [err, setErr] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const submit = () => {
    setBusy(true); setErr("");
    const p = mode === "register"
      ? api.register(f.email, f.name, f.password)
      : api.login(f.email, f.password);
    p.then(r => props.onSignedIn(r.user)).catch(e => { setErr(e.message); setBusy(false); });
  };

  return <div style={{
    minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
    background: "#f2f3f5", fontFamily: "Inter,-apple-system,'Segoe UI',Roboto,sans-serif",
  }}>
    <div style={{ width: 380, background: "#fff", border: "1px solid #e6e6e6", borderRadius: 13, padding: 28 }}>
      <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>
        {mode === "register" ? "Create your account" : "Sign in"}</div>
      <div style={{ fontSize: 12, color: "#6f757e", marginBottom: 18 }}>
        {props.needsSetup
          ? "No accounts yet — the first one you create owns this installation."
          : "Cost segregation studies"}</div>

      {mode === "register" && <label style={{ display: "block", marginBottom: 12 }}>
        <div style={{ fontSize: 12, marginBottom: 4 }}>Name</div>
        <input value={f.name} onChange={e => setF(Object.assign({}, f, { name: e.target.value }))}
          style={inp} /></label>}

      <label style={{ display: "block", marginBottom: 12 }}>
        <div style={{ fontSize: 12, marginBottom: 4 }}>Email</div>
        <input type="email" autoComplete="username" value={f.email}
          onChange={e => setF(Object.assign({}, f, { email: e.target.value }))} style={inp} /></label>

      <label style={{ display: "block", marginBottom: 16 }}>
        <div style={{ fontSize: 12, marginBottom: 4 }}>Password</div>
        <input type="password" value={f.password}
          autoComplete={mode === "register" ? "new-password" : "current-password"}
          onChange={e => setF(Object.assign({}, f, { password: e.target.value }))}
          onKeyDown={e => { if (e.key === "Enter") submit(); }} style={inp} />
        {mode === "register" && <div style={{ fontSize: 11, color: "#6f757e", marginTop: 4 }}>
          At least 10 characters. A short phrase beats a short password.</div>}</label>

      {err && <div style={{
        background: "#fef2f2", border: "1px solid #fca5a5", color: "#b91c1c",
        borderRadius: 7, padding: "8px 11px", fontSize: 12, marginBottom: 12,
      }}>{err}</div>}

      <button onClick={submit} disabled={busy} style={{
        width: "100%", background: busy ? "#9aa0a6" : "#15181c", color: "#fff", border: "none",
        borderRadius: 7, padding: "10px 0", fontSize: 13.5, fontWeight: 550, cursor: "pointer",
      }}>{busy ? "…" : (mode === "register" ? "Create account" : "Sign in")}</button>

      {!props.needsSetup && <div style={{ textAlign: "center", marginTop: 14, fontSize: 12 }}>
        <span style={{ color: "#0f766e", cursor: "pointer" }}
          onClick={() => { setMode(mode === "login" ? "register" : "login"); setErr(""); }}>
          {mode === "login" ? "Create an account" : "I already have an account"}</span>
      </div>}
    </div>
  </div>;
}
const inp = {
  width: "100%", border: "1px solid #d7dae0", borderRadius: 7, padding: "8px 10px",
  fontSize: 13, fontFamily: "inherit", boxSizing: "border-box",
};

/* ============================ STUDY LIST ============================ */
export function StudyList(props) {
  const [rows, setRows] = React.useState(null);
  const [err, setErr] = React.useState("");
  const load = () => api.listStudies().then(r => setRows(r.studies)).catch(e => setErr(e.message));
  React.useEffect(() => { load(); }, []);

  const create = () => api.createStudy(props.blankStudy()).then(r => props.onOpen(r.id)).catch(e => setErr(e.message));
  const remove = (id, label) => {
    if (!window.confirm("Delete " + (label || "this study") + "? It can be recovered from the database, not from here."))
      return;
    api.deleteStudy(id).then(load).catch(e => setErr(e.message));
  };

  return <div style={{ padding: "28px 22px", maxWidth: 960, margin: "0 auto",
    fontFamily: "Inter,-apple-system,'Segoe UI',Roboto,sans-serif", fontSize: 13 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
      <div>
        <div style={{ fontSize: 19, fontWeight: 700 }}>Studies</div>
        <div style={{ fontSize: 12, color: "#6f757e" }}>
          Signed in as {props.user.email}{props.user.role === "owner" ? " · owner" : ""}</div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={create} style={btn}>+ New study</button>
        <button onClick={props.onSignOut} style={btnOut}>Sign out</button>
      </div>
    </div>

    {err && <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", color: "#b91c1c",
      borderRadius: 7, padding: "8px 11px", fontSize: 12, marginBottom: 12 }}>{err}</div>}

    <div style={{ background: "#fff", border: "1px solid #e6e6e6", borderRadius: 13, overflow: "hidden" }}>
      {rows === null && <div style={{ padding: 22, color: "#9aa0a6" }}>Loading…</div>}
      {rows && rows.length === 0 && <div style={{ padding: 26, color: "#9aa0a6", textAlign: "center" }}>
        No studies yet. Create one to begin.</div>}
      {rows && rows.length > 0 && <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>
          {["Study", "Property", "Taxpayer", "Tax year", "Last saved", ""].map((h, i) =>
            <th key={i} style={th}>{h}</th>)}
        </tr></thead>
        <tbody>
          {rows.map(r => <tr key={r.id} style={{ borderTop: "1px solid #f0f0f0" }}>
            <td style={td}><b style={{ cursor: "pointer" }} onClick={() => props.onOpen(r.id)}>
              {r.number || "(unnumbered)"}</b></td>
            <td style={td}>{r.address || "—"}</td>
            <td style={td}>{r.taxpayer || "—"}</td>
            <td style={td}>{r.tax_year || "—"}</td>
            <td style={Object.assign({ color: "#6f757e" }, td)}>
              {new Date(r.updated_at).toLocaleString()}</td>
            <td style={Object.assign({ textAlign: "right" }, td)}>
              <span style={{ color: "#0f766e", cursor: "pointer", marginRight: 12 }}
                onClick={() => props.onOpen(r.id)}>Open</span>
              <span style={{ color: "#dc2626", cursor: "pointer" }}
                onClick={() => remove(r.id, r.number)}>Delete</span>
            </td>
          </tr>)}
        </tbody>
      </table>}
    </div>
  </div>;
}
const btn = { background: "#15181c", color: "#fff", border: "none", borderRadius: 7,
  padding: "8px 14px", fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" };
const btnOut = { background: "#fff", color: "#222", border: "1px solid #d7dae0", borderRadius: 20,
  padding: "6px 14px", fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" };
const th = { textAlign: "left", fontSize: 9.5, letterSpacing: ".07em", textTransform: "uppercase",
  color: "#79808a", fontWeight: 600, padding: "9px 12px", borderBottom: "1px solid #e8e8e8" };
const td = { padding: "10px 12px", verticalAlign: "middle" };
