# Cost Segregation app — build & deploy brief

Everything is written and tested. This is a **build and deploy job, not a
development job**: no features to design, no decisions to make. Budget two to
four hours.

---

## What it is

A single-tenant web app for producing cost segregation studies. An estimator
signs in, enters a property, takes off assets against an RS Means catalog, and
generates a client-ready PDF report.

- **Front end:** React 18, one page, no router
- **Back end:** Node 22, HTTP + SQLite, **zero npm dependencies**
- **Database:** SQLite, one file
- **Auth:** session cookies, scrypt password hashing
- **Users:** a handful. Not multi-tenant, no public signup beyond the first owner.

---

## Files

### Front end — all go in `src/`

| File | Size | Purpose |
|---|---|---|
| `cost-seg-app.jsx` | 153 KB | UI: 11 tabs, the study editor, app shell. Default-exports `App`. |
| `costseg-engine.js` | 56 KB | Calculation engine, MACRS tables, catalog parsing, `compute()` |
| `costseg-report.js` | 63 KB | Report generator — builds HTML, prints to PDF |
| `costseg-checks.js` | 10 KB | Pre-delivery validation and benchmarks |
| `costseg-data.js` | 82 KB | RS Means catalog (423 items) + City Cost Index (909 zips) |
| `client-api.jsx` | 12 KB | API client, sign-in screen, study list, autosave |

Import graph, no cycles:

```
cost-seg-app.jsx
  ├── client-api.jsx
  ├── costseg-report.js ──┐
  ├── costseg-checks.js ──┤
  └── costseg-engine.js ◄─┘
        └── costseg-data.js
```

### Back end — deploy as a unit

| File | Purpose |
|---|---|
| `server/server.js` | HTTP server, routing, static files, multipart uploads |
| `server/db.js` | Schema and queries |
| `server/auth.js` | scrypt hashing, sessions |
| `server/backup.js` | Point-in-time backup, safe while running |
| `server/README.md` | API reference and operational notes |
| `server/SETUP-plain-english.md` | The non-technical walkthrough — ignore, it's for the client |

---

## Build

```bash
npm create vite@latest costseg -- --template react
cd costseg
npm install xlsx pdfjs-dist
# copy the six front-end files into src/
```

`src/main.jsx`:

```jsx
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./cost-seg-app.jsx";
createRoot(document.getElementById("root")).render(<App />);
```

`vite.config.js`:

```js
export default {
  server: { proxy: { "/api": "http://localhost:8080" } },
  build: { outDir: "../server/public", emptyOutDir: true },
};
```

```bash
npm run build      # emits into server/public
```

**Only two runtime dependencies**, both used lazily:
- `xlsx` — parsing RS Means Square Foot Estimate exports
- `pdfjs-dist` — rendering PDF sitemaps to canvas for measurement

`pdfjs-dist` is imported dynamically with a CDN fallback, so a missing install
degrades rather than crashes — but please install it properly.

---

## Run the server

Node **22.5+** required (`node:sqlite` landed there). Zero installs.

```bash
cd server
node server.js                    # PORT=8080, DATA_DIR=./data
SECURE_COOKIES=0 node server.js   # local HTTP only
```

The first account registered becomes `owner`. There is no other bootstrap.

---

## Deploy

Target: one small VPS, Ubuntu 24.04, ~$6/month. Nothing here needs more.

1. **systemd unit** — `WorkingDirectory=/srv/costseg`, `Restart=always`,
   `DATA_DIR=/srv/costseg/data`
2. **Caddy** reverse proxy for automatic TLS:
   ```
   studies.CLIENTDOMAIN.com {
       reverse_proxy localhost:8080
   }
   ```
3. **Do not expose 8080 directly** — sessions are cookie-based.
4. **Nightly backup cron**:
   ```
   0 2 * * * cd /srv/costseg && /usr/bin/node backup.js >> /var/log/costseg-backup.log 2>&1
   ```
5. **Off-site sync** — rclone to B2/R2/S3. A backup on the same disk isn't one.

Full commands in `server/README.md`.

---

## Please don't

- Containerise it, orchestrate it, or move it to a managed platform. One process,
  one SQLite file, one VPS is the right shape for one firm and a few hundred
  studies. Complexity here is cost with no benefit.
- Swap SQLite for Postgres. `db.js` is isolated for that day; it isn't today.
- Add a build step to the server. Zero dependencies is a deliberate security
  property, not an oversight.
- Refactor the front end. It's split by concern already and it works.

---

## Handover — please cover these

The client is **not** technical and will be maintaining this alone. Fifteen
minutes on:

1. **Redeploying a front-end change** — they'll get updated `.jsx` files
   periodically. Replace file → `npm run build` → upload `public/`. Consider
   leaving them a one-line deploy script.
2. **Restarting** — `systemctl restart costseg`, `systemctl status costseg`
3. **Restoring a backup** — actually do one, don't just describe it
4. **Credentials in their name** — server, domain, backup storage. Not yours.

---

## Known gaps (deliberate, not defects)

- No password reset — no SMTP configured. Owner resets via `db.js`.
- No sharing between users; studies are owned by their creator. `users.role`
  exists for when that changes.
- Rate limiting is in-process. Fine for one node.
- Revisions capped at 100 per study.
- No CSRF token — mitigated by SameSite=Lax plus an Origin check on writes.
  Add tokens if this ever becomes multi-tenant.

---

## Verifying it works

After deploy:

1. Register the owner account
2. Create a study, enter a basis, add a takeoff line
3. Confirm the header badge goes **Saving… → Saved**
4. Hard-refresh — the study should still be there
5. Open **Review & Deliver → Generate final report (PDF)** — a print dialog with
   ~19 pages should appear
6. Run `node backup.js` and confirm a timestamped folder with `app.db`

If all six pass, it's done.
