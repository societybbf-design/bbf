'use strict';

/**
 * Mixed-script PDF text helpers for PDFKit.
 * - DejaVu Sans: Latin / punctuation / symbols
 * - Noto Sans Bengali: Bengali letters + ৳ + digits
 *
 * Never draw Latin with the Bengali font (tofu) or Bengali with DejaVu (garbled).
 */

const LATIN_FONT = 'DejaVuSans';
const LATIN_FONT_BOLD = 'DejaVuSans-Bold';
const BENGALI_FONT = 'NotoSansBengali';

const BENGALI_OR_TAKA = /[\u0980-\u09FF]/;
const LATIN_LETTER = /[A-Za-z]/;

function hasBengali(text) {
  return BENGALI_OR_TAKA.test(String(text || ''));
}

function hasLatinLetters(text) {
  return LATIN_LETTER.test(String(text || ''));
}

/**
 * Split text into font runs. Digits/punctuation beside ৳ stay on Bengali font
 * when attached to a Bengali/৳ run; pure ASCII runs use DejaVu.
 */
function splitPdfTextRuns(text) {
  const input = String(text ?? '');
  if (!input) return [{ font: 'latin', text: '' }];

  const runs = [];
  let buffer = '';
  let mode = null; // 'latin' | 'bengali'

  const flush = () => {
    if (!buffer) return;
    runs.push({ font: mode || 'latin', text: buffer });
    buffer = '';
  };

  for (const ch of input) {
    const code = ch.codePointAt(0);
    const isBengali = code >= 0x0980 && code <= 0x09FF;
    const nextMode = isBengali ? 'bengali' : 'latin';
    // Keep ASCII digits/separators with an active Bengali money/name run.
    const stickyAscii = mode === 'bengali'
      && !isBengali
      && /[0-9.,:\-+%/() ]/.test(ch)
      && !LATIN_LETTER.test(ch);

    const resolved = stickyAscii ? 'bengali' : nextMode;
    if (mode == null) mode = resolved;
    if (resolved !== mode) {
      flush();
      mode = resolved;
    }
    buffer += ch;
  }
  flush();
  return runs.length ? runs : [{ font: 'latin', text: input }];
}

function selectRunFont(doc, fontKind, { bold = false, size } = {}) {
  const registered = doc._bbbfFonts || {};
  if (fontKind === 'bengali' && registered.bengali) {
    doc.font(BENGALI_FONT);
  } else if (bold && registered.latinBold) {
    doc.font(LATIN_FONT_BOLD);
  } else if (registered.latin) {
    doc.font(LATIN_FONT);
  } else {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
  }
  if (size != null) doc.fontSize(size);
  return doc;
}

function widthOfMixedString(doc, text, { size = 9, bold = false } = {}) {
  let width = 0;
  for (const run of splitPdfTextRuns(text)) {
    selectRunFont(doc, run.font, { bold, size });
    width += doc.widthOfString(run.text);
  }
  return width;
}

function heightOfMixedString(doc, text, width, {
  size = 9,
  bold = false,
  lineGap = 1.35,
} = {}) {
  const lineHeight = size * lineGap;
  const lines = wrapMixedLines(doc, text, width, { size, bold });
  return Math.max(lineHeight, lines.length * lineHeight);
}

function wrapMixedLines(doc, text, width, { size = 9, bold = false } = {}) {
  const raw = String(text ?? '');
  if (!raw) return [''];
  const maxWidth = Math.max(8, Number(width) || 0);
  const tokens = raw.split(/(\s+)/);
  const lines = [];
  let current = '';

  const fits = (candidate) => widthOfMixedString(doc, candidate, { size, bold }) <= maxWidth + 0.01;

  for (const token of tokens) {
    if (!token) continue;
    const candidate = current + token;
    if (!current) {
      // Force-break an overlong token.
      if (!fits(token) && token.trim()) {
        let chunk = '';
        for (const ch of token) {
          const next = chunk + ch;
          if (chunk && !fits(next)) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk = next;
          }
        }
        current = chunk;
      } else {
        current = token;
      }
      continue;
    }
    if (fits(candidate)) {
      current = candidate;
    } else {
      lines.push(current.replace(/\s+$/, ''));
      current = token.replace(/^\s+/, '');
    }
  }
  if (current) lines.push(current.replace(/\s+$/, ''));
  return lines.length ? lines : [''];
}

/**
 * Draw mixed-script text inside a box. Does not let PDFKit auto-paginate
 * (lineBreak:false), so callers must reserve vertical space first.
 * @returns {number} height consumed
 */
function drawMixedTextInBox(doc, text, x, y, width, {
  size = 9,
  bold = false,
  color = '#1f2937',
  align = 'left',
  lineGap = 1.35,
  maxLines = Infinity,
} = {}) {
  const lineHeight = size * lineGap;
  let lines = wrapMixedLines(doc, text, width, { size, bold });
  if (Number.isFinite(maxLines) && lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    const last = lines[lines.length - 1] || '';
    lines[lines.length - 1] = `${last.replace(/\s+$/, '')}…`;
  }

  const savedX = doc.x;
  const savedY = doc.y;
  doc.fillColor(color);

  lines.forEach((line, index) => {
    const lineY = y + index * lineHeight;
    const lineWidth = widthOfMixedString(doc, line, { size, bold });
    let cursorX = x;
    if (align === 'right') cursorX = x + Math.max(0, width - lineWidth);
    else if (align === 'center') cursorX = x + Math.max(0, (width - lineWidth) / 2);

    for (const run of splitPdfTextRuns(line)) {
      selectRunFont(doc, run.font, { bold, size });
      doc.text(run.text, cursorX, lineY, {
        lineBreak: false,
        continued: false,
        width: Math.max(lineWidth, width),
      });
      cursorX += doc.widthOfString(run.text);
    }
  });

  doc.x = savedX;
  doc.y = savedY;
  return Math.max(lineHeight, lines.length * lineHeight);
}

module.exports = {
  LATIN_FONT,
  LATIN_FONT_BOLD,
  BENGALI_FONT,
  hasBengali,
  hasLatinLetters,
  splitPdfTextRuns,
  selectRunFont,
  widthOfMixedString,
  heightOfMixedString,
  wrapMixedLines,
  drawMixedTextInBox,
};
