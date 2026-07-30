'use strict';

const { runMonthlyAutoDeductions } = require('./monthlyAutoDeductionService');

const CHECK_INTERVAL_MS = Number(process.env.SCHEDULED_JOBS_INTERVAL_MS) || (60 * 60 * 1000);
let intervalHandle = null;
let lastAutoDeductionKey = '';

function autoDeductionRunKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getDate()}`;
}

async function runDailyAutoDeductionJob() {
  const now = new Date();
  const key = autoDeductionRunKey(now);
  if (lastAutoDeductionKey === key) {
    return { skipped: true, reason: 'already_ran_today', key };
  }

  const result = await runMonthlyAutoDeductions({ asOf: now });
  if (!result.skipped || result.applied > 0) {
    lastAutoDeductionKey = key;
  }
  if (result.applied > 0) {
    console.log(`[scheduledJobs] auto monthly deduction: ${result.applied} member(s) for ${result.yearMonth}`);
  }
  return result;
}

function startScheduledJobs() {
  if (intervalHandle) return intervalHandle;
  if (String(process.env.DISABLE_SCHEDULED_JOBS || '').toLowerCase() === 'true') {
    console.log('[scheduledJobs] disabled via DISABLE_SCHEDULED_JOBS');
    return null;
  }

  const tick = () => {
    runDailyAutoDeductionJob().catch((error) => {
      console.warn('[scheduledJobs] auto deduction failed:', error.message);
    });
  };

  // Initial run shortly after boot, then hourly (deduped per calendar day).
  setTimeout(tick, 15_000);
  intervalHandle = setInterval(tick, CHECK_INTERVAL_MS);
  console.log(`[scheduledJobs] started (interval ${CHECK_INTERVAL_MS}ms)`);
  return intervalHandle;
}

function stopScheduledJobs() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = {
  startScheduledJobs,
  stopScheduledJobs,
  runDailyAutoDeductionJob,
};
