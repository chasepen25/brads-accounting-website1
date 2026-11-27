"use strict";
// Serves the app. Sign-in is off unless REQUIRE_LOGIN=1 is set; then only signed-in users
// get the app and everyone else gets the sign-in / create-account page.

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const REQUIRE_LOGIN = /^(1|true|yes)$/i.test(process.env.REQUIRE_LOGIN || "");
// Account code (and its database) only loads when sign-in is turned on
const auth = REQUIRE_LOGIN ? require("./auth") : null;
const { Users, Sessions, DATA_DIR } = REQUIRE_LOGIN ? require("./db") : {};

const ROOT = __dirname;
const PORT = +process.env.PORT || 8080;
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon"
};
// Only these files are ever served; server code and the database never are.
const APP_FILES = new Set(["/index.html", "/vendor/pdf.min.js", "/vendor/pdf.worker.min.js", "/vendor/rsmeans-catalog.js"]);
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin"
};

/* ---------- small helpers ---------- */
function parseCookies(str) {
  const out = {};
  String(str || "").split(";").forEach(p => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
const isHttps = req => req.headers["x-forwarded-proto"] === "https" || !!req.socket.encrypted;
function setSession(req, res, token, maxAgeSec = 30 * 86400) {
  const bits = [`sid=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSec}`];
  if (isHttps(req)) bits.push("Secure");
  res.setHeader("Set-Cookie", bits.join("; "));
}
function send(res, code, body, type = "text/plain; charset=utf-8", extra = {}) {
  res.writeHead(code, { "Content-Type": type, ...SECURITY_HEADERS, ...extra });
  res.end(body);
}
const json = (res, code, obj) => send(res, code, JSON.stringify(obj), TYPES[".json"], { "Cache-Control": "no-store" });

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > 10 * 1024) { reject(new Error("Request too large.")); req.destroy(); }
      else chunks.push(c);
    });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || "{}")); } catch { reject(new Error("Bad request.")); } });
    req.on("error", reject);
  });
}

// Requests from other websites can't use the sign-in cookie to post here.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

/* ---------- throttle repeated sign-in / sign-up attempts ---------- */
const attempts = new Map();
const WINDOW = 15 * 60 * 1000;
function throttled(key, limit) {
  const r = attempts.get(key);
  if (!r || Date.now() - r.at > WINDOW) return false;
  return r.n >= limit;
}
function bump(key) {
  const r = attempts.get(key);
  if (!r || Date.now() - r.at > WINDOW) attempts.set(key, { n: 1, at: Date.now() });
  else r.n++;
}
const clientIp = req => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
setInterval(() => {
  const cutoff = Date.now() - WINDOW;
  for (const [k, r] of attempts) if (r.at < cutoff) attempts.delete(k);
  if (Sessions) Sessions.sweep();
}, 10 * 60 * 1000).unref();

const publicUser = u => ({ name: u.name, email: u.email });

/* ---------- routes ---------- */
async function api(req, res, route) {
  // With sign-in off, the app runs without an account
  if (!REQUIRE_LOGIN) return route === "/api/me" ? json(res, 200, { user: null, loginRequired: false }) : json(res, 404, { error: "Sign-in is turned off." });

  if (req.method !== "POST" && route !== "/api/me") return json(res, 405, { error: "Method not allowed." });
  if (req.method === "POST" && (!sameOrigin(req) || !String(req.headers["content-type"] || "").includes("application/json")))
    return json(res, 403, { error: "Not allowed." });

  if (route === "/api/me") {
    const user = Sessions.user(parseCookies(req.headers.cookie).sid);
    return user ? json(res, 200, { user: publicUser(user) }) : json(res, 401, { error: "Not signed in." });
  }

  let body;
  try { body = await readJson(req); } catch (e) { return json(res, 400, { error: e.message }); }
  const ip = clientIp(req);

  if (route === "/api/signup") {
    if (throttled("signup:" + ip, 10)) return json(res, 429, { error: "Too many attempts. Try again in 15 minutes." });
    bump("signup:" + ip);
    try {
      const r = auth.register(body.email, body.name, body.password);
      setSession(req, res, r.token);
      return json(res, 200, { user: publicUser(r.user) });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  if (route === "/api/login") {
    const key = "login:" + ip + ":" + String(body.email || "").toLowerCase();
    if (throttled(key, 8)) return json(res, 429, { error: "Too many attempts. Try again in 15 minutes." });
    const r = auth.login(body.email, body.password);
    if (!r) { bump(key); return json(res, 401, { error: "Email or password is incorrect." }); }
    attempts.delete(key);
    setSession(req, res, r.token);
    return json(res, 200, { user: publicUser(r.user) });
  }

  if (route === "/api/logout") {
    const token = parseCookies(req.headers.cookie).sid;
    if (token) Sessions.destroy(token);
    setSession(req, res, "", 0);
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: "Not found." });
}

function serveFile(res, rel) {
  fs.readFile(path.join(ROOT, rel), (err, data) => {
    if (err) return send(res, 404, "Not found");
    send(res, 200, data, TYPES[path.extname(rel)] || "application/octet-stream", { "Cache-Control": rel.endsWith(".html") ? "no-store" : "no-cache" });
  });
}

const server = http.createServer(async (req, res) => {
  let route;
  try { route = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { return send(res, 400, "Bad request"); }

  if (route.startsWith("/api/")) return api(req, res, route).catch(e => { console.error(e); json(res, 500, { error: "Something went wrong." }); });

  if (!REQUIRE_LOGIN) {
    if (route === "/login") return send(res, 302, "", undefined, { Location: "/" });
    if (route === "/") route = "/index.html";
    if (!APP_FILES.has(route)) return send(res, 404, "Not found");
    return serveFile(res, route.slice(1));
  }

  const user = Sessions.user(parseCookies(req.headers.cookie).sid);

  if (route === "/login") {
    if (user) return send(res, 302, "", undefined, { Location: "/" });
    return serveFile(res, "login.html");
  }

  // Everything else needs a signed-in user
  if (!user) {
    if (route === "/" || route.endsWith(".html")) return send(res, 302, "", undefined, { Location: "/login" });
    return send(res, 401, "Sign in required");
  }
  if (route === "/") route = "/index.html";
  if (!APP_FILES.has(route)) return send(res, 404, "Not found");
  serveFile(res, route.slice(1));
});

server.listen(PORT, () => {
  console.log(`Cost Seg Professional on http://localhost:${PORT}`);
  console.log(REQUIRE_LOGIN ? `  sign-in on · data: ${DATA_DIR} · accounts: ${Users.count()}` : "  sign-in off (set REQUIRE_LOGIN=1 to turn it on)");
});
