'use strict';

/**
 * Simple in-memory sliding-window rate limiter for auth / UM mutating routes.
 * Suitable for single-process Node; production multi-instance should use Redis.
 */

function httpError(message, status = 429) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function createRateLimiter({
  windowMs = 60 * 1000,
  max = 20,
  message = 'Too many requests. Please wait and try again.',
} = {}) {
  const hits = new Map();

  function assert(key) {
    const normalized = String(key || 'anonymous').trim() || 'anonymous';
    const now = Date.now();
    const entry = hits.get(normalized) || { count: 0, window: now };
    if (now - entry.window > windowMs) {
      entry.count = 0;
      entry.window = now;
    }
    entry.count += 1;
    hits.set(normalized, entry);
    if (entry.count > max) {
      throw httpError(message, 429);
    }
  }

  /** Express middleware — keys by IP (+ optional suffix from req). */
  function middleware(extraKeyFn = null) {
    return (req, res, next) => {
      try {
        const ip = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim()
          || req.socket?.remoteAddress
          || 'unknown';
        const extra = typeof extraKeyFn === 'function' ? extraKeyFn(req) : '';
        assert(extra ? `${ip}:${extra}` : ip);
        return next();
      } catch (error) {
        return res.status(error.status || 429).json({ error: error.message || message });
      }
    };
  }

  return { assert, middleware, _hits: hits };
}

const loginRateLimit = createRateLimiter({
  windowMs: Number(process.env.LOGIN_RATE_LIMIT_MS) || 60 * 1000,
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 20,
  message: 'Too many login attempts from this network. Please wait a minute and try again.',
});

const umCreateRateLimit = createRateLimiter({
  windowMs: Number(process.env.UM_CREATE_RATE_LIMIT_MS) || 60 * 1000,
  max: Number(process.env.UM_CREATE_RATE_LIMIT_MAX) || 10,
  message: 'Too many account creation attempts. Please wait a minute and try again.',
});

const umMutateRateLimit = createRateLimiter({
  windowMs: Number(process.env.UM_MUTATE_RATE_LIMIT_MS) || 60 * 1000,
  max: Number(process.env.UM_MUTATE_RATE_LIMIT_MAX) || 30,
  message: 'Too many account update attempts. Please wait a minute and try again.',
});

const otpVerifyRateLimit = createRateLimiter({
  windowMs: Number(process.env.OTP_VERIFY_RATE_LIMIT_MS) || 60 * 1000,
  max: Number(process.env.OTP_VERIFY_RATE_LIMIT_MAX) || 10,
  message: 'Too many OTP verification attempts. Please wait a minute and try again.',
});

module.exports = {
  createRateLimiter,
  loginRateLimit,
  umCreateRateLimit,
  umMutateRateLimit,
  otpVerifyRateLimit,
};
