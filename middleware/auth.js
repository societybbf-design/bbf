const {
  isFullAccessRole,
  isDeveloperRole,
  isAbsoluteControlRole,
  userHasPermission,
  userHasAnyPermission,
} = require('../services/rbac');
const {
  verifyUserPassword,
  rolesRequiringPasswordConfirm,
  recordAudit,
  clientIp,
} = require('../services/securityService');

function requireAuth(req, res, next) {
  if (req.session?.user) {
    return next();
  }

  if (req.accepts('html') && !req.path.startsWith('/api/')) {
    return res.redirect('/');
  }

  return res.status(401).json({ error: 'Authentication required.' });
}

function requireDeveloper(req, res, next) {
  // User Management absolute control: dedicated developer role OR CEO/admin
  const role = req.session?.user?.role;
  if (isDeveloperRole(role) || isFullAccessRole(role)) {
    return next();
  }
  return res.status(403).json({ error: 'User Management access required.' });
}

function requireCeo(req, res, next) {
  if (isFullAccessRole(req.session?.user?.role) || isAbsoluteControlRole(req.session?.user?.role)) {
    return next();
  }
  return res.status(403).json({ error: 'CEO access required.' });
}

/** Legacy admin panel + CEO full access (+ developer absolute) */
function requireAdmin(req, res, next) {
  if (isFullAccessRole(req.session?.user?.role) || isAbsoluteControlRole(req.session?.user?.role)) {
    return next();
  }
  return res.status(403).json({ error: 'Forbidden' });
}

function requireRoles(...roles) {
  const allowed = new Set(roles.flat());
  return (req, res, next) => {
    const role = req.session?.user?.role;
    if (role && (
      allowed.has(role)
      || (allowed.has('ceo') && isFullAccessRole(role))
      || isAbsoluteControlRole(role)
    )) {
      return next();
    }
    return res.status(403).json({ error: 'Forbidden' });
  };
}

function requirePermission(...permissionKeys) {
  const required = permissionKeys.flat();
  return (req, res, next) => {
    const user = req.session?.user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (userHasAnyPermission(user, required)) {
      return next();
    }
    return res.status(403).json({ error: 'You do not have permission for this action.' });
  };
}

function requireAllPermissions(...permissionKeys) {
  const required = permissionKeys.flat();
  return (req, res, next) => {
    const user = req.session?.user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (
      isAbsoluteControlRole(user.role)
      || isFullAccessRole(user.role)
      || required.every((key) => userHasPermission(user, key))
    ) {
      return next();
    }
    return res.status(403).json({ error: 'You do not have permission for this action.' });
  };
}

/**
 * Re-confirm account password for sensitive cashier / manager / CEO actions.
 * Expects confirmPassword in JSON body or X-Confirm-Password header.
 */
function requirePasswordConfirmation(req, res, next) {
  return (async () => {
    try {
      const user = req.session?.user;
      if (!user) {
        return res.status(401).json({ error: 'Authentication required.' });
      }

      if (!rolesRequiringPasswordConfirm(user.role)) {
        return next();
      }

      const confirmPassword = req.body?.confirmPassword
        || req.headers['x-confirm-password']
        || '';

      if (!confirmPassword) {
        return res.status(403).json({
          error: 'Password confirmation required for this action.',
          requiresPasswordConfirmation: true,
        });
      }

      const ok = await verifyUserPassword(user.id, confirmPassword);
      if (!ok) {
        await recordAudit({
          action: 'password_confirm_failed',
          actorId: user.id,
          actorEmail: user.email,
          actorRole: user.role,
          details: { path: req.originalUrl, method: req.method },
          ip: clientIp(req),
          success: false,
        });
        return res.status(401).json({
          error: 'Password confirmation failed.',
          requiresPasswordConfirmation: true,
        });
      }

      // Strip confirm password so downstream handlers never persist it
      if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'confirmPassword')) {
        delete req.body.confirmPassword;
      }

      await recordAudit({
        action: 'password_confirm_ok',
        actorId: user.id,
        actorEmail: user.email,
        actorRole: user.role,
        details: { path: req.originalUrl, method: req.method },
        ip: clientIp(req),
      });

      return next();
    } catch (error) {
      return res.status(500).json({ error: 'Unable to verify password confirmation.' });
    }
  })();
}

function pageGuard(...roleOrFns) {
  return (req, res, next) => {
    if (!req.session?.user) {
      return res.redirect('/');
    }

    for (const item of roleOrFns) {
      if (typeof item === 'function') {
        let passed = false;
        item(req, res, (err) => {
          if (!err) passed = true;
        });
        if (!passed) {
          return res.redirect('/');
        }
      } else if (typeof item === 'string') {
        const role = req.session.user.role;
        if (item === 'developer' && isDeveloperRole(role)) continue;
        if (item === 'ceo' && (isFullAccessRole(role) || isAbsoluteControlRole(role))) continue;
        if (role === item) continue;
        return res.redirect('/');
      }
    }
    return next();
  };
}

module.exports = {
  requireAuth,
  requireDeveloper,
  requireCeo,
  requireAdmin,
  requireRoles,
  requirePermission,
  requireAllPermissions,
  requirePasswordConfirmation,
  pageGuard,
};
