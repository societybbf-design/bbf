'use strict';

const crypto = require('crypto');
const CashierNotesPad = require('../models/CashierNotesPad');

function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function moneyClampPct(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(96, Math.max(2, Number(n.toFixed(2))));
}

function normalizeTasks(rawTasks = []) {
  if (!Array.isArray(rawTasks)) return [];
  return rawTasks
    .map((row) => {
      const text = String(row?.text || '').trim().slice(0, 500);
      if (!text && !row?.done) return null;
      const id = String(row?.id || crypto.randomUUID()).slice(0, 64);
      const done = Boolean(row?.done);
      return {
        id,
        text: text || 'Untitled task',
        done,
        createdAt: row?.createdAt ? new Date(row.createdAt) : new Date(),
        completedAt: done
          ? (row?.completedAt ? new Date(row.completedAt) : new Date())
          : null,
      };
    })
    .filter(Boolean)
    .slice(0, 200);
}

function serializePad(pad) {
  return {
    notes: pad.notes || '',
    tasks: (pad.tasks || []).map((task) => ({
      id: task.id,
      text: task.text,
      done: Boolean(task.done),
      createdAt: task.createdAt || null,
      completedAt: task.completedAt || null,
    })),
    checklistDay: pad.checklistDay || todayKey(),
    fabPosition: {
      leftPct: pad.fabPosition?.leftPct ?? null,
      topPct: pad.fabPosition?.topPct ?? null,
      side: pad.fabPosition?.side || 'right',
    },
    updatedAt: pad.updatedAt || null,
  };
}

/**
 * Carry incomplete tasks into a new day; drop completed ones from prior days.
 */
function rolloverDailyTasks(pad, dayKey) {
  if (pad.checklistDay === dayKey) return pad;
  const carried = (pad.tasks || []).filter((task) => !task.done);
  pad.tasks = carried;
  pad.checklistDay = dayKey;
  return pad;
}

async function getOrCreatePad(userId) {
  let pad = await CashierNotesPad.findOne({ user: userId });
  if (!pad) {
    pad = await CashierNotesPad.create({
      user: userId,
      notes: '',
      tasks: [],
      checklistDay: todayKey(),
      fabPosition: { side: 'right', leftPct: null, topPct: null },
    });
  }
  const day = todayKey();
  if (pad.checklistDay !== day) {
    rolloverDailyTasks(pad, day);
    await pad.save();
  }
  return pad;
}

async function getPadForUser(userId) {
  const pad = await getOrCreatePad(userId);
  return serializePad(pad);
}

async function savePadForUser(userId, payload = {}) {
  const pad = await getOrCreatePad(userId);
  const day = todayKey();

  if (typeof payload.notes === 'string') {
    pad.notes = payload.notes.slice(0, 20000);
  }

  if (Array.isArray(payload.tasks)) {
    pad.tasks = normalizeTasks(payload.tasks);
    pad.checklistDay = day;
  } else if (pad.checklistDay !== day) {
    rolloverDailyTasks(pad, day);
  }

  if (payload.fabPosition && typeof payload.fabPosition === 'object') {
    const next = {
      side: ['left', 'right'].includes(payload.fabPosition.side)
        ? payload.fabPosition.side
        : (pad.fabPosition?.side || 'right'),
      leftPct: moneyClampPct(payload.fabPosition.leftPct, pad.fabPosition?.leftPct ?? null),
      topPct: moneyClampPct(payload.fabPosition.topPct, pad.fabPosition?.topPct ?? null),
    };
    pad.fabPosition = next;
  }

  await pad.save();
  return serializePad(pad);
}

module.exports = {
  todayKey,
  normalizeTasks,
  serializePad,
  getPadForUser,
  savePadForUser,
  getOrCreatePad,
};
