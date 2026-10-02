# Getting this online — plain English version

**Read this first.** What follows is genuinely technical work. It's the same kind
of job as wiring a building: perfectly learnable, but there's a reason people hire
an electrician. A developer would do all of it in **two to four hours**. If you'd
rather pay someone, skip to the last section — it tells you exactly what to ask
for, so you don't get talked into something bigger and pricier than you need.

If you want to do it yourself, everything below is copy-and-paste. You don't need
to understand the commands, only run them in order.

---

## What you're actually building

Right now the app runs on your own computer and forgets everything when you close
it. You want what your boss has: a web address you can log into from anywhere,
with your studies waiting there.

That needs three things:

| Piece | What it is | Cost |
|---|---|---|
| **A server** | A computer that stays on, somewhere else | ~$6/month |
| **A domain** | The address people type, e.g. `studies.yourfirm.com` | ~$12/year |
| **A certificate** | The padlock in the browser | Free, automatic |

The software is already written. This is plumbing.

---

## Step 1 — Rent the server

Go to **DigitalOcean**, **Hetzner**, or **Vultr**. Create an account and make the
smallest **Ubuntu 24.04** machine they offer. Around $6/month.

They'll give you:
- an **IP address** — four numbers like `203.0.113.42`
- a way to log in — either a password or an SSH key

Write both down.

> **A word on this:** the server is a real computer in a data centre. Your studies
> and client data will live on it. That's normal and fine, but it does mean you're
> now responsible for it — see Step 7 about backups, and don't skip it.

---

## Step 2 — Buy the domain

Anywhere: Namecheap, Cloudflare, Google Domains. Buy `yourfirm.com`.

In the domain's DNS settings, add one record:

| Type | Name | Value |
|---|---|---|
| A | `studies` | your server's IP address |

That makes `studies.yourfirm.com` point at your server. It takes a few minutes to
take effect, sometimes a couple of hours.

---

## Step 3 — Connect to the server

On a Mac, open **Terminal** (Cmd+Space, type "terminal"). On Windows, open
**PowerShell**.

Type this, with your IP:

```
ssh root@203.0.113.42
```

You'll get a wall of text and then a prompt. You're now typing commands *on the
server* rather than on your laptop. Everything in the next steps happens here.

---

## Step 4 — Install the software it needs

Paste these one at a time, pressing Enter after each and waiting for it to finish:

```
apt update && apt upgrade -y
```

```
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
```

```
node --version
```

That last one should print something starting with `v22`. If it prints a lower
number, stop — the app needs 22 or higher.

---

## Step 5 — Put the app on the server

You have the `server` folder and `cost-seg-app.jsx` from this conversation.
Before uploading, the app needs to be *built* — turned from source code into
something a browser can run.

On **your own laptop**, in Terminal:

```
npm create vite@latest costseg -- --template react
cd costseg
npm install xlsx pdfjs-dist
```

Copy `cost-seg-app.jsx` and `client-api.jsx` into the `src` folder it made.

Replace the contents of `src/main.jsx` with:

```
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./cost-seg-app.jsx";
createRoot(document.getElementById("root")).render(<App />);
```

Replace `vite.config.js` with:

```
export default {
  server: { proxy: { "/api": "http://localhost:8080" } },
  build: { outDir: "../server/public", emptyOutDir: true },
};
```

Then:

```
npm run build
```

That creates a `server/public` folder. Now upload the whole `server` folder to
the server. Easiest way is **FileZilla** (free, has buttons instead of commands) —
connect with the same IP and password, and drag the folder to `/srv/costseg`.

---

## Step 6 — Start it, and keep it started

Back in the Terminal window connected to your server:

```
cd /srv/costseg
node server.js
```

If it says "Cost seg server on http://localhost:8080", it works. Press Ctrl+C to
stop it.

That only runs while your Terminal is open, which isn't useful. To make it run
permanently, create a file:

```
nano /etc/systemd/system/costseg.service
```

Paste this in:

```
[Unit]
Description=Cost Segregation
After=network.target

[Service]
Type=simple
WorkingDirectory=/srv/costseg
Environment=PORT=8080
Environment=DATA_DIR=/srv/costseg/data
ExecStart=/usr/bin/node server.js
Restart=always

[Install]
WantedBy=multi-user.target
```

Press Ctrl+X, then Y, then Enter to save. Then:

```
systemctl enable --now costseg
```

It now starts automatically, and restarts itself if it ever crashes.

---

## Step 7 — Add the padlock (HTTPS)

Without this, anyone on the same wifi can read your login. Don't skip it.

```
apt install -y caddy
nano /etc/caddy/Caddyfile
```

Delete whatever's in there and put:

```
studies.yourfirm.com {
    reverse_proxy localhost:8080
}
```

Save (Ctrl+X, Y, Enter), then:

```
systemctl restart caddy
```

Caddy gets the certificate for you and renews it forever. Nothing else to do.

**Open `https://studies.yourfirm.com` in a browser.** You should see the sign-in
screen. The first account you create becomes the owner — do it immediately, before
anyone else finds the address.

---

## Step 8 — Backups. Please don't skip this.

Your studies now live on a rented computer. If it dies and you have no backup,
they're gone. There is no undo.

```
crontab -e
```

Add this line at the bottom:

```
0 2 * * * cd /srv/costseg && /usr/bin/node backup.js >> /var/log/costseg-backup.log 2>&1
```

That makes a copy every night at 2am, keeping 30 days.

**But a backup on the same machine only protects you from your own mistakes, not
from losing the machine.** Get one copy somewhere else — Backblaze B2 and
Cloudflare R2 both cost a few dollars a month. Ask whoever helps you to set up
`rclone` to sync the backup folder off the server.

---

## If you'd rather pay someone

This is a small, well-defined job. Post it on Upwork or ask any web developer.
**Two to four hours** of work. Send them this:

> I have a React app and a Node.js server (no npm dependencies, uses Node 22's
> built-in SQLite). I need it deployed to a VPS with a domain, HTTPS via Caddy,
> systemd for process management, and a nightly cron backup with off-site sync.
> All the code and a README are ready.

**Don't let anyone talk you into** AWS, Kubernetes, Docker Swarm, or a rewrite.
For one person and a few hundred studies, a $6 server is genuinely the right
answer, and anything fancier is someone billing you for their own preferences.

Ask for a **handover session** where they show you how to restart it and how to
restore a backup. Those are the only two things you'll need to do yourself.

---

## Things that will go wrong, and what they mean

**"It says my session expired the moment I log in."**
You're on `http://` instead of `https://`. Finish Step 7.

**"SQLite is an experimental feature" appears in the logs.**
Normal on Node 22. Ignore it.

**"The page loads but says Not Found."**
The `public` folder didn't upload, or the build in Step 5 didn't run.

**"I'm locked out of my own account."**
Connect to the server and run:

```
cd /srv/costseg
node -e "
const {db}=require('./db'); const {makeHash}=require('./auth');
const h=makeHash('your-new-long-password');
db.prepare('UPDATE users SET pw_hash=?,pw_salt=? WHERE email=?').run(h.hash,h.salt,'you@yourfirm.com');
console.log('done');"
```

**"How do I restart it?"**

```
systemctl restart costseg
```

**"How do I see if it's running?"**

```
systemctl status costseg
```

---

## What you're signing up for

Being honest about the ongoing commitment:

- **~$6-10/month** for the server, plus the domain yearly
- **Occasional updates** — Ubuntu security patches, roughly monthly, one command
- **Checking backups actually work** — restore one to a test folder every few
  months. An untested backup isn't a backup.
- **You now hold client tax data on a machine you're responsible for.** Worth a
  conversation with your accountant or attorney about what that obliges you to do.

None of this is heavy. But it isn't zero, and it's better to know now.
