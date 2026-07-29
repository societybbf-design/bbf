'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const loanServiceJs = fs.readFileSync(path.join(__dirname, '../services/loanService.js'), 'utf8');
const pdfLangJs = fs.readFileSync(path.join(__dirname, '../public/js/pdf-language.js'), 'utf8');
const memberJs = fs.readFileSync(path.join(__dirname, '../public/js/member.js'), 'utf8');
const adminJs = fs.readFileSync(path.join(__dirname, '../public/js/admin.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));

test('pdfkit is listed as a dependency for contract generation', () => {
  assert.ok(packageJson.dependencies.pdfkit);
});

test('getLoanContractFile regenerates missing contract PDFs', () => {
  assert.match(loanServiceJs, /async function getLoanContractFile/);
  assert.match(loanServiceJs, /regenerateIfMissing/);
  assert.match(loanServiceJs, /generateLoanContractForApplication/);
  assert.match(loanServiceJs, /Contract file is missing after regeneration/);
  assert.match(loanServiceJs, /'approved', 'disbursed', 'completed'/);
});

test('PDF download helper fetches blob and shows errors instead of raw JSON tabs', () => {
  assert.match(pdfLangJs, /async function fetchPdfBlob/);
  assert.match(pdfLangJs, /showPdfErrorToast/);
  assert.match(pdfLangJs, /application\/json/);
  assert.match(pdfLangJs, /saveBlobAsFile/);
  assert.doesNotMatch(
    pdfLangJs.slice(pdfLangJs.indexOf('async function triggerPdfDownload'), pdfLangJs.indexOf('window.PdfLanguage')),
    /window\.open\(finalUrl/
  );
});

test('member contract download uses button + safe handler', () => {
  assert.match(memberJs, /data-loan-contract-download/);
  assert.match(memberJs, /async function downloadLoanContractPdf/);
  assert.doesNotMatch(memberJs, /href="\/api\/loans\/member\/\$\{loan\._id\}\/contract"/);
});

test('CEO loan review uses safe contract download button', () => {
  assert.match(adminJs, /data-loan-contract-download/);
  assert.match(adminJs, /Download Contract PDF/);
  assert.match(adminJs, /\[ceo-loan-contract-download\]/);
  assert.doesNotMatch(adminJs, /href="\/api\/loans\/admin\/\$\{loan\._id\}\/contract"/);
});
