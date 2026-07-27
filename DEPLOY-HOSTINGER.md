# Deploy SocietyHub on Hostinger (Node.js)

This app is a single Node.js + Express + MongoDB Atlas service (vanilla HTML/CSS/JS frontends). Chat uses HTTP polling (no Socket.IO). Relative `/api/...` paths work on any live domain.

## 1. Prerequisites

- Hostinger plan with **Node.js** support (VPS or Node.js Web App)
- MongoDB Atlas cluster with network access allowing Hostinger IPs (or `0.0.0.0/0` temporarily)
- Node.js **18+** (20 LTS recommended)

## 2. Upload the project

Upload the project root (everything except `node_modules` and `.env`):

- `server.js` (entry point)
- `package.json` / `package-lock.json`
- `routes/`, `services/`, `models/`, `middleware/`, `views/`, `public/`, `scripts/`, `uploads/` (empty ok)

Do **not** upload your local `.env` if it contains development secrets — configure production variables in the Hostinger panel.

## 3. Environment variables (Hostinger panel)

Set at least:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | *(usually set automatically by Hostinger)* |
| `MONGO_URI` or `MONGODB_URI` | Atlas connection string (required — do not leave empty) |
| `SESSION_SECRET` | Long random string (32+ chars) |
| `TRUST_PROXY` | `1` |
| `APP_URL` | `https://your-domain.com` |

Recommended:

- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` — receipts + OTP
- `ASSET_VERSION` — bump after each UI deploy (e.g. `20260727a`)
- Change seeded `DEVELOPER_PASSWORD` / CEO passwords after first login

Copy from `.env.example` as a checklist.

## 4. Install & start

In the Hostinger Node.js app settings:

- **Entry file:** `server.js`
- **Install command:** `npm install --omit=dev`
- **Start command:** `npm start`  
  (`npm start` runs `node server.js` — production-safe, no local `lsof` restart helper)

Or SSH:

```bash
cd ~/domains/your-domain/app   # path varies
npm install --omit=dev
NODE_ENV=production node scripts/check-production.js
npm start
```

## 5. Verify

1. Open `https://your-domain.com/api/health` → `{ "ok": true, "mongo": "connected", "env": "production" }`
2. Sign in as CEO / Cashier / Member
3. Confirm Dark/Light toggle persists, cashier home KPIs load, chat messages send
4. Confirm session cookies work over HTTPS (requires `TRUST_PROXY=1` + `NODE_ENV=production`)

## 6. Notes

- Static assets are served from `/static` with cache headers; HTML injects `?v=ASSET_VERSION`.
- Sessions are stored in MongoDB (`sessions` collection) via `connect-mongo`.
- Local development restart helper remains: `npm run restart` (uses `scripts/start-server.js`).
- Atlas: create a DB user, whitelist Hostinger egress IPs, use the `mongodb+srv://...` URI in `MONGO_URI`.
