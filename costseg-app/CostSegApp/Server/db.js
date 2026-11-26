"use strict";
// Accounts and sign-in sessions, stored in one SQLite file (built into Node 22).
// Set DATA_DIR to a persistent disk in production so accounts survive deploys.

const { DatabaseSync } = require("node:sqlite");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, "app.db"));
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL DEFAULT '',
  pw_hash     TEXT NOT NULL,
  pw_salt     TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,           -- only a hash of the cookie is stored
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
`);

const now = () => new Date().toISOString();
const uid = () => crypto.randomBytes(12).toString("hex");
const sha256 = s => crypto.createHash("sha256").update(String(s)).digest("hex");

const Users = {
  byEmail: e => db.prepare("SELECT * FROM users WHERE email = ?").get(String(e).trim().toLowerCase()),
  byId: id => db.prepare("SELECT * FROM users WHERE id = ?").get(id),
  count: () => db.prepare("SELECT COUNT(*) AS n FROM users").get().n,
  create(email, name, hash, salt) {
    const id = uid();
    db.prepare("INSERT INTO users (id,email,name,pw_hash,pw_salt,created_at) VALUES (?,?,?,?,?,?)")
      .run(id, String(email).trim().toLowerCase(), String(name || "").trim(), hash, salt, now());
    return Users.byId(id);
  }
};

const Sessions = {
  create(userId, days = 30) {
    const token = crypto.randomBytes(32).toString("hex");
    const exp = new Date(Date.now() + days * 864e5).toISOString();
    db.prepare("INSERT INTO sessions (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)")
      .run(sha256(token), userId, now(), exp);
    return token;
  },
  user(token) {
    if (!token) return null;
    return db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
                       WHERE s.token_hash = ? AND s.expires_at > ?`).get(sha256(token), now()) || null;
  },
  destroy: token => db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token)),
  sweep: () => db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now())
};

module.exports = { db, DATA_DIR, Users, Sessions };
