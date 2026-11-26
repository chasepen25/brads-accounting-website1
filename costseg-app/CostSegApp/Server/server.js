"use strict";
// Zero-dependency HTTP server. Node's own modules cover routing, TLS termination
// (behind a proxy), SQLite and crypto, so deployment is: install Node, copy files,
// run. Nothing to npm install, nothing to keep patched but Node itself.

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DATA_DIR, Users, Sessions, Studies, Files, uid } = require("./db");
const auth = require("./auth");

const PORT = +process.env.PORT || 8080;
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, "public");
const UPLOADS = path.join(DATA_DIR, "uploads");
const MAX_BODY = 40 * 1024 * 1024;          // 40MB — panel photos and sitemaps
const SECURE = process.env.SECURE_COOKIES !== "0";

/* ---------------- small helpers ---------------- */
const send = (res, code, body, headers) => {
  const h = Object.assign({ "Content-Type": "application/json; charset=utf-8" }, headers || {});
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, h);
  res.end(payload);
};
const fail = (res, code, message) => send(res, code, { error: message });

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", c => {
      size += c.length;
      if (size > (limit || MAX_BODY)) { reject(new Error("Payload too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
const readJson = async req => {
  const raw = await readBody(req);
  if (!raw.length) return {};
  try { return JSON.parse(raw.toString("utf8")); }
  catch (e) { throw new Error("Body was not valid JSON."); }
};

const parseCookies = str => {
  const out = {};
  String(str || "").split(";").forEach(p => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
};
const setCookie = (res, name, value, maxAgeSec) => {
  const bits = [name + "=" + encodeURIComponent(value), "Path=/", "HttpOnly", "SameSite=Lax"];
  if (SECURE) bits.push("Secure");
  bits.push("Max-Age=" + (maxAgeSec == null ? 60 * 60 * 24 * 30 : maxAgeSec));
  res.setHeader("Set-Cookie", bits.join("; "));
};

/* ---------------- rate limiting on the login route ---------------- */
const attempts = new Map();
function throttled(key) {
  const rec = attempts.get(key);
  if (!rec) return false;
  if (Date.now() - rec.at > 15 * 60 * 1000) { attempts.delete(key); return false; }
  return rec.n >= 10;
}
const noteAttempt = key => {
  const rec = attempts.get(key) || { n: 0, at: Date.now() };
  rec.n++; rec.at = Date.now(); attempts.set(key, rec);
};

/* ---------------- static file serving ---------------- */
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".pdf": "application/pdf",
  ".map": "application/json",
};

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split("?")[0]);
  if (rel === "/") rel = "/index.html";
  const full = path.join(PUBLIC_DIR, rel);
  // Refuse anything that climbs out of the public directory.
  if (!full.startsWith(PUBLIC_DIR)) return fail(res, 403, "Forbidden");
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) {
      // Single-page app: unknown paths fall back to index.html.
      const index = path.join(PUBLIC_DIR, "index.html");
      return fs.readFile(index, (e2, buf) => e2
        ? fail(res, 404, "Not found")
        : send(res, 200, buf, { "Content-Type": MIME[".html"] }));
    }
    const ext = path.extname(full).toLowerCase();
    const cache = rel === "/index.html" ? "no-cache" : "public, max-age=31536000, immutable";
    fs.readFile(full, (e3, buf) => e3
      ? fail(res, 500, "Read error")
      : send(res, 200, buf, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": cache }));
  });
}

/* ---------------- multipart parsing (uploads) ---------------- */
// Minimal multipart/form-data reader — enough for one file plus text fields.
function parseMultipart(buf, boundary) {
  const sep = Buffer.from("--" + boundary);
  const parts = [];
  let start = buf.indexOf(sep);
  while (start !== -1) {
    const next = buf.indexOf(sep, start + sep.length);
    if (next === -1) break;
    const chunk = buf.slice(start + sep.length, next);
    const headEnd = chunk.indexOf("\r\n\r\n");
    if (headEnd > 0) {
      const head = chunk.slice(0, headEnd).toString("utf8");
      const data = chunk.slice(headEnd + 4, chunk.length - 2);   // trim trailing CRLF
      const name = (head.match(/name="([^"]*)"/) || [])[1];
      const filename = (head.match(/filename="([^"]*)"/) || [])[1];
      const mime = (head.match(/Content-Type:\s*([^\r\n]+)/i) || [])[1];
      if (name) parts.push({ name, filename, mime, data });
    }
    start = next;
  }
  return parts;
}

/* ---------------- API ---------------- */
async function api(req, res, url, user) {
  const seg = url.pathname.split("/").filter(Boolean);   // ["api", ...]
  const p = seg.slice(1);
  const method = req.method;

  /* --- auth --- */
  if (p[0] === "auth") {
    if (p[1] === "register" && method === "POST") {
      const b = await readJson(req);
      const u = auth.register(b.email, b.name, b.password);
      const token = require("./db").Sessions.create(u.id, 30);
      setCookie(res, "sid", token);
      return send(res, 200, { user: { id: u.id, email: u.email, name: u.name, role: u.role } });
    }
    if (p[1] === "login" && method === "POST") {
      const b = await readJson(req);
      const key = (req.socket.remoteAddress || "") + "|" + String(b.email || "").toLowerCase();
      if (throttled(key)) return fail(res, 429, "Too many attempts. Wait 15 minutes.");
      const r = auth.login(b.email, b.password);
      if (!r) { noteAttempt(key); return fail(res, 401, "Email or password is wrong."); }
      attempts.delete(key);
      setCookie(res, "sid", r.token);
      return send(res, 200, { user: { id: r.user.id, email: r.user.email, name: r.user.name, role: r.user.role } });
    }
    if (p[1] === "logout" && method === "POST") {
      const c = parseCookies(req.headers.cookie);
      if (c.sid) Sessions.destroy(c.sid);
      setCookie(res, "sid", "", 0);
      return send(res, 200, { ok: true });
    }
    if (p[1] === "me" && method === "GET") {
      return user
        ? send(res, 200, { user: { id: user.id, email: user.email, name: user.name, role: user.role } })
        : send(res, 200, { user: null, needsSetup: Users.count() === 0 });
    }
    if (p[1] === "password" && method === "POST") {
      if (!user) return fail(res, 401, "Sign in first.");
      const b = await readJson(req);
      auth.changePassword(user, b.current, b.next);
      return send(res, 200, { ok: true });
    }
  }

  if (!user) return fail(res, 401, "Sign in first.");

  /* --- studies --- */
  if (p[0] === "studies") {
    if (!p[1] && method === "GET") return send(res, 200, { studies: Studies.list(user.id) });
    if (!p[1] && method === "POST") {
      const b = await readJson(req);
      const row = Studies.create(user.id, JSON.stringify(b.study || {}));
      return send(res, 200, { study: Object.assign({}, row, { body: undefined }), id: row.id });
    }
    const id = p[1];
    if (!id) return fail(res, 404, "Not found");

    if (p[2] === "revisions" && !p[3] && method === "GET") {
      if (!Studies.get(id, user.id)) return fail(res, 404, "Not found");
      return send(res, 200, { revisions: Studies.revisions(id) });
    }
    if (p[2] === "revisions" && p[3] && method === "GET") {
      if (!Studies.get(id, user.id)) return fail(res, 404, "Not found");
      const rev = Studies.revision(id, p[3]);
      return rev ? send(res, 200, { study: JSON.parse(rev.body), created_at: rev.created_at })
        : fail(res, 404, "Not found");
    }

    if (p[2] === "files") {
      const owned = Studies.get(id, user.id);
      if (!owned) return fail(res, 404, "Not found");
      if (method === "GET" && !p[3]) return send(res, 200, { files: Files.list(id) });
      if (method === "POST" && !p[3]) {
        const ct = req.headers["content-type"] || "";
        const bnd = (ct.match(/boundary=(?:"([^"]+)"|([^;]+))/) || [])[1]
          || (ct.match(/boundary=(?:"([^"]+)"|([^;]+))/) || [])[2];
        if (!bnd) return fail(res, 400, "Expected a multipart upload.");
        const raw = await readBody(req);
        const parts = parseMultipart(raw, bnd.trim());
        const filePart = parts.filter(x => x.filename)[0];
        if (!filePart) return fail(res, 400, "No file in the upload.");
        const field = n => (parts.filter(x => x.name === n && !x.filename)[0] || {}).data;
        const stored = uid() + path.extname(filePart.filename || "").slice(0, 10);
        fs.writeFileSync(path.join(UPLOADS, stored), filePart.data);
        const row = Files.create(id, {
          kind: field("kind") ? field("kind").toString() : "other",
          label: field("label") ? field("label").toString() : "",
          filename: path.basename(filePart.filename || "upload"),
          mime: filePart.mime || "", bytes: filePart.data.length, stored_as: stored,
        });
        return send(res, 200, { file: row });
      }
      if (method === "GET" && p[3]) {
        const f = Files.get(p[3], id);
        if (!f) return fail(res, 404, "Not found");
        const full = path.join(UPLOADS, f.stored_as);
        if (!fs.existsSync(full)) return fail(res, 404, "File missing on disk");
        return send(res, 200, fs.readFileSync(full), {
          "Content-Type": f.mime || "application/octet-stream",
          "Content-Disposition": 'inline; filename="' + f.filename.replace(/"/g, "") + '"',
          "Cache-Control": "private, max-age=86400",
        });
      }
      if (method === "DELETE" && p[3]) {
        const f = Files.get(p[3], id);
        if (f) { try { fs.unlinkSync(path.join(UPLOADS, f.stored_as)); } catch (e) { } Files.remove(p[3], id); }
        return send(res, 200, { ok: true });
      }
    }

    if (method === "GET") {
      const row = Studies.get(id, user.id);
      if (!row) return fail(res, 404, "Not found");
      return send(res, 200, { study: JSON.parse(row.body), meta: { id: row.id, updated_at: row.updated_at } });
    }
    if (method === "PUT") {
      const b = await readJson(req);
      const row = Studies.update(id, user.id, JSON.stringify(b.study || {}), user.id, b.note || "");
      if (!row) return fail(res, 404, "Not found");
      return send(res, 200, { ok: true, updated_at: row.updated_at });
    }
    if (method === "DELETE") { Studies.softDelete(id, user.id); return send(res, 200, { ok: true }); }
  }

  return fail(res, 404, "No such endpoint");
}

/* ---------------- request pipeline ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");

  if (!url.pathname.startsWith("/api/")) return serveStatic(req, res, url.pathname);

  const cookies = parseCookies(req.headers.cookie);
  const user = Sessions.user(cookies.sid);

  // Any state-changing call must come from our own origin.
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.origin;
    if (origin) {
      const host = req.headers.host;
      try { if (new URL(origin).host !== host) return fail(res, 403, "Cross-origin request refused."); }
      catch (e) { return fail(res, 403, "Bad origin."); }
    }
  }

  try { await api(req, res, url, user); }
  catch (err) {
    const msg = (err && err.message) || "Server error";
    const code = /too large/i.test(msg) ? 413
      : /valid|already|wrong|least|only digits|JSON/i.test(msg) ? 400 : 500;
    if (code === 500) console.error("[error]", err);
    if (!res.headersSent) fail(res, code, msg);
  }
});

setInterval(() => Sessions.sweep(), 60 * 60 * 1000).unref();

if (require.main === module) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  server.listen(PORT, () => {
    console.log("Cost seg server on http://localhost:" + PORT);
    console.log("  data:   " + DATA_DIR);
    console.log("  public: " + PUBLIC_DIR);
    if (Users.count() === 0) console.log("  no users yet — the first account you register becomes the owner");
  });
}

module.exports = { server };
