"use strict";
// Storage layer. SQLite lives in a single file, so a backup is a file copy and
// there is no database server to run or secure. Swap to Postgres later by
// replacing this module — nothing above it knows what the store is.

const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, "uploads"), { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, "app.db"));
db.exec("PRAGMA journal_mode = WAL");   // survives a crash mid-write
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL DEFAULT '',
  pw_hash      TEXT NOT NULL,
  pw_salt      TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'member',
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS studies (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  number       TEXT NOT NULL DEFAULT '',
  address      TEXT NOT NULL DEFAULT '',
  taxpayer     TEXT NOT NULL DEFAULT '',
  tax_year     INTEGER,
  status       TEXT NOT NULL DEFAULT 'open',
  body         TEXT NOT NULL,              -- the whole study object as JSON
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_studies_owner ON studies(owner_id, updated_at DESC);

-- Every save keeps the version it replaced, so nothing is ever truly lost.
CREATE TABLE IF NOT EXISTS revisions (
  id          TEXT PRIMARY KEY,
  study_id    TEXT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  user_id     TEXT,
  body        TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rev_study ON revisions(study_id, created_at DESC);

CREATE TABLE IF NOT EXISTS files (
  id          TEXT PRIMARY KEY,
  study_id    TEXT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'other',
  label       TEXT NOT NULL DEFAULT '',
  filename    TEXT NOT NULL,
  mime        TEXT NOT NULL DEFAULT '',
  bytes       INTEGER NOT NULL DEFAULT 0,
  stored_as   TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_study ON files(study_id, created_at DESC);
`);

const now = () => new Date().toISOString();
const uid = () => require("node:crypto").randomBytes(12).toString("hex");

/* ---------------- users ---------------- */
const Users = {
  byEmail: e => db.prepare("SELECT * FROM users WHERE email = ?").get(String(e).toLowerCase()),
  byId: id => db.prepare("SELECT * FROM users WHERE id = ?").get(id),
  count: () => db.prepare("SELECT COUNT(*) AS n FROM users").get().n,
  create(email, name, hash, salt, role) {
    const id = uid();
    db.prepare(`INSERT INTO users (id,email,name,pw_hash,pw_salt,role,created_at)
                VALUES (?,?,?,?,?,?,?)`)
      .run(id, String(email).toLowerCase(), name || "", hash, salt, role || "member", now());
    return Users.byId(id);
  },
  list: () => db.prepare("SELECT id,email,name,role,created_at FROM users ORDER BY created_at").all(),
};

/* ---------------- sessions ---------------- */
const Sessions = {
  create(userId, days) {
    const token = require("node:crypto").randomBytes(32).toString("hex");
    const exp = new Date(Date.now() + (days || 30) * 864e5).toISOString();
    db.prepare("INSERT INTO sessions (token,user_id,created_at,expires_at) VALUES (?,?,?,?)")
      .run(token, userId, now(), exp);
    return token;
  },
  user(token) {
    if (!token) return null;
    const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
                            WHERE s.token = ? AND s.expires_at > ?`).get(token, now());
    return row || null;
  },
  destroy: token => db.prepare("DELETE FROM sessions WHERE token = ?").run(token),
  sweep: () => db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now()),
};

/* ---------------- studies ---------------- */
// A study is stored whole, as JSON. The engine already treats it as one object,
// and keeping it that way means the schema never has to chase the app's shape.
function summarise(body) {
  let o = {};
  try { o = JSON.parse(body).overview || {}; } catch (e) { }
  return {
    number: o.studyNumber || "",
    address: [o.street, o.city, o.state].filter(Boolean).join(", "),
    taxpayer: o.taxpayer || "",
    tax_year: +o.taxYear || null,
  };
}

const Studies = {
  list(ownerId) {
    return db.prepare(`SELECT id,number,address,taxpayer,tax_year,status,created_at,updated_at
                       FROM studies WHERE owner_id = ? AND deleted_at IS NULL
                       ORDER BY updated_at DESC`).all(ownerId);
  },
  get(id, ownerId) {
    return db.prepare(`SELECT * FROM studies WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`)
      .get(id, ownerId);
  },
  create(ownerId, body) {
    const id = uid(), s = summarise(body), t = now();
    db.prepare(`INSERT INTO studies (id,owner_id,number,address,taxpayer,tax_year,status,body,created_at,updated_at)
                VALUES (?,?,?,?,?,?,'open',?,?,?)`)
      .run(id, ownerId, s.number, s.address, s.taxpayer, s.tax_year, body, t, t);
    return Studies.get(id, ownerId);
  },
  update(id, ownerId, body, userId, note) {
    const prev = Studies.get(id, ownerId);
    if (!prev) return null;
    // Keep the version being replaced before overwriting it.
    db.prepare("INSERT INTO revisions (id,study_id,user_id,body,note,created_at) VALUES (?,?,?,?,?,?)")
      .run(uid(), id, userId || null, prev.body, note || "", now());
    const s = summarise(body);
    db.prepare(`UPDATE studies SET number=?,address=?,taxpayer=?,tax_year=?,body=?,updated_at=?
                WHERE id=? AND owner_id=?`)
      .run(s.number, s.address, s.taxpayer, s.tax_year, body, now(), id, ownerId);
    Studies.trim(id);
    return Studies.get(id, ownerId);
  },
  // Keep the last 100 revisions per study — enough to undo a bad afternoon.
  trim(id) {
    db.prepare(`DELETE FROM revisions WHERE study_id = ? AND id NOT IN
                (SELECT id FROM revisions WHERE study_id = ? ORDER BY created_at DESC LIMIT 100)`)
      .run(id, id);
  },
  softDelete: (id, ownerId) =>
    db.prepare("UPDATE studies SET deleted_at=? WHERE id=? AND owner_id=?").run(now(), id, ownerId),
  revisions: id => db.prepare(`SELECT id,note,created_at FROM revisions
                               WHERE study_id=? ORDER BY created_at DESC`).all(id),
  revision: (id, revId) => db.prepare("SELECT * FROM revisions WHERE id=? AND study_id=?").get(revId, id),
};

/* ---------------- files ---------------- */
const Files = {
  list: studyId => db.prepare(`SELECT id,kind,label,filename,mime,bytes,created_at
                               FROM files WHERE study_id=? ORDER BY created_at DESC`).all(studyId),
  get: (id, studyId) => db.prepare("SELECT * FROM files WHERE id=? AND study_id=?").get(id, studyId),
  create(studyId, meta) {
    const id = uid();
    db.prepare(`INSERT INTO files (id,study_id,kind,label,filename,mime,bytes,stored_as,created_at)
                VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, studyId, meta.kind || "other", meta.label || "", meta.filename,
        meta.mime || "", meta.bytes || 0, meta.stored_as, now());
    return Files.get(id, studyId);
  },
  remove: (id, studyId) => db.prepare("DELETE FROM files WHERE id=? AND study_id=?").run(id, studyId),
};

module.exports = { db, DATA_DIR, Users, Sessions, Studies, Files, uid, now };
