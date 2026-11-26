"use strict";
// Point-in-time backup. SQLite's own backup API copies a consistent snapshot even
// while the server is running, so this can be a cron job without stopping anything.
//
//   node backup.js                  -> ./backups/2026-08-20T14-30-00
//   node backup.js /mnt/nas/costseg -> somewhere else
//   0 2 * * * cd /srv/costseg && /usr/bin/node backup.js >> /var/log/costseg-backup.log 2>&1

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const OUT_ROOT = process.argv[2] || path.join(__dirname, "backups");
const KEEP = +(process.env.KEEP_BACKUPS || 30);

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dest = path.join(OUT_ROOT, stamp);
fs.mkdirSync(dest, { recursive: true });

// 1. Database
const src = path.join(DATA_DIR, "app.db");
if (!fs.existsSync(src)) { console.error("No database at " + src); process.exit(1); }
const db = new DatabaseSync(src, { readOnly: true });
db.exec("VACUUM INTO '" + path.join(dest, "app.db").replace(/'/g, "''") + "'");
db.close();

// 2. Uploaded files
const upSrc = path.join(DATA_DIR, "uploads");
if (fs.existsSync(upSrc)) fs.cpSync(upSrc, path.join(dest, "uploads"), { recursive: true });

const size = d => fs.readdirSync(d, { withFileTypes: true }).reduce((a, e) => {
  const f = path.join(d, e.name);
  return a + (e.isDirectory() ? size(f) : fs.statSync(f).size);
}, 0);
console.log("Backed up to " + dest + "  (" + (size(dest) / 1048576).toFixed(1) + " MB)");

// 3. Age out old copies
const olds = fs.readdirSync(OUT_ROOT).filter(n => /^\d{4}-\d{2}-\d{2}T/.test(n)).sort();
while (olds.length > KEEP) {
  const gone = olds.shift();
  fs.rmSync(path.join(OUT_ROOT, gone), { recursive: true, force: true });
  console.log("  removed old backup " + gone);
}
