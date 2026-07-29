'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const service = require('../services/cashierNotesService');
const router = require('../routes/cashierNotes');
const staffHtml = fs.readFileSync(path.join(__dirname, '../views/staff.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '../public/js/cashier-notes-pad.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../public/css/cashier-notes.css'), 'utf8');
const serverJs = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const modelJs = fs.readFileSync(path.join(__dirname, '../models/CashierNotesPad.js'), 'utf8');

test('cashier notes routes expose GET and PUT', () => {
  const paths = router.stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods).join(',').toUpperCase()} ${layer.route.path}`);
  assert.ok(paths.some((p) => p.includes('GET /')));
  assert.ok(paths.some((p) => p.includes('PUT /')));
});

test('server mounts /api/cashier-notes', () => {
  assert.match(serverJs, /\/api\/cashier-notes/);
});

test('normalizeTasks trims and caps task list', () => {
  const tasks = service.normalizeTasks([
    { text: '  Call member  ', done: false },
    { text: '', done: false },
    { id: 'x', text: 'Done already', done: true },
  ]);
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].text, 'Call member');
  assert.equal(tasks[1].done, true);
});

test('todayKey is YYYY-MM-DD', () => {
  assert.match(service.todayKey(new Date('2026-07-29T12:00:00Z')), /^\d{4}-\d{2}-\d{2}$/);
});

test('staff dashboard includes floating notes assets', () => {
  assert.match(staffHtml, /cashier-notes\.css/);
  assert.match(staffHtml, /cashier-notes-pad\.js/);
});

test('notes pad UI is floating, modal, checklist, and persistent', () => {
  assert.match(js, /cashierNotesFab/);
  assert.match(js, /cashierNotesModal/);
  assert.match(js, /pointerdown/);
  assert.match(js, /localStorage/);
  assert.match(js, /\/api\/cashier-notes/);
  assert.match(js, /cashier-notes-task-check/);
  assert.match(js, /scheduleSave/);
  assert.match(css, /position:\s*fixed/);
  assert.match(css, /cashier-notes-fab/);
  assert.match(css, /cashier-notes-modal/);
});

test('CashierNotesPad model stores notes, tasks, and fab position', () => {
  assert.match(modelJs, /notes:/);
  assert.match(modelJs, /tasks:/);
  assert.match(modelJs, /fabPosition/);
  assert.match(modelJs, /checklistDay/);
});
