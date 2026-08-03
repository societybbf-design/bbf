# AGENTS.md

## Cursor Cloud specific instructions

This is a single Node.js (Express 4 + Mongoose 7) monolith serving both a JSON API and
server-rendered HTML dashboards. There is no separate frontend build step (vanilla HTML/CSS/JS
in `views/` and `public/`). Standard commands live in `package.json` scripts; prefer those.

### Services

| Service | Command | Notes |
| --- | --- | --- |
| App (API + web UI) | `npm start` (`node server.js`) | Defaults to `http://localhost:4000`. Serves all role dashboards (member, admin/cashier, CEO, developer/user-management). |
| MongoDB | `mongod --dbpath /data/db --bind_ip 127.0.0.1 --port 27017` | Required — the app calls `process.exit(1)` at boot if `MONGO_URI`/`MONGODB_URI` is unset. Also used as the session store. |

Lint: there is no linter configured in this repo. Test: `npm test` (`node --test tests/*.test.js`).
Build: none (no bundler/transpile step).

### Non-obvious caveats

- MongoDB is a hard dependency and is NOT auto-started by the app. Start `mongod` first, then
  `npm start`. On this VM MongoDB (`mongodb-org` 8.0) is installed via apt; a standalone instance is fine.
- The app auto-falls back to non-transactional writes on standalone MongoDB (a replica set is NOT
  required) — see `services/mongoTransaction.js`. Do not spend effort configuring a replica set.
- Local dev connection string: `MONGO_URI=mongodb://127.0.0.1:27017/society-management` in `.env`
  (`.env` is gitignored). Copy `.env.example` for the full variable list.
- Do NOT set `NODE_ENV=production` locally: production mode enforces a strong `SESSION_SECRET`,
  secure cookies, and other prod checks (`assertProductionConfig()` in `server.js`) that make local
  login over plain HTTP fail.
- Tests are self-contained and mock Mongoose models — they do NOT need a running MongoDB.
- On first boot, `seedService` seeds a developer account from `DEVELOPER_EMAIL`/`DEVELOPER_PASSWORD`
  (defaults `developer@bondhutto-bandhon.foundation` / `devSecure2003`). `SEED_ONLY_DEVELOPER=1`
  prevents other demo accounts from being created; create members/staff via the User Management console.
- Email (SMTP) and SMS (Twilio) are optional — unconfigured, email falls back to a nodemailer
  Ethereal test account and SMS logs a `[SMS preview]`, so full flows are testable without them.
- An in-process scheduler (`services/scheduledJobsService.js`) runs hourly for monthly
  auto-deductions; set `DISABLE_SCHEDULED_JOBS=1` to turn it off during focused testing.
