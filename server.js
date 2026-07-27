const path = require('path');
const fs = require('fs');
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const adminDepositsRoutes = require('./routes/adminDeposits');
const memberRoutes = require('./routes/member');
const depositRoutes = require('./routes/deposit');
const investmentRoutes = require('./routes/investments');
const iouRoutes = require('./routes/ious');
const withdrawalRoutes = require('./routes/withdrawals');
const profitRoutes = require('./routes/profit');
const loanRoutes = require('./routes/loans');
const kycRoutes = require('./routes/kyc');
const adminNotificationRoutes = require('./routes/adminNotifications');
const memberNotificationRoutes = require('./routes/memberNotifications');
const adminChatRoutes = require('./routes/adminChat');
const memberChatRoutes = require('./routes/memberChat');
const ceoRoutes = require('./routes/ceo');
const developerRoutes = require('./routes/developer');
const salesRoutes = require('./routes/sales');
const bankLedgerRoutes = require('./routes/bankLedger');
const profitPoolRoutes = require('./routes/profitPool');
const advanceBorrowingRoutes = require('./routes/advanceBorrowing');
const monthlyTargetsRoutes = require('./routes/monthlyTargets');
const { seedDefaultUsers } = require('./services/seedService');
const { ensureDefaultInvestmentTypes } = require('./services/investmentTypeService');
const { isFullAccessRole, isDeveloperRole, canAccessDeveloperModule, dashboardPathForRole } = require('./services/rbac');

require('dotenv').config();

const app = express();
const port = Number(process.env.PORT) || 4000;
const mongoUri = String(process.env.MONGO_URI || process.env.MONGODB_URI || '').trim();
const isProduction = process.env.NODE_ENV === 'production';
const ASSET_VERSION = process.env.ASSET_VERSION || String(Date.now());
const sessionSecret = process.env.SESSION_SECRET || '';

let httpServer = null;
let shuttingDown = false;

function assertProductionConfig() {
  if (!mongoUri) {
    throw new Error(
      'Missing MONGO_URI (or MONGODB_URI). '
      + 'In Hostinger → Environment variables, add your MongoDB Atlas connection string, e.g. '
      + 'MONGO_URI=mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/society-management?retryWrites=true&w=majority '
      + 'Also set NODE_ENV=production, SESSION_SECRET, and TRUST_PROXY=1.'
    );
  }

  if (!isProduction) return;

  if (!sessionSecret || sessionSecret === 'society-secret' || sessionSecret === 'change-this-to-a-random-secret') {
    throw new Error(
      'Production requires a strong SESSION_SECRET. '
      + 'Set it in Hostinger → Environment variables (do not use the default placeholder).'
    );
  }
}


function applyNoCacheHeaders(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
}

function sendHtmlPage(res, filename) {
  const filePath = path.join(__dirname, 'views', filename);
  applyNoCacheHeaders(res);

  // Always stamp static asset URLs so CSS/JS updates deploy cleanly behind CDN/proxy caches.
  let html = fs.readFileSync(filePath, 'utf8');
  html = html.replace(/(\/(?:static\/[^"']+))(?:\?v=[^"']*)?/g, `$1?v=${ASSET_VERSION}`);
  return res.type('html').send(html);
}

function maskMongoUri(uri) {
  return String(uri || '').replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
}

function buildApp(sessionStore) {
  // Hostinger (and most hosts) terminate TLS at a reverse proxy.
  if (isProduction || process.env.TRUST_PROXY === '1') {
    app.set('trust proxy', 1);
  }

  app.disable('x-powered-by');
  app.use(express.json({ limit: '8mb' }));
  app.use(express.urlencoded({ extended: true, limit: '8mb' }));

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  app.use('/static', (req, res, next) => {
    if (!isProduction) {
      applyNoCacheHeaders(res);
    }
    next();
  }, express.static(path.join(__dirname, 'public'), {
    etag: isProduction,
    maxAge: isProduction ? '7d' : 0,
    index: false,
  }));

  app.use(session({
    name: 'society.sid',
    secret: sessionSecret || 'society-secret',
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24,
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
    },
    proxy: isProduction || process.env.TRUST_PROXY === '1',
  }));

  // Sensitive KYC / loan / chat files — never public static. Ownership checked per request.
  const { mountProtectedUploads } = require('./middleware/secureUploads');
  mountProtectedUploads(app);

  app.use('/api/auth', authRoutes);
  app.use('/api/developer', developerRoutes);
  app.use('/api/ceo', ceoRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/admin/deposits', adminDepositsRoutes);
  app.use('/api/admin/investments', investmentRoutes);
  app.use('/api/admin/ious', iouRoutes);
  app.use('/api/member', memberRoutes);
  app.use('/api/member/deposits', depositRoutes);
  app.use('/api/withdrawals', withdrawalRoutes);
  app.use('/api/loans', loanRoutes);
  app.use('/api/kyc', kycRoutes);
  app.use('/api/admin/profit', profitRoutes);
  app.use('/api/admin/sales', salesRoutes);
  app.use('/api/admin/bank-ledger', bankLedgerRoutes);
  app.use('/api/admin/profit-pool', profitPoolRoutes);
  app.use('/api/admin/funding', advanceBorrowingRoutes);
  app.use('/api/admin/monthly-targets', monthlyTargetsRoutes);
  app.use('/api/admin/notifications', adminNotificationRoutes);
  app.use('/api/member/notifications', memberNotificationRoutes);
  app.use('/api/admin/chat', adminChatRoutes);
  app.use('/api/member/chat', memberChatRoutes);

  function ensureAuthPage(req, res, next) {
    if (req.session?.user) return next();
    return res.redirect('/');
  }

  function ensureCeoPage(req, res, next) {
    if (isFullAccessRole(req.session?.user?.role) || isDeveloperRole(req.session?.user?.role)) return next();
    return res.redirect(dashboardPathForRole(req.session?.user?.role) || '/');
  }

  function ensureDeveloperPage(req, res, next) {
    if (isDeveloperRole(req.session?.user?.role)) return next();
    return res.redirect(dashboardPathForRole(req.session?.user?.role) || '/');
  }

  function ensureUserManagementPage(req, res, next) {
    if (canAccessDeveloperModule(req.session?.user?.role)) return next();
    return res.redirect(dashboardPathForRole(req.session?.user?.role) || '/');
  }

  function ensureAdminOpsPage(req, res, next) {
    // Pure User Management admins use their own dashboard — not the ops console
    if (isDeveloperRole(req.session?.user?.role)) {
      return res.redirect('/user-management');
    }
    if (isFullAccessRole(req.session?.user?.role)) return next();

    // Staff roles (cashier, etc.) use dedicated /dashboard/* workspaces — never the CEO panel.
    const user = req.session?.user;
    if (user?.role) {
      return res.redirect(dashboardPathForRole(user.role) || '/');
    }

    return res.redirect('/');
  }

  function ensureMemberPage(req, res, next) {
    if (req.session?.user?.role === 'member') return next();
    return res.redirect(dashboardPathForRole(req.session?.user?.role) || '/');
  }

  function ensureStaffRolePage(role) {
    return (req, res, next) => {
      const userRole = req.session?.user?.role;
      if (userRole === role || isFullAccessRole(userRole)) return next();
      return res.redirect(dashboardPathForRole(userRole) || '/');
    };
  }

  app.get('/', (req, res) => {
    if (req.session?.user) {
      return res.redirect(dashboardPathForRole(req.session.user.role));
    }
    sendHtmlPage(res, 'index.html');
  });

  app.get('/ceo', ensureAuthPage, ensureCeoPage, (req, res) => {
    return res.redirect('/admin');
  });

  app.get('/developer', ensureAuthPage, ensureUserManagementPage, (req, res) => {
    return res.redirect('/user-management');
  });

  app.get('/user-management', ensureAuthPage, ensureUserManagementPage, (req, res) => {
    sendHtmlPage(res, 'user-management.html');
  });

  app.get('/admin', ensureAuthPage, ensureAdminOpsPage, (req, res) => {
    sendHtmlPage(res, 'admin.html');
  });

  app.get('/admin/investors/:investorId', ensureAuthPage, ensureAdminOpsPage, (req, res) => {
    sendHtmlPage(res, 'admin.html');
  });

  app.get('/admin/project-managers/:managerId', ensureAuthPage, ensureAdminOpsPage, (req, res) => {
    sendHtmlPage(res, 'admin.html');
  });

  app.get('/members/:memberId', ensureAuthPage, ensureAdminOpsPage, (req, res) => {
    sendHtmlPage(res, 'admin.html');
  });

  app.get('/member', ensureAuthPage, ensureMemberPage, (req, res) => {
    sendHtmlPage(res, 'member.html');
  });

  app.get('/dashboard/project-manager', ensureAuthPage, ensureStaffRolePage('project_manager'), (req, res) => {
    sendHtmlPage(res, 'staff.html');
  });

  app.get('/dashboard/cashier', ensureAuthPage, ensureStaffRolePage('cashier'), (req, res) => {
    sendHtmlPage(res, 'staff.html');
  });

  app.get('/dashboard/employee', ensureAuthPage, ensureStaffRolePage('employee'), (req, res) => {
    sendHtmlPage(res, 'staff.html');
  });

  app.get('/dashboard/investor', ensureAuthPage, ensureStaffRolePage('investor'), (req, res) => {
    sendHtmlPage(res, 'staff.html');
  });

  app.get('/api/health', (req, res) => {
    const mongoState = mongoose.connection.readyState;
    const healthy = mongoState === 1;
    return res.status(healthy ? 200 : 503).json({
      ok: healthy,
      env: isProduction ? 'production' : 'development',
      mongo: mongoState === 1 ? 'connected' : 'disconnected',
      uptime: process.uptime(),
    });
  });

  app.get('/api/session', (req, res) => {
    const sessionUser = req.session.user;
    if (!sessionUser) {
      return res.json({ user: null });
    }

    return res.json({
      user: {
        id: sessionUser.id,
        email: sessionUser.email,
        role: sessionUser.role,
        name: sessionUser.name,
        permissions: sessionUser.permissions || [],
        redirectTo: dashboardPathForRole(sessionUser.role),
      },
    });
  });

  app.use((req, res) => {
    if (req.accepts('html') && !req.path.startsWith('/api/')) {
      applyNoCacheHeaders(res);
      return res.status(404).type('html').send(
        '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Not found</title></head>'
        + '<body style="font-family:system-ui;padding:2rem"><h1>Page not found</h1>'
        + '<p><a href="/">Return to SocietyHub</a></p></body></html>'
      );
    }
    return res.status(404).json({ error: 'Not found' });
  });

  app.use((err, req, res, next) => {
    console.error('[express]', err);
    if (res.headersSent) return next(err);
    const status = err.status || err.statusCode || 500;
    return res.status(status).json({
      error: err.expose ? err.message : 'Internal server error.',
    });
  });

  // silence unused-lint style for ensureDeveloperPage (kept for future /developer HTML page)
  void ensureDeveloperPage;
}

async function connectMongo() {
  if (!mongoUri) {
    throw new Error('MONGO_URI (or MONGODB_URI) is required.');
  }

  mongoose.connection.on('error', (error) => {
    console.error('[mongo] connection error:', error.message);
  });
  mongoose.connection.on('disconnected', () => {
    if (!shuttingDown) {
      console.warn('[mongo] disconnected — will retry automatically');
    }
  });
  mongoose.connection.on('reconnected', () => {
    console.log('[mongo] reconnected');
  });

  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 15000,
  });
  console.log(`MongoDB connected (${maskMongoUri(mongoUri)})`);
  await seedDefaultUsers();
  await ensureDefaultInvestmentTypes();
}

function createSessionStore() {
  const store = MongoStore.create({
    mongoUrl: mongoUri,
    collectionName: 'sessions',
    ttl: 60 * 60 * 24,
  });
  store.on('error', (error) => {
    console.error('[session-store]', error.message || error);
  });
  return store;
}

function listen() {
  return new Promise((resolve, reject) => {
    // Bind all interfaces so Hostinger / reverse proxies can reach the app.
    httpServer = app.listen(port, '0.0.0.0', () => {
      const hostHint = process.env.APP_URL || `http://localhost:${port}`;
      console.log(`Server running on port ${port} (${isProduction ? 'production' : 'development'})`);
      console.log(`Health check: ${hostHint.replace(/\/$/, '')}/api/health`);
      if (!isProduction) {
        console.log(`Dev mode: assets refresh automatically (version ${ASSET_VERSION})`);
      }
      resolve(httpServer);
    });
    httpServer.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        reject(new Error(
          `Port ${port} is already in use. Stop the other process or run: npm run restart`
        ));
        return;
      }
      reject(error);
    });
  });
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] received ${signal}`);

  const forceTimer = setTimeout(() => {
    console.error('[shutdown] forced exit after timeout');
    process.exit(1);
  }, 8000);
  forceTimer.unref?.();

  try {
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
    }
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
    clearTimeout(forceTimer);
    process.exit(0);
  } catch (error) {
    console.error('[shutdown] error:', error);
    process.exit(1);
  }
}

async function bootstrap() {
  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
  });
  process.on('uncaughtException', (error) => {
    console.error('[uncaughtException]', error);
  });
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  try {
    assertProductionConfig();
    await connectMongo();
    buildApp(createSessionStore());
    await listen();
  } catch (error) {
    console.error('[bootstrap] failed to start server:', error.message || error);
    console.error('[bootstrap] check NODE_ENV / MONGO_URI / SESSION_SECRET / PORT, then retry.');
    process.exit(1);
  }
}

void bootstrap();
