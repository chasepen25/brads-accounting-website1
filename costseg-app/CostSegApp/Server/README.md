# Cost Segregation — server

Studies live on a server instead of in one browser. Sign in from any machine,
work is saved as you type, and every save keeps the version it replaced.

**No npm packages.** The server uses only what ships with Node 22 — its own HTTP
stack, its built-in SQLite, and its crypto library. There is nothing to install,
nothing to keep patched but Node itself, and no supply chain to worry about.

---

## What's here

| File | Purpose |
|---|---|
| `server.js` | HTTP server, routing, static files, uploads |
| `db.js` | Schema and queries (SQLite) |
| `auth.js` | Password hashing (scrypt) and sessions |
| `backup.js` | Point-in-time backup, safe to run while live |
| `client-api.jsx` | Front-end API client, sign-in screen, study list |
| `public/` | Where the built front-end goes |
| `data/` | Database and uploads — **this is the thing to back up** |

---

## Running it locally

Node 22.5 or newer is required (that's when SQLite arrived).

```bash
node --version          # expect v22.5.0 or higher
cd server
SECURE_COOKIES=0 node server.js
```

Open `http://localhost:8080`. **The first account you register owns the
installation.** Register it immediately — an empty instance will accept the first
person who finds it.

`SECURE_COOKIES=0` is for local use only. It lets the session cookie work over
plain HTTP. In production leave it off so cookies are HTTPS-only.

---

## Building the front-end into it

The app is a React component. With Vite:

```bash
npm create vite@latest costseg -- --template react
cd costseg
npm install xlsx pdfjs-dist
# copy cost-seg-app.jsx and client-api.jsx into src/
```

`src/main.jsx`:

```jsx
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./cost-seg-app.jsx";
createRoot(document.getElementById("root")).render(<App />);
```

`vite.config.js` — so the dev server talks to the API:

```js
export default {
  server: { proxy: { "/api": "http://localhost:8080" } },
  build: { outDir: "../server/public", emptyOutDir: true },
};
```

Then `npm run build` puts the front-end where the server serves it from.

---

## Deploying

Any Linux box with Node 22. A $6/month VPS is ample for a small firm.

```bash
sudo useradd -r -s /bin/false costseg
sudo mkdir -p /srv/costseg && sudo chown costseg /srv/costseg
# copy server/ and the built public/ to /srv/costseg
```

`/etc/systemd/system/costseg.service`:

```ini
[Unit]
Description=Cost Segregation
After=network.target

[Service]
Type=simple
User=costseg
WorkingDirectory=/srv/costseg
Environment=PORT=8080
Environment=DATA_DIR=/srv/costseg/data
ExecStart=/usr/bin/node server.js
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now costseg
```

### HTTPS

Put Caddy in front and certificates handle themselves:

```
studies.yourfirm.com {
    reverse_proxy localhost:8080
}
```

That single file gets you a valid certificate, automatic renewal, and HTTP→HTTPS
redirects. Nginx plus certbot works too, with more steps.

**Do not expose port 8080 directly.** Sessions ride on a cookie; without TLS
anyone on the network path can read it.

---

## Backups

```bash
node backup.js                    # ./backups/<timestamp>/
node backup.js /mnt/nas/costseg   # somewhere else
```

Nightly, keeping 30 days:

```
0 2 * * * cd /srv/costseg && /usr/bin/node backup.js >> /var/log/costseg-backup.log 2>&1
```

It uses SQLite's `VACUUM INTO`, so the copy is consistent even mid-write — no
need to stop the service. Copies the uploads too.

**Keep one copy off the machine.** A backup on the same disk protects you from a
mistake, not from losing the disk. `rclone sync` to object storage or a NAS.

To restore: stop the service, replace `data/`, start it.

---

## API

All routes require a session cookie except register, login and `me`.

| Method | Path | Does |
|---|---|---|
| POST | `/api/auth/register` | Create account (first one becomes owner) |
| POST | `/api/auth/login` | Sign in |
| POST | `/api/auth/logout` | Sign out |
| GET | `/api/auth/me` | Current user, or `needsSetup` if none exist |
| POST | `/api/auth/password` | Change password |
| GET | `/api/studies` | List your studies |
| POST | `/api/studies` | Create |
| GET | `/api/studies/:id` | Full study |
| PUT | `/api/studies/:id` | Save (keeps a revision) |
| DELETE | `/api/studies/:id` | Soft delete |
| GET | `/api/studies/:id/revisions` | History |
| GET | `/api/studies/:id/revisions/:rev` | An earlier version |
| GET/POST | `/api/studies/:id/files` | List / upload |
| GET/DELETE | `/api/studies/:id/files/:fid` | Download / remove |

---

## What's protecting the data

- **Passwords** hashed with scrypt and a per-user salt. A stolen database is not a
  stolen set of passwords. Comparison is constant-time.
- **Sessions** are random 256-bit tokens in HttpOnly, SameSite=Lax, Secure cookies.
  Not readable by JavaScript, not sent cross-site.
- **Ownership** is enforced in the query, not the interface. Asking for someone
  else's study returns "Not found" whether or not it exists.
- **Login throttling** — 10 failures per email and address, then a 15-minute wait.
- **Cross-origin writes refused** so another site can't act as you.
- **Path traversal blocked** on static files.
- **Uploads** stored under generated names, never the name the browser supplied.
- **Body cap** of 40 MB.

### What isn't covered yet

- **No password reset.** No email is configured. The owner resets a password
  directly in the database, or you add SMTP.
- **No sharing between users.** Studies belong to whoever created them. The
  `role` column exists for when that changes.
- **No audit log** beyond study revisions.
- **Rate limiting is per-process.** Fine on one server; needs shared state if you
  ever run several.

---

## If something goes wrong

**"SQLite is an experimental feature"** — expected on Node 22, harmless. It stops
in Node 24.

**Session drops immediately** — you're on HTTP without `SECURE_COOKIES=0`. The
browser is discarding a Secure cookie sent over plain HTTP.

**Uploads fail over ~40 MB** — raise `MAX_BODY` in `server.js`, and the
corresponding limit in your reverse proxy.

**Locked out of the owner account** — with shell access:

```bash
node -e "
const {Users,db}=require('./db'); const {makeHash}=require('./auth');
const h=makeHash('a-new-long-password');
db.prepare('UPDATE users SET pw_hash=?,pw_salt=? WHERE email=?').run(h.hash,h.salt,'you@firm.com');
console.log('reset');"
```
