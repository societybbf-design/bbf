/**
 * admin.js — CEO / Admin dashboard behavior for SocietyHub.
 *
 * Markup:  views/admin.html
 * Styles:  public/css/styles.css, admin-dashboard.css, utilities.css
 * Helpers: password-confirm.js (sensitive action re-auth), theme.js
 *
 * This file owns page navigation, KPI updates, members, deposits,
 * investments, loans, profit, sales, and CEO staff panels.
 */
const logoutBtn = document.getElementById('logoutBtn');
const logoutDropdown = document.getElementById('logoutDropdown');
const profileBtn = document.getElementById('profileBtn');
const profileDropdown = document.getElementById('profileDropdown');
const adminName = document.getElementById('adminName');
const adminEmail = document.getElementById('adminEmail');
const adminInitial = document.getElementById('adminInitial');
const totalMembers = document.getElementById('totalMembers');
const totalDeposits = document.getElementById('totalDeposits');
const totalSavings = document.getElementById('totalSavings');
const totalProfit = document.getElementById('totalProfit');
const dashboardTotalInvestment = document.getElementById('dashboardTotalInvestment');
const membersList = document.getElementById('membersList');
const depositHistory = document.getElementById('depositHistory');
const memberSearch = document.getElementById('memberSearch');
const searchMemberDetails = document.getElementById('searchMemberDetails');
const adminDepositForm = document.getElementById('adminDepositForm');
const selectedMemberName = document.getElementById('selectedMemberName');
const selectedMemberId = document.getElementById('selectedMemberId');
const depositAmount = document.getElementById('depositAmount');
const depositMessage = document.getElementById('depositMessage');
const latestReceiptLink = document.getElementById('latestReceiptLink');
const newMemberForm = document.getElementById('newMemberForm');
const adminMessage = document.getElementById('adminMessage');
const investmentForm = document.getElementById('investmentForm');
const investmentMessage = document.getElementById('investmentMessage');
const nextInvestmentCode = document.getElementById('nextInvestmentCode');
const investmentModal = document.getElementById('investmentModal');
const openInvestmentModalBtn = document.getElementById('openInvestmentModalBtn');
const closeInvestmentModalBtn = document.getElementById('closeInvestmentModal');
const societyActiveInvestmentList = document.getElementById('societyActiveInvestmentList');
const societySoldInvestmentList = document.getElementById('societySoldInvestmentList');
const investmentActiveCount = document.getElementById('investmentActiveCount');
const investmentActiveInvested = document.getElementById('investmentActiveInvested');
const investmentSoldCount = document.getElementById('investmentSoldCount');
const investmentTotalSavings = document.getElementById('investmentTotalSavings');
const editInvestmentModal = document.getElementById('editInvestmentModal');
const editInvestmentForm = document.getElementById('editInvestmentForm');
const editInvestmentMessage = document.getElementById('editInvestmentMessage');
const closeEditInvestmentModalBtn = document.getElementById('closeEditInvestmentModal');
const profitDistributionMessage = document.getElementById('profitDistributionMessage');
const investmentProfitForm = document.getElementById('investmentProfitForm');
const investmentProfitMessage = document.getElementById('investmentProfitMessage');
const investmentProfitHistoryList = document.getElementById('investmentProfitHistoryList');
const goToProfitPageBtn = document.getElementById('goToProfitPageBtn');
const profitMemberStatusList = document.getElementById('profitMemberStatusList');
const dashboardMembersList = document.getElementById('dashboardMembersList');
const dashboardNotesInput = document.getElementById('dashboardNotesInput');
const openIouModalBtn = document.getElementById('openIouModalBtn');
const iouModal = document.getElementById('iouModal');
const closeIouModalBtn = document.getElementById('closeIouModal');
const iouForm = document.getElementById('iouForm');
const iouMessage = document.getElementById('iouMessage');
const nextIouCode = document.getElementById('nextIouCode');
const investmentIouList = document.getElementById('investmentIouList');
const lastProfitDistribution = document.getElementById('lastProfitDistribution');
const profitHistoryList = document.getElementById('profitHistoryList');
const profitDistributionForm = document.getElementById('profitDistributionForm');
const reportMembers = document.getElementById('reportMembers');
const reportDeposits = document.getElementById('reportDeposits');
const reportInvestments = document.getElementById('reportInvestments');
const reportDetailTitle = document.getElementById('reportDetailTitle');
const reportDetailSubtitle = document.getElementById('reportDetailSubtitle');
const reportDetailHead = document.getElementById('reportDetailHead');
const reportDetailBody = document.getElementById('reportDetailBody');
const openAddMemberModalBtn = document.getElementById('openAddMemberModal');
const memberModal = document.getElementById('memberModal');
const closeMemberModalBtn = document.getElementById('closeMemberModal');
const withdrawalRequestsList = document.getElementById('withdrawalRequestsList');
const memberRosterList = document.getElementById('memberRosterList');
const noticeForm = document.getElementById('noticeForm');
const noticeMessage = document.getElementById('noticeMessage');
const noticeBoardList = document.getElementById('noticeBoardList');
const memberProfileModal = document.getElementById('memberProfileModal');
const closeMemberProfileModalBtn = document.getElementById('closeMemberProfileModal');
const memberProfileContent = document.getElementById('memberProfileContent');
const membersDirectoryApp = document.getElementById('membersDirectoryApp');
const pdfPreviewModal = document.getElementById('pdfPreviewModal');
const pdfPreviewEmbed = document.getElementById('pdfPreviewEmbed');
const pdfPreviewTitle = document.getElementById('pdfPreviewTitle');
const pdfPreviewSubtitle = document.getElementById('pdfPreviewSubtitle');
const pdfPreviewLoading = document.getElementById('pdfPreviewLoading');
const pdfPreviewFallback = document.getElementById('pdfPreviewFallback');
const pdfPreviewOpenNow = document.getElementById('pdfPreviewOpenNow');
const pdfPreviewOpenTab = document.getElementById('pdfPreviewOpenTab');
const closePdfPreviewModalBtn = document.getElementById('closePdfPreviewModal');
const closePdfPreviewBtn = document.getElementById('closePdfPreviewBtn');
let currentPdfBlobUrl = null;
let currentPdfUrl = '';
let adminMembers = [];
let adminDeletedMembers = [];
let adminDeposits = [];
let societyInvestments = [];
let societyActiveInvestments = [];
let societySoldInvestments = [];
let investmentIous = [];
let withdrawalRequests = [];
let adminProfitDistributions = [];
let adminInvestmentProfitRecords = [];
let activeAdminDashboardType = null;
let depositChart = null;
let lastSummaryData = {};
let monthlyContributionAmount = null;
let currentPage = 'dashboard';
let profitLookupTimer = null;
const profitFormState = new WeakMap();

function formatInvestmentDate(value) {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleDateString();
}

function formatProfitDueWindow(createdAt) {
  if (!createdAt) {
    return '-';
  }

  const base = new Date(createdAt);
  if (Number.isNaN(base.getTime())) {
    return '-';
  }

  const profitFrom = new Date(base);
  const profitUntil = new Date(base);
  profitFrom.setMonth(profitFrom.getMonth() + 10);
  profitUntil.setMonth(profitUntil.getMonth() + 12);

  const formatDate = (value) => value.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return `${formatDate(profitFrom)} - ${formatDate(profitUntil)}`;
}

function formatNetProfitLoss(value) {
  const amount = Number(value || 0);
  if (amount < 0) {
    return `-$${Math.abs(amount).toFixed(2)}`;
  }
  return `$${amount.toFixed(2)}`;
}

function formatRunningStatusBadge() {
  return '<span class="status-badge status-running">Running</span>';
}

function formatOutcomeStatusBadge(outcomeType) {
  if (outcomeType === 'loss') {
    return '<span class="status-badge status-loss">Loss</span>';
  }
  return '<span class="status-badge status-profit">Profit</span>';
}

function renderActiveInvestmentTableRows(investments) {
  return investments.map((investment) => {
    const investorId = investment.investor?._id || investment.investor;
    const pmId = investment.projectManager?._id || investment.projectManager;
    const investorName = investment.investor?.name || investment.investorName || investment.partner || '-';
    const pmName = investment.projectManager?.name || 'Unassigned';
    const investorCell = investorId
      ? `<a href="/admin/investors/${investorId}" class="table-link" data-open-investor="${investorId}">${investorName}</a>`
      : investorName;
    const pmCell = pmId
      ? `<a href="/admin/project-managers/${pmId}" class="table-link" data-open-pm="${pmId}">${pmName}</a>`
      : pmName;

    return `
    <tr>
      <td><strong>${investment.investmentCode || '-'}</strong></td>
      <td>${investorCell}</td>
      <td>${investment.investmentType || '-'}</td>
      <td>${pmCell}</td>
      <td>${investment.location || investment.sector || '-'}</td>
      <td>$${Number(investment.amount || 0).toFixed(2)}</td>
      <td>${new Date(investment.createdAt).toLocaleString()}</td>
      <td>${investment.displayStatus || 'Successful'}</td>
      <td>
        <button type="button" class="receipt-button" data-pdf-preview="/api/admin/investments/${investment._id}/receipt" data-pdf-title="${investment.investmentCode || 'Investment'}">View Receipt</button>
        <button type="button" class="secondary-btn" data-investment-edit="${investment._id}">Edit</button>
        <button type="button" class="secondary-btn" data-investment-delete="${investment._id}">Delete</button>
      </td>
    </tr>
  `;
  }).join('');
}

function renderSoldInvestmentTableRows(investments) {
  return investments.map((investment) => `
    <tr>
      <td><strong>${investment.investmentCode || '-'}</strong></td>
      <td>${investment.investor?.name || investment.investorName || investment.partner || '-'}</td>
      <td>${investment.investmentType || '-'}</td>
      <td>$${Number(investment.amount || 0).toFixed(2)}</td>
      <td>$${Number(investment.saleAmount || 0).toFixed(2)}</td>
      <td>${formatNetProfitLoss(investment.netProfitLoss)}</td>
      <td>${formatOutcomeStatusBadge(investment.outcomeType)}</td>
      <td>${investment.soldAt ? new Date(investment.soldAt).toLocaleString() : '-'}</td>
      <td>
        <button type="button" class="receipt-button" data-pdf-preview="/api/admin/investments/${investment._id}/receipt" data-pdf-title="${investment.investmentCode || 'Investment'}">View Receipt</button>
      </td>
    </tr>
  `).join('');
}

function resetPdfPreviewState() {
  if (currentPdfBlobUrl) {
    URL.revokeObjectURL(currentPdfBlobUrl);
    currentPdfBlobUrl = null;
  }
  currentPdfUrl = '';
  if (pdfPreviewEmbed) {
    pdfPreviewEmbed.removeAttribute('src');
    pdfPreviewEmbed.classList.remove('hidden');
  }
  if (pdfPreviewFallback) {
    pdfPreviewFallback.classList.add('hidden');
  }
  if (pdfPreviewLoading) {
    pdfPreviewLoading.classList.add('hidden');
  }
}

function openPdfInNewTab(url = currentPdfUrl) {
  if (!url) {
    return;
  }
  window.open(url, '_blank', 'noopener');
}

async function openPdfPreview(url, title = 'Investment Receipt', subtitle = '') {
  if (!pdfPreviewModal) {
    openPdfInNewTab(url);
    return;
  }

  resetPdfPreviewState();
  currentPdfUrl = url;

  if (pdfPreviewTitle) {
    pdfPreviewTitle.textContent = title;
  }
  if (pdfPreviewSubtitle) {
    pdfPreviewSubtitle.textContent = subtitle || 'Your receipt is ready right now. View the PDF below immediately.';
  }
  if (pdfPreviewLoading) {
    pdfPreviewLoading.classList.remove('hidden');
  }

  pdfPreviewModal.classList.remove('hidden');

  try {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) {
      throw new Error('Unable to load PDF');
    }

    const blob = await response.blob();
    currentPdfBlobUrl = URL.createObjectURL(blob);

    if (pdfPreviewEmbed) {
      pdfPreviewEmbed.src = currentPdfBlobUrl;
    }

    if (pdfPreviewLoading) {
      pdfPreviewLoading.classList.add('hidden');
    }

    window.setTimeout(() => {
      if (!pdfPreviewEmbed || pdfPreviewEmbed.clientHeight < 40) {
        if (pdfPreviewEmbed) {
          pdfPreviewEmbed.classList.add('hidden');
        }
        if (pdfPreviewFallback) {
          pdfPreviewFallback.classList.remove('hidden');
        }
      }
    }, 1200);
  } catch (error) {
    if (pdfPreviewLoading) {
      pdfPreviewLoading.classList.add('hidden');
    }
    if (pdfPreviewEmbed) {
      pdfPreviewEmbed.classList.add('hidden');
    }
    if (pdfPreviewFallback) {
      pdfPreviewFallback.classList.remove('hidden');
    }
  }
}

function closePdfPreview() {
  if (pdfPreviewModal) {
    pdfPreviewModal.classList.add('hidden');
  }
  resetPdfPreviewState();
}

if (pdfPreviewOpenNow) {
  pdfPreviewOpenNow.addEventListener('click', () => {
    if (currentPdfBlobUrl) {
      window.open(currentPdfBlobUrl, '_blank', 'noopener');
      return;
    }
    openPdfInNewTab();
  });
}

if (pdfPreviewOpenTab) {
  pdfPreviewOpenTab.addEventListener('click', () => {
    if (currentPdfBlobUrl) {
      window.open(currentPdfBlobUrl, '_blank', 'noopener');
      return;
    }
    openPdfInNewTab();
  });
}

if (closePdfPreviewModalBtn) {
  closePdfPreviewModalBtn.addEventListener('click', closePdfPreview);
}

if (closePdfPreviewBtn) {
  closePdfPreviewBtn.addEventListener('click', closePdfPreview);
}

if (pdfPreviewModal) {
  pdfPreviewModal.addEventListener('click', (event) => {
    if (event.target === pdfPreviewModal) {
      closePdfPreview();
    }
  });
}

function getProfitFormElements(form) {
  return {
    codeInput: form.querySelector('.profit-code-input'),
    nameInput: form.querySelector('.profit-name-input'),
    dobInput: form.querySelector('.profit-dob-input'),
    locationInput: form.querySelector('.profit-location-input'),
    amountInput: form.querySelector('.profit-amount-input'),
    saleInput: form.querySelector('.profit-sale-input'),
    profitInput: form.querySelector('.profit-profit-input'),
    statusEl: form.querySelector('.profit-lookup-status'),
    messageEl: form.querySelector('.profit-form-message'),
  };
}

function clearProfitAutofill(form) {
  const fields = getProfitFormElements(form);
  profitFormState.delete(form);
  if (fields.nameInput) fields.nameInput.value = '';
  if (fields.dobInput) fields.dobInput.value = '';
  if (fields.locationInput) fields.locationInput.value = '';
  if (fields.amountInput) fields.amountInput.value = '';
  if (fields.statusEl) {
    fields.statusEl.textContent = 'Enter an Investment ID to load details.';
    fields.statusEl.classList.remove('error', 'success');
  }
}

function updateCalculatedProfit(form) {
  const fields = getProfitFormElements(form);
  const selectedInvestment = profitFormState.get(form);
  if (!selectedInvestment || !fields.saleInput || !fields.profitInput) {
    return;
  }

  const saleAmount = Number(fields.saleInput.value);
  const investedAmount = Number(selectedInvestment.amount || 0);

  if (saleAmount > 0 && investedAmount > 0) {
    const calculated = Number((saleAmount - investedAmount).toFixed(2));
    if (calculated > 0) {
      fields.profitInput.value = calculated;
      if (fields.statusEl) {
        fields.statusEl.classList.remove('error');
      }
    } else if (calculated < 0) {
      fields.profitInput.value = '';
      if (fields.statusEl) {
        fields.statusEl.classList.add('error');
        fields.statusEl.textContent = `Sale is below investment by $${Math.abs(calculated).toFixed(2)}. Use the Record Investment Loss form.`;
      }
    }
  }
}

async function lookupInvestmentForProfitForm(form, code) {
  const fields = getProfitFormElements(form);
  const normalizedCode = code?.trim();

  if (!normalizedCode) {
    clearProfitAutofill(form);
    return;
  }

  if (fields.statusEl) {
    fields.statusEl.textContent = 'Looking up investment...';
    fields.statusEl.classList.remove('error', 'success');
  }

  try {
    const response = await fetch(`/api/admin/profit/investment-lookup/${encodeURIComponent(normalizedCode)}`);
    const data = await response.json();

    if (!response.ok) {
      clearProfitAutofill(form);
      if (fields.statusEl) {
        fields.statusEl.classList.add('error');
        fields.statusEl.textContent = data.error || 'Investment not found.';
      }
      return;
    }

    profitFormState.set(form, data.investment);
    if (fields.nameInput) fields.nameInput.value = data.investment.investorName || data.investment.partner || '';
    if (fields.dobInput) fields.dobInput.value = formatInvestmentDate(data.investment.dateOfBirth);
    if (fields.locationInput) fields.locationInput.value = data.investment.location || data.investment.sector || '';
    if (fields.amountInput) {
      fields.amountInput.value = `$${Number(data.investment.amount || 0).toFixed(2)}`;
    }
    if (fields.statusEl) {
      fields.statusEl.classList.add('success');
      fields.statusEl.textContent = `Loaded ${data.investment.investmentCode} for ${data.investment.investorName || data.investment.partner}`;
    }
    updateCalculatedProfit(form);
  } catch (error) {
    clearProfitAutofill(form);
    if (fields.statusEl) {
      fields.statusEl.classList.add('error');
      fields.statusEl.textContent = 'Unable to load investment details.';
    }
  }
}

function bindInvestmentProfitForm(form) {
  if (!form) {
    return;
  }

  const fields = getProfitFormElements(form);

  if (fields.codeInput) {
    fields.codeInput.addEventListener('input', () => {
      clearTimeout(profitLookupTimer);
      profitLookupTimer = setTimeout(() => {
        void lookupInvestmentForProfitForm(form, fields.codeInput.value);
      }, 400);
    });

    fields.codeInput.addEventListener('blur', () => {
      void lookupInvestmentForProfitForm(form, fields.codeInput.value);
    });
  }

  if (fields.saleInput) {
    fields.saleInput.addEventListener('input', () => updateCalculatedProfit(form));
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (fields.messageEl) {
      fields.messageEl.textContent = '';
      fields.messageEl.classList.remove('success', 'error');
    }

    const formData = new FormData(form);
    const payload = {
      investmentCode: formData.get('investmentCode')?.trim(),
      saleAmount: Number(formData.get('saleAmount')) || 0,
      profitAmount: Number(formData.get('profitAmount')) || 0,
      distributionType: formData.get('distributionType'),
      notes: formData.get('notes'),
    };

    if (!payload.investmentCode) {
      if (fields.messageEl) {
        fields.messageEl.classList.add('error');
        fields.messageEl.textContent = 'Investment ID is required.';
      }
      return;
    }

    try {
      const response = await fetch('/api/admin/profit/investment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (!response.ok) {
        if (fields.messageEl) {
          fields.messageEl.classList.add('error');
          fields.messageEl.textContent = data.error || 'Unable to record investment profit.';
        }
        return;
      }

      form.reset();
      clearProfitAutofill(form);
      await fetchMembers();
      await fetchSummary();
      await loadInvestments();
      await loadInvestmentProfitHistory();
      await loadProfitHistory();

      const shareSummary = (data.updatedMembers || [])
        .map((member) => `${member.memberName}: $${Number(member.share || 0).toFixed(2)}`)
        .join(', ');
      const savingsNote = data.principalReturned > 0
        ? ` $${Number(data.principalReturned).toFixed(2)} returned to Total Savings.`
        : '';

      if (fields.messageEl) {
        fields.messageEl.classList.add('success');
        fields.messageEl.textContent = `Profit of $${Number(data.calculatedProfit || 0).toFixed(2)} recorded for ${data.investment?.investmentCode || payload.investmentCode}.${savingsNote} ${shareSummary}`;
      }
    } catch (error) {
      if (fields.messageEl) {
        fields.messageEl.classList.add('error');
        fields.messageEl.textContent = 'Unable to record investment profit.';
      }
    }
  });
}

document.querySelectorAll('.investment-profit-form').forEach((form) => {
  bindInvestmentProfitForm(form);
});

const lossFormState = new WeakMap();

function getLossFormElements(form) {
  return {
    codeInput: form.querySelector('.loss-code-input'),
    nameInput: form.querySelector('.loss-name-input'),
    amountInput: form.querySelector('.loss-amount-invested-input'),
    saleInput: form.querySelector('.loss-sale-input'),
    lossInput: form.querySelector('.loss-amount-input'),
    statusEl: form.querySelector('.loss-lookup-status'),
    messageEl: form.querySelector('.loss-form-message'),
  };
}

function clearLossAutofill(form) {
  const fields = getLossFormElements(form);
  lossFormState.delete(form);
  if (fields.nameInput) fields.nameInput.value = '';
  if (fields.amountInput) fields.amountInput.value = '';
  if (fields.lossInput) fields.lossInput.value = '';
  if (fields.statusEl) {
    fields.statusEl.textContent = 'Enter an Investment ID and a sale amount lower than the investment.';
    fields.statusEl.classList.remove('error', 'success');
  }
}

function updateCalculatedLoss(form) {
  const fields = getLossFormElements(form);
  const selectedInvestment = lossFormState.get(form);
  if (!selectedInvestment || !fields.saleInput || !fields.lossInput) {
    return;
  }

  const saleAmount = Number(fields.saleInput.value);
  const investedAmount = Number(selectedInvestment.amount || 0);

  if (saleAmount >= 0 && investedAmount > 0 && saleAmount < investedAmount) {
    fields.lossInput.value = Number((investedAmount - saleAmount).toFixed(2));
    if (fields.statusEl) {
      fields.statusEl.classList.add('success');
      fields.statusEl.textContent = `Loss of $${fields.lossInput.value} will be shared equally among all members.`;
    }
  } else if (saleAmount >= investedAmount && investedAmount > 0) {
    fields.lossInput.value = '';
    if (fields.statusEl) {
      fields.statusEl.classList.add('error');
      fields.statusEl.textContent = 'Sale amount is not lower than investment. Use the profit form instead.';
    }
  }
}

async function lookupInvestmentForLossForm(form, code) {
  const fields = getLossFormElements(form);
  const normalizedCode = code?.trim();

  if (!normalizedCode) {
    clearLossAutofill(form);
    return;
  }

  if (fields.statusEl) {
    fields.statusEl.textContent = 'Looking up investment...';
    fields.statusEl.classList.remove('error', 'success');
  }

  try {
    const response = await fetch(`/api/admin/profit/investment-lookup/${encodeURIComponent(normalizedCode)}`);
    const data = await response.json();

    if (!response.ok) {
      clearLossAutofill(form);
      if (fields.statusEl) {
        fields.statusEl.classList.add('error');
        fields.statusEl.textContent = data.error || 'Investment not found.';
      }
      return;
    }

    lossFormState.set(form, data.investment);
    if (fields.nameInput) fields.nameInput.value = data.investment.investorName || data.investment.partner || '';
    if (fields.amountInput) {
      fields.amountInput.value = `$${Number(data.investment.amount || 0).toFixed(2)}`;
    }
    if (fields.statusEl) {
      fields.statusEl.classList.add('success');
      fields.statusEl.textContent = `Loaded ${data.investment.investmentCode} for ${data.investment.investorName || data.investment.partner}`;
    }
    updateCalculatedLoss(form);
  } catch (error) {
    clearLossAutofill(form);
    if (fields.statusEl) {
      fields.statusEl.classList.add('error');
      fields.statusEl.textContent = 'Unable to load investment details.';
    }
  }
}

function bindInvestmentLossForm(form) {
  if (!form) {
    return;
  }

  const fields = getLossFormElements(form);

  if (fields.codeInput) {
    fields.codeInput.addEventListener('input', () => {
      clearTimeout(profitLookupTimer);
      profitLookupTimer = setTimeout(() => {
        void lookupInvestmentForLossForm(form, fields.codeInput.value);
      }, 400);
    });

    fields.codeInput.addEventListener('blur', () => {
      void lookupInvestmentForLossForm(form, fields.codeInput.value);
    });
  }

  if (fields.saleInput) {
    fields.saleInput.addEventListener('input', () => updateCalculatedLoss(form));
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (fields.messageEl) {
      fields.messageEl.textContent = '';
      fields.messageEl.classList.remove('success', 'error');
    }

    const formData = new FormData(form);
    const payload = {
      investmentCode: formData.get('investmentCode')?.trim(),
      saleAmount: Number(formData.get('saleAmount')) || 0,
      lossAmount: Number(formData.get('lossAmount')) || 0,
      notes: formData.get('notes'),
    };

    if (!payload.investmentCode) {
      if (fields.messageEl) {
        fields.messageEl.classList.add('error');
        fields.messageEl.textContent = 'Investment ID is required.';
      }
      return;
    }

    try {
      const response = await fetch('/api/admin/profit/investment-loss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (!response.ok) {
        if (fields.messageEl) {
          fields.messageEl.classList.add('error');
          fields.messageEl.textContent = data.error || 'Unable to record investment loss.';
        }
        return;
      }

      form.reset();
      clearLossAutofill(form);
      await fetchMembers();
      await fetchSummary();
      await loadInvestments();
      await loadInvestmentProfitHistory();
      await loadProfitHistory();

      const shareSummary = (data.updatedMembers || [])
        .map((member) => `${member.memberName}: -$${Number(member.share || 0).toFixed(2)}`)
        .join(', ');
      const savingsNote = data.saleReturned > 0
        ? ` $${Number(data.saleReturned).toFixed(2)} returned to Total Savings.`
        : '';

      if (fields.messageEl) {
        fields.messageEl.classList.add('success');
        fields.messageEl.textContent = `Loss of $${Number(data.calculatedLoss || 0).toFixed(2)} recorded for ${data.investment?.investmentCode || payload.investmentCode}.${savingsNote} ${shareSummary}`;
      }
    } catch (error) {
      if (fields.messageEl) {
        fields.messageEl.classList.add('error');
        fields.messageEl.textContent = 'Unable to record investment loss.';
      }
    }
  });
}

document.querySelectorAll('.investment-loss-form').forEach((form) => {
  bindInvestmentLossForm(form);
});

let sellProjectState = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function updateSellNetCalculation() {
  const totalEl = document.getElementById('sellTotalInvestment');
  const saleEl = document.getElementById('sellSaleAmount');
  const costsEl = document.getElementById('sellAdditionalCosts');
  const taxEl = document.getElementById('sellTax');
  const netEl = document.getElementById('sellNetProfitLoss');
  if (!netEl) return;

  const totalInvestment = sellProjectState
    ? Number(sellProjectState.totalInvestment || 0)
    : 0;
  const saleAmount = Number(saleEl?.value || 0);
  const costs = Number(costsEl?.value || 0);
  const tax = Number(taxEl?.value || 0);
  const net = Number((saleAmount - totalInvestment - costs - tax).toFixed(2));

  if (!sellProjectState) {
    netEl.value = '';
    return;
  }

  const label = net > 0 ? 'Profit' : net < 0 ? 'Loss' : 'Break even';
  netEl.value = `${label}: $${Math.abs(net).toFixed(2)} (${net >= 0 ? '+' : '-'}$${Math.abs(net).toFixed(2)})`;
  if (totalEl && !totalEl.value.includes('$') && sellProjectState) {
    totalEl.value = `$${totalInvestment.toFixed(2)}`;
  }
}

async function lookupSellProject(code) {
  const statusEl = document.getElementById('sellLookupStatus');
  const linesEl = document.getElementById('sellInvestmentLines');
  const investorEl = document.getElementById('sellInvestorName');
  const projectEl = document.getElementById('sellProjectLabel');
  const totalEl = document.getElementById('sellTotalInvestment');
  const productEl = document.getElementById('sellProductName');
  const normalized = String(code || '').trim();

  sellProjectState = null;
  if (investorEl) investorEl.value = '';
  if (projectEl) projectEl.value = '';
  if (totalEl) totalEl.value = '';
  if (linesEl) linesEl.innerHTML = '';
  updateSellNetCalculation();

  if (!normalized) {
    if (statusEl) statusEl.textContent = 'Enter an Investment ID to auto-load project investments.';
    return;
  }

  if (statusEl) statusEl.textContent = 'Fetching historical investments…';

  try {
    const response = await fetch(`/api/admin/sales/lookup/${encodeURIComponent(normalized)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Lookup failed.');

    sellProjectState = data.project;
    if (investorEl) investorEl.value = data.project.primary?.investorName || '';
    if (projectEl) projectEl.value = data.project.projectLabel || '';
    if (totalEl) totalEl.value = `$${Number(data.project.totalInvestment || 0).toFixed(2)}`;
    if (productEl && !productEl.value) productEl.value = data.project.projectLabel || '';

    const lines = data.project.investments || [];
    if (linesEl) {
      linesEl.innerHTML = lines.length
        ? `<strong>Included investments:</strong> ${lines.map((line) => `${escapeHtml(line.investmentCode)} ($${Number(line.amount || 0).toFixed(2)})`).join(', ')}`
        : '';
    }
    if (statusEl) {
      statusEl.textContent = `Loaded ${lines.length} investment(s). Total invested: $${Number(data.project.totalInvestment || 0).toFixed(2)}.`;
    }
    updateSellNetCalculation();
  } catch (error) {
    if (statusEl) statusEl.textContent = error.message || 'Unable to load project investments.';
  }
}

async function loadSellList() {
  const tbody = document.getElementById('sellListBody');
  const message = document.getElementById('sellListMessage');
  if (!tbody) return;
  if (message) message.textContent = '';

  try {
    const response = await fetch('/api/admin/sales');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load sales.');

    const sales = data.sales || [];
    if (!sales.length) {
      tbody.innerHTML = '<tr><td colspan="9">No sales recorded yet.</td></tr>';
      return;
    }

    tbody.innerHTML = sales.map((sale) => {
      const net = Number(sale.netProfitLoss || 0);
      const netText = `${net >= 0 ? '+' : '-'}$${Math.abs(net).toFixed(2)}`;
      return `
        <tr>
          <td>${escapeHtml(formatInvestmentDate(sale.createdAt))}</td>
          <td>${escapeHtml(sale.saleCode || '')}</td>
          <td>${escapeHtml(sale.productName || sale.projectLabel || '')}</td>
          <td>$${Number(sale.saleAmount || 0).toFixed(2)}</td>
          <td>$${Number(sale.totalInvestment || 0).toFixed(2)}</td>
          <td>$${Number(sale.additionalCosts || 0).toFixed(2)}</td>
          <td>$${Number(sale.tax || 0).toFixed(2)}</td>
          <td>${netText}</td>
          <td>
            <button type="button" class="ghost-btn" data-view-sale="${sale._id}">View</button>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('[data-view-sale]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.viewSale;
        void openPdfPreview(
          `/api/admin/sales/${id}/report.pdf`,
          'Sale Report',
          'Sale Amount, auto-fetched investments, costs, tax, and net profit/loss.'
        );
      });
    });
  } catch (error) {
    tbody.innerHTML = '<tr><td colspan="9">Unable to load sales.</td></tr>';
    if (message) message.textContent = error.message;
  }
}

function bindSellProductForm() {
  const form = document.getElementById('sellProductForm');
  if (!form) return;

  const codeInput = document.getElementById('sellInvestmentCode');
  let debounceTimer = null;

  codeInput?.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void lookupSellProject(codeInput.value);
    }, 400);
  });
  codeInput?.addEventListener('blur', () => {
    void lookupSellProject(codeInput.value);
  });

  ['sellSaleAmount', 'sellAdditionalCosts', 'sellTax'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', updateSellNetCalculation);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const messageEl = document.getElementById('sellProductMessage');
    if (messageEl) messageEl.textContent = '';

    if (!sellProjectState) {
      if (messageEl) messageEl.textContent = 'Load a valid Investment ID before recording the sale.';
      return;
    }

    const payload = {
      investmentCode: document.getElementById('sellInvestmentCode')?.value?.trim(),
      productName: document.getElementById('sellProductName')?.value?.trim(),
      saleAmount: Number(document.getElementById('sellSaleAmount')?.value || 0),
      additionalCosts: Number(document.getElementById('sellAdditionalCosts')?.value || 0),
      tax: Number(document.getElementById('sellTax')?.value || 0),
      notes: document.getElementById('sellNotes')?.value?.trim() || '',
    };

    try {
      const response = await fetch('/api/admin/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to record sale.');

      if (messageEl) {
        const book = data.bookBalance ?? data.bankLedger?.ledger?.bookBalance;
        messageEl.textContent = data.message
          || `Sale ${data.sale?.saleCode || ''} recorded. Net: $${Number(data.sale?.netProfitLoss || 0).toFixed(2)}.`
            + (book != null ? ` Bank book balance now $${Number(book).toFixed(2)}.` : '');
      }
      form.reset();
      sellProjectState = null;
      document.getElementById('sellInvestorName').value = '';
      document.getElementById('sellProjectLabel').value = '';
      document.getElementById('sellTotalInvestment').value = '';
      document.getElementById('sellNetProfitLoss').value = '';
      document.getElementById('sellInvestmentLines').innerHTML = '';
      document.getElementById('sellAdditionalCosts').value = '0';
      document.getElementById('sellTax').value = '0';
      await loadSellList();
      await loadInvestments();
      await fetchSummary();
    } catch (error) {
      if (messageEl) messageEl.textContent = error.message;
    }
  });
}

bindSellProductForm();

function renderMembersDirectory(members = adminMembers, loading = false) {
  if (!membersDirectoryApp) {
    return;
  }

  const routeMemberId = window.location.pathname.match(/^\/members\/([^/]+)$/)?.[1];
  if (loading) {
    membersDirectoryApp.innerHTML = '<div class="member-roster-list">Loading members...</div>';
    return;
  }

  if (routeMemberId) {
    void renderMemberDirectoryDetail(routeMemberId);
    return;
  }

  membersDirectoryApp.innerHTML = `
    <div class="member-profile-shell">
      <section class="member-profile-section">
        <div class="member-profile-section-header">
          <div>
            <p class="member-profile-eyebrow">Directory</p>
            <h3>Members directory</h3>
          </div>
          <span class="member-profile-meta-pill">${members.length} members</span>
        </div>
        <div class="member-roster-list">
          ${members.map((member) => {
            const status = member.status || 'active';
            return `
            <button type="button" class="member-roster-item member-directory-link ${status === 'inactive' ? 'member-roster-inactive' : ''}" data-member-id="${member._id}">
              <img src="${member.profilePicture || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(member.name || 'Member') + '&background=6366f1&color=fff'}" alt="${member.name}" />
              <div>
                <strong>${member.name}</strong>
                <span>${member.email}</span>
                <small>${status === 'inactive' ? 'Inactive' : 'Active'}</small>
              </div>
            </button>
          `;
          }).join('')}
        </div>
      </section>
    </div>
  `;

  membersDirectoryApp.querySelectorAll('.member-directory-link').forEach((button) => {
    button.addEventListener('click', () => {
      const memberId = button.dataset.memberId;
      if (memberId) {
        history.pushState({}, '', `/members/${memberId}`);
        void renderMemberDirectoryDetail(memberId);
      }
    });
  });
}

async function renderMemberDirectoryDetail(memberId) {
  if (!membersDirectoryApp) {
    return;
  }

  membersDirectoryApp.innerHTML = '<div class="member-roster-list">Loading member profile...</div>';

  try {
    const [profileResponse, loansResponse, outstandingResponse, repaymentsResponse] = await Promise.all([
      fetch(`/api/admin/members/${memberId}/profile`),
      fetch(`/api/loans/admin/member/${memberId}`),
      fetch(`/api/loans/admin/member/${memberId}/outstanding`),
      fetch(`/api/loans/admin/member/${memberId}/repayments`),
    ]);
    if (!profileResponse.ok) {
      membersDirectoryApp.innerHTML = '<div class="member-profile-content">Member profile not found.</div>';
      return;
    }

    const data = await profileResponse.json();
    const loansData = loansResponse.ok ? await loansResponse.json() : { loans: [] };
    data.loans = loansData.loans || [];
    data.loanSummary = outstandingResponse.ok ? await outstandingResponse.json() : {};
    const repaymentsData = repaymentsResponse.ok ? await repaymentsResponse.json() : { repayments: [] };
    data.repayments = repaymentsData.repayments || [];
    membersDirectoryApp.innerHTML = buildMemberProfileHtml(data, {
      showBackButton: true,
      formPrefix: 'directory',
    });

    const backButton = document.getElementById('backToMembersDirectory');
    if (backButton) {
      backButton.addEventListener('click', () => {
        history.pushState({}, '', '/admin');
        renderMembersDirectory(adminMembers, false);
      });
    }

    bindMemberProfileInteractions(membersDirectoryApp, memberId, async () => {
      await renderMemberDirectoryDetail(memberId);
    });
  } catch (error) {
    console.error('Unable to load member profile:', error);
    membersDirectoryApp.innerHTML = '<div class="member-profile-content">Unable to load member profile.</div>';
  }
}

window.addEventListener('popstate', () => {
  renderMembersDirectory(adminMembers, false);
});

// Profile Dropdown
profileBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  profileDropdown.classList.toggle('show');
});

document.addEventListener('click', () => {
  profileDropdown.classList.remove('show');
});

// Sidebar Navigation
document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const page = item.getAttribute('data-page');
    navigateToPage(page);
    closeSidebar();
  });
});

if (openAddMemberModalBtn) {
  openAddMemberModalBtn.addEventListener('click', (event) => {
    event.preventDefault();
    window.location.href = '/user-management';
  });
}

if (closeMemberModalBtn) {
  closeMemberModalBtn.addEventListener('click', () => {
    memberModal.classList.add('hidden');
  });
}

if (memberModal) {
  memberModal.addEventListener('click', (event) => {
    if (event.target === memberModal) {
      memberModal.classList.add('hidden');
    }
  });
}

if (closeMemberProfileModalBtn) {
  closeMemberProfileModalBtn.addEventListener('click', () => {
    memberProfileModal.classList.add('hidden');
  });
}

if (memberProfileModal) {
  memberProfileModal.addEventListener('click', (event) => {
    if (event.target === memberProfileModal) {
      memberProfileModal.classList.add('hidden');
    }
  });
}

function navigateToPage(page, sectionId = null) {
  if (typeof canOpenOpsPage === 'function' && !canOpenOpsPage(page)) {
    page = firstAllowedOpsPage();
  }
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.remove('active');
  });
  const activeNav = document.querySelector(`[data-page="${page}"]`);
  if (activeNav) {
    activeNav.classList.add('active');
  }

  document.querySelectorAll('.page-section').forEach((section) => {
    section.classList.toggle('active', section.getAttribute('data-page-section') === page);
  });

  const loanTab = page === 'loans' && ['takers', 'active', 'applications'].includes(sectionId)
    ? sectionId
    : null;
  updatePageContent(page, loanTab);

  if (page !== 'messages') {
    stopChatPolling('admin-page');
  }

  if (loanTab) {
    switchLoanListTab(loanTab);
  } else if (sectionId) {
    window.requestAnimationFrame(() => {
      const target = document.getElementById(sectionId);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        target.classList.add('dashboard-section-highlight');
        window.setTimeout(() => target.classList.remove('dashboard-section-highlight'), 1600);
      }
    });
  }

  const hashPage = (window.location.hash || '').replace(/^#/, '');
  if (hashPage !== page) {
    window.history.replaceState(null, '', `#${page}`);
  }
}

function updatePageContent(page, loanTab = null) {
  const pageTitle = document.getElementById('pageTitle') || document.querySelector('.topbar-left h1');
  const pageNote = document.getElementById('pageNote') || document.querySelector('.topbar-left .topbar-note');

  if (!pageTitle || !pageNote) {
    return;
  }

  switch (page) {
    case 'members':
      pageTitle.textContent = 'Members';
      pageNote.textContent = 'Manage all society members.';
      break;
    case 'deposits':
      pageTitle.textContent = 'Deposits';
      pageNote.textContent = 'View and manage all deposit transactions.';
      break;
    case 'investments':
      pageTitle.textContent = 'Investments';
      pageNote.textContent = 'Manage society investments, investor portfolios, and project manager assignments.';
      void loadInvestments();
      void loadInvestmentFormOptions().then(() => loadInvestorPortfolio()).catch(() => {});
      break;
    case 'profit':
      pageTitle.textContent = 'Profit & Loss';
      pageNote.textContent = 'Record investment profit or loss and distribute results to all members.';
      void loadInvestmentProfitHistory();
      break;
    case 'sales':
      pageTitle.textContent = 'Sell Product / Project';
      pageNote.textContent = 'Record product sales with auto-fetched investment totals and net profit/loss.';
      void loadSellList();
      break;
    case 'payments':
      pageTitle.textContent = 'Payments';
      pageNote.textContent = 'Manage payments and profit distribution.';
      break;
    case 'withdrawals':
      pageTitle.textContent = 'Withdrawals';
      pageNote.textContent = 'Review member withdrawal requests and approvals.';
      break;
    case 'loans':
      pageTitle.textContent = 'Loans';
      pageNote.textContent = 'Review loan takers, active borrowers, and all applications.';
      void loadLoanPortfolioSummary();
      void loadLoanTakers();
      void loadActiveBorrowers();
      void loadLoanApplications();
      void loadLoanRepayments();
      if (loanTab) {
        switchLoanListTab(loanTab);
      }
      break;
    case 'reports':
      pageTitle.textContent = 'Reports';
      pageNote.textContent = 'Click Members, Deposits, or Investments to view detailed lists.';
      void refreshReportData();
      break;
    case 'settings':
      pageTitle.textContent = 'Settings';
      pageNote.textContent = 'Configure system settings.';
      void loadPendingKycDocuments();
      break;
    case 'messages':
      pageTitle.textContent = 'Messages';
      pageNote.textContent = 'Chat directly with members from the inbox.';
      stopChatPolling('admin-page');
      void loadAdminChatInbox(activeAdminChatMemberId);
      break;
    case 'ceo':
      pageTitle.textContent = 'CEO Panel';
      pageNote.textContent = 'Inspect staff directory, opening balances, and operational tools. Account creation is in User Management.';
      void initCeoPanel();
      break;
    case 'investors':
      pageTitle.textContent = 'Investors';
      pageNote.textContent = 'Browse investors and open detailed portfolios.';
      void loadInvestorsModule();
      break;
    case 'project-managers':
      pageTitle.textContent = 'Project Managers';
      pageNote.textContent = 'Browse project managers and open assigned project portfolios.';
      void loadProjectManagersModule();
      break;
    default:
      pageTitle.textContent = 'Dashboard';
      pageNote.textContent = 'Manage your society finances efficiently.';
      void refreshLoanPortfolioData();
      void loadMonthlyContributionDashboard();
      break;
  }
}

function closeSidebar() {
  const sidebar = document.getElementById('appSidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (sidebar) {
    sidebar.classList.remove('open');
  }
  if (backdrop) {
    backdrop.hidden = true;
  }
}

function openSidebar() {
  const sidebar = document.getElementById('appSidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (sidebar) {
    sidebar.classList.add('open');
  }
  if (backdrop) {
    backdrop.hidden = false;
  }
}

function bindSidebarControls() {
  const toggle = document.getElementById('sidebarToggle');
  const backdrop = document.getElementById('sidebarBackdrop');

  if (toggle) {
    toggle.addEventListener('click', () => {
      const sidebar = document.getElementById('appSidebar');
      if (sidebar?.classList.contains('open')) {
        closeSidebar();
      } else {
        openSidebar();
      }
    });
  }

  if (backdrop) {
    backdrop.addEventListener('click', closeSidebar);
  }
}

// Load Admin Profile
async function loadAdminProfile() {
  try {
    const response = await fetch('/api/session');
    const data = await response.json();
    if (!data.user) {
      window.location.href = '/';
      return;
    }

    const role = data.user.role;
    const fullAccess = ['ceo', 'admin'].includes(role);

    // Developer uses User Management only. Staff use /dashboard/* — never this CEO panel.
    if (role === 'developer') {
      window.location.href = '/user-management';
      return;
    }
    if (!fullAccess) {
      window.location.href = data.user.redirectTo || '/';
      return;
    }

    window.adminSessionUser = data.user;

    const roleLabel = role.replace(/_/g, ' ');
    adminName.textContent = data.user.name || (fullAccess ? 'CEO' : roleLabel);
    adminEmail.textContent = data.user.email || '';
    adminInitial.textContent = (data.user.name || 'C')[0].toUpperCase();
    const sidebarAdminName = document.getElementById('sidebarAdminName');
    const sidebarAdminInitial = document.getElementById('sidebarAdminInitial');
    const sidebarRoleLabel = document.querySelector('.sidebar-user-info span');
    if (sidebarAdminName) {
      sidebarAdminName.textContent = data.user.name || (fullAccess ? 'CEO' : 'Staff');
    }
    if (sidebarAdminInitial) {
      sidebarAdminInitial.textContent = (data.user.name || 'C')[0].toUpperCase();
    }
    if (sidebarRoleLabel) {
      sidebarRoleLabel.textContent = fullAccess ? 'CEO Panel' : `${roleLabel} workspace`;
    }

    const eyebrow = document.querySelector('.topbar-eyebrow');
    if (eyebrow) {
      eyebrow.textContent = fullAccess ? 'SocietyHub CEO' : `SocietyHub ${roleLabel}`;
    }

    applyOpsPermissionGate(data.user);
  } catch (error) {
    console.error('Failed to load admin profile:', error);
  }
}

function sessionHasAnyPermission(permissionKeys = []) {
  const user = window.adminSessionUser;
  if (!user) return false;
  if (['ceo', 'admin', 'developer'].includes(user.role)) return true;
  const perms = new Set(user.permissions || []);
  return permissionKeys.some((key) => perms.has(key));
}

function applyOpsPermissionGate(user) {
  const fullAccess = ['ceo', 'admin'].includes(user.role);

  document.querySelectorAll('[data-ceo-only]').forEach((el) => {
    el.classList.toggle('hidden', !fullAccess);
  });
  document.querySelectorAll('[data-developer-nav]').forEach((el) => {
    el.classList.toggle('hidden', !fullAccess);
  });
  document.querySelectorAll('[data-staff-home]').forEach((el) => {
    el.classList.toggle('hidden', el.dataset.staffHome !== user.role);
  });

  if (fullAccess) {
    document.querySelectorAll('[data-requires-permission]').forEach((el) => el.classList.remove('hidden'));
    document.querySelectorAll('.nav-section-label').forEach((el) => el.classList.remove('hidden'));
    return;
  }

  document.querySelectorAll('[data-requires-permission]').forEach((el) => {
    const required = String(el.dataset.requiresPermission || '')
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean);
    const allowed = !required.length || sessionHasAnyPermission(required);
    el.classList.toggle('hidden', !allowed);
  });

  // Hide empty nav section labels (no visible sibling nav items until next label)
  const nav = document.querySelector('.sidebar-nav');
  if (!nav) return;
  const children = [...nav.children];
  children.forEach((child, index) => {
    if (!child.classList.contains('nav-section-label')) return;
    let hasVisibleItem = false;
    for (let i = index + 1; i < children.length; i += 1) {
      const next = children[i];
      if (next.classList.contains('nav-section-label')) break;
      if (next.classList.contains('nav-item') && !next.classList.contains('hidden')) {
        hasVisibleItem = true;
        break;
      }
    }
    child.classList.toggle('hidden', !hasVisibleItem);
  });
}

function firstAllowedOpsPage() {
  const preferred = ['deposits', 'withdrawals', 'members', 'profit', 'reports', 'messages', 'investments', 'loans', 'settings', 'dashboard'];
  for (const page of preferred) {
    const nav = document.querySelector(`.nav-item[data-page="${page}"]:not(.hidden)`);
    if (nav) return page;
  }
  return 'settings';
}

function canOpenOpsPage(page) {
  if (['ceo', 'admin'].includes(window.adminSessionUser?.role)) return true;
  if (page === 'ceo') return false;
  const nav = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (!nav) return true;
  return !nav.classList.contains('hidden');
}

// ===== CEO Panel: create users + permissions =====
let ceoMeta = { roles: [], permissions: [] };
let ceoPanelReady = false;

function escapeCeoHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderCeoPermissions(selectedKeys = []) {
  const grid = document.getElementById('ceoPermissionsGrid');
  if (!grid) return;
  const selected = new Set(selectedKeys);
  grid.innerHTML = (ceoMeta.permissions || []).map((perm) => `
    <label class="permission-item">
      <input type="checkbox" name="ceoPermissions" value="${perm.key}" ${selected.has(perm.key) ? 'checked' : ''} />
      <span>
        <strong>${escapeCeoHtml(perm.label)}</strong>
        <small>${escapeCeoHtml(perm.description)}</small>
      </span>
    </label>
  `).join('');
}

function applyCeoRoleDefaults() {
  const roleSelect = document.getElementById('ceoRoleSelect');
  if (!roleSelect) return;
  const match = (ceoMeta.roles || []).find((item) => item.value === roleSelect.value);
  renderCeoPermissions(match?.defaultPermissions || []);
}

function getCeoSelectedPermissions() {
  return [...document.querySelectorAll('#ceoPermissionsGrid input[name="ceoPermissions"]:checked')]
    .map((el) => el.value);
}

async function loadCeoStaffDirectory() {
  const body = document.getElementById('ceoStaffList');
  const message = document.getElementById('ceoStaffMessage');
  if (!body) return;
  if (message) message.textContent = '';

  try {
    const response = await fetch('/api/ceo/staff');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load staff.');

    const staff = data.staff || [];
    if (!staff.length) {
      body.innerHTML = '<tr><td colspan="5">No staff users yet. Create one above.</td></tr>';
      return;
    }

    body.innerHTML = staff.map((user) => {
      const isInvestor = user.role === 'investor';
      const isPm = user.role === 'project_manager';
      const nameCell = isInvestor
        ? `<a href="/admin/investors/${user._id}" class="table-link" data-open-investor="${user._id}">${escapeCeoHtml(user.name)}</a>`
        : isPm
          ? `<a href="/admin/project-managers/${user._id}" class="table-link" data-open-pm="${user._id}">${escapeCeoHtml(user.name)}</a>`
          : escapeCeoHtml(user.name);

      return `
        <tr class="${isInvestor || isPm ? 'clickable-row' : ''}" ${isInvestor ? `data-open-investor-row="${user._id}"` : ''} ${isPm ? `data-open-pm-row="${user._id}"` : ''}>
          <td>${nameCell}</td>
          <td>${escapeCeoHtml(user.email)}</td>
          <td><span class="badge">${escapeCeoHtml(user.roleLabel || user.role)}</span></td>
          <td>${(user.permissions || []).length} granted</td>
          <td>${escapeCeoHtml(user.status || 'active')}</td>
        </tr>
      `;
    }).join('');

    body.querySelectorAll('[data-open-investor], [data-open-investor-row]').forEach((el) => {
      el.addEventListener('click', (event) => {
        event.preventDefault();
        const id = el.dataset.openInvestor || el.dataset.openInvestorRow;
        if (id) openInvestorDetail(id, { pushUrl: true });
      });
    });
    body.querySelectorAll('[data-open-pm], [data-open-pm-row]').forEach((el) => {
      el.addEventListener('click', (event) => {
        event.preventDefault();
        const id = el.dataset.openPm || el.dataset.openPmRow;
        if (id) openProjectManagerDetail(id, { pushUrl: true });
      });
    });
  } catch (error) {
    body.innerHTML = `<tr><td colspan="5">${escapeCeoHtml(error.message)}</td></tr>`;
  }
}

async function loadInvestorsModule() {
  const body = document.getElementById('investorsModuleList');
  const message = document.getElementById('investorsModuleMessage');
  const listPanel = document.getElementById('investorsListPanel');
  const detailPanel = document.getElementById('investorDetailPanel');
  if (!body) return;

  if (listPanel) listPanel.classList.remove('hidden');
  if (detailPanel) detailPanel.classList.add('hidden');

  try {
    const response = await fetch('/api/admin/investments/investors');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load investors.');

    const investors = data.investors || [];
    if (!investors.length) {
      body.innerHTML = '<tr><td colspan="5">No investors yet. Create them from User Management.</td></tr>';
      return;
    }

    body.innerHTML = investors.map((user) => `
      <tr class="clickable-row" data-open-investor-row="${user._id}" style="cursor:pointer;">
        <td><a href="/admin/investors/${user._id}" class="table-link" data-open-investor="${user._id}">${escapeCeoHtml(user.name)}</a></td>
        <td>${escapeCeoHtml(user.email || '-')}</td>
        <td>${escapeCeoHtml(user.phone || '-')}</td>
        <td>${escapeCeoHtml(user.status || 'active')}</td>
        <td><button type="button" class="secondary-btn" data-open-investor="${user._id}">Open Portfolio</button></td>
      </tr>
    `).join('');

    body.querySelectorAll('[data-open-investor], [data-open-investor-row]').forEach((el) => {
      el.addEventListener('click', (event) => {
        event.preventDefault();
        const id = el.dataset.openInvestor || el.dataset.openInvestorRow;
        if (id) openInvestorDetail(id, { pushUrl: true });
      });
    });
    if (message) message.textContent = '';
  } catch (error) {
    body.innerHTML = `<tr><td colspan="5">${escapeCeoHtml(error.message)}</td></tr>`;
  }
}

async function openInvestorDetail(investorId, { pushUrl = false } = {}) {
  navigateToPage('investors');
  const listPanel = document.getElementById('investorsListPanel');
  const detailPanel = document.getElementById('investorDetailPanel');
  const content = document.getElementById('investorDetailContent');
  if (!content) return;

  if (listPanel) listPanel.classList.add('hidden');
  if (detailPanel) detailPanel.classList.remove('hidden');
  content.innerHTML = '<p class="table-subtitle">Loading investor portfolio…</p>';

  if (pushUrl) {
    window.history.pushState({ investorId }, '', `/admin/investors/${investorId}`);
  }

  try {
    const response = await fetch(`/api/admin/investments/portfolio/${investorId}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load portfolio.');

    const investor = data.investor || {};
    const summary = data.summary || {};
    const byType = data.byType || [];

    content.innerHTML = `
      <h2 style="margin:0 0 0.35rem;">${escapeCeoHtml(investor.name || 'Investor')} · Portfolio</h2>
      <p class="table-subtitle">${escapeCeoHtml(investor.email || '')}${investor.phone ? ` · ${escapeCeoHtml(investor.phone)}` : ''}</p>
      <div class="metrics-grid u-my-1">
        <div class="metric-card"><div class="metric-content"><span class="metric-label">Investments</span><strong class="metric-value">${summary.totalInvestments || 0}</strong></div></div>
        <div class="metric-card"><div class="metric-content"><span class="metric-label">Active Amount</span><strong class="metric-value">$${Number(summary.activeAmount || 0).toFixed(2)}</strong></div></div>
        <div class="metric-card"><div class="metric-content"><span class="metric-label">Sold Amount</span><strong class="metric-value">$${Number(summary.soldAmount || 0).toFixed(2)}</strong></div></div>
        <div class="metric-card"><div class="metric-content"><span class="metric-label">Total Invested</span><strong class="metric-value">$${Number(summary.totalAmount || 0).toFixed(2)}</strong></div></div>
      </div>
      ${byType.length ? byType.map((bucket) => `
        <section class="panel-card" style="margin-top: 0.85rem;">
          <h3 style="margin:0 0 0.35rem;">${escapeCeoHtml(bucket.investmentType)}</h3>
          <p class="table-subtitle">${bucket.count} investment(s) · Total $${Number(bucket.totalAmount || 0).toFixed(2)}</p>
          <div class="table-wrapper">
            <table class="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Amount</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Project Manager</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                ${(bucket.investments || []).map((item) => `
                  <tr>
                    <td><strong>${escapeCeoHtml(item.investmentCode || '-')}</strong></td>
                    <td>$${Number(item.amount || 0).toFixed(2)}</td>
                    <td>${escapeCeoHtml(item.investmentType || '-')}</td>
                    <td>${escapeCeoHtml(item.displayStatus || item.status || '-')}</td>
                    <td>${item.projectManager?._id
                      ? `<a href="/admin/project-managers/${item.projectManager._id}" class="table-link" data-open-pm="${item.projectManager._id}">${escapeCeoHtml(item.projectManager.name)}</a>`
                      : 'Unassigned'}</td>
                    <td>${item.createdAt ? new Date(item.createdAt).toLocaleString() : '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </section>
      `).join('') : '<p class="table-subtitle">No investments yet for this investor.</p>'}
    `;

    content.querySelectorAll('[data-open-pm]').forEach((el) => {
      el.addEventListener('click', (event) => {
        event.preventDefault();
        openProjectManagerDetail(el.dataset.openPm, { pushUrl: true });
      });
    });
  } catch (error) {
    content.innerHTML = `<p class="message">${escapeCeoHtml(error.message)}</p>`;
  }
}

async function loadProjectManagersModule() {
  const body = document.getElementById('projectManagersModuleList');
  const message = document.getElementById('projectManagersModuleMessage');
  const listPanel = document.getElementById('projectManagersListPanel');
  const detailPanel = document.getElementById('projectManagerDetailPanel');
  if (!body) return;

  if (listPanel) listPanel.classList.remove('hidden');
  if (detailPanel) detailPanel.classList.add('hidden');

  try {
    const response = await fetch('/api/admin/investments/project-managers');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load project managers.');

    const managers = data.projectManagers || [];
    if (!managers.length) {
      body.innerHTML = '<tr><td colspan="5">No project managers yet. Create them from User Management.</td></tr>';
      return;
    }

    body.innerHTML = managers.map((user) => `
      <tr class="clickable-row" data-open-pm-row="${user._id}" style="cursor:pointer;">
        <td><a href="/admin/project-managers/${user._id}" class="table-link" data-open-pm="${user._id}">${escapeCeoHtml(user.name)}</a></td>
        <td>${escapeCeoHtml(user.email || '-')}</td>
        <td>${escapeCeoHtml(user.phone || '-')}</td>
        <td>${escapeCeoHtml(user.status || 'active')}</td>
        <td><button type="button" class="secondary-btn" data-open-pm="${user._id}">Open Profile</button></td>
      </tr>
    `).join('');

    body.querySelectorAll('[data-open-pm], [data-open-pm-row]').forEach((el) => {
      el.addEventListener('click', (event) => {
        event.preventDefault();
        const id = el.dataset.openPm || el.dataset.openPmRow;
        if (id) openProjectManagerDetail(id, { pushUrl: true });
      });
    });
    if (message) message.textContent = '';
  } catch (error) {
    body.innerHTML = `<tr><td colspan="5">${escapeCeoHtml(error.message)}</td></tr>`;
  }
}

async function openProjectManagerDetail(managerId, { pushUrl = false } = {}) {
  navigateToPage('project-managers');
  const listPanel = document.getElementById('projectManagersListPanel');
  const detailPanel = document.getElementById('projectManagerDetailPanel');
  const content = document.getElementById('projectManagerDetailContent');
  if (!content) return;

  if (listPanel) listPanel.classList.add('hidden');
  if (detailPanel) detailPanel.classList.remove('hidden');
  content.innerHTML = '<p class="table-subtitle">Loading project manager portfolio…</p>';

  if (pushUrl) {
    window.history.pushState({ managerId }, '', `/admin/project-managers/${managerId}`);
  }

  try {
    const response = await fetch(`/api/admin/investments/project-managers/${managerId}/portfolio`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load portfolio.');

    const manager = data.manager || {};
    const summary = data.summary || {};
    const investments = data.investments || [];

    content.innerHTML = `
      <h2 style="margin:0 0 0.35rem;">${escapeCeoHtml(manager.name || 'Project Manager')} · Management View</h2>
      <p class="table-subtitle">${escapeCeoHtml(manager.email || '')}${manager.phone ? ` · ${escapeCeoHtml(manager.phone)}` : ''}</p>
      <div class="metrics-grid u-my-1">
        <div class="metric-card"><div class="metric-content"><span class="metric-label">Assigned Projects</span><strong class="metric-value">${summary.assignedProjects || 0}</strong></div></div>
        <div class="metric-card"><div class="metric-content"><span class="metric-label">Active Capital</span><strong class="metric-value">$${Number(summary.activeCapital || 0).toFixed(2)}</strong></div></div>
        <div class="metric-card"><div class="metric-content"><span class="metric-label">Profit Returns</span><strong class="metric-value">$${Number(summary.profitReturns || 0).toFixed(2)}</strong></div></div>
        <div class="metric-card"><div class="metric-content"><span class="metric-label">Expenses Managed</span><strong class="metric-value">$${Number(summary.expensesManaged || 0).toFixed(2)}</strong></div></div>
      </div>
      <section class="panel-card" style="margin-top: 0.85rem;">
        <h3 style="margin:0 0 0.5rem;">Assigned Projects</h3>
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Investor</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Profit / Loss</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              ${investments.length ? investments.map((item) => `
                <tr>
                  <td><strong>${escapeCeoHtml(item.investmentCode || '-')}</strong></td>
                  <td>${item.investor?._id
                    ? `<a href="/admin/investors/${item.investor._id}" class="table-link" data-open-investor="${item.investor._id}">${escapeCeoHtml(item.investor.name || item.investorName || '-')}</a>`
                    : escapeCeoHtml(item.investorName || '-')}</td>
                  <td>${escapeCeoHtml(item.investmentType || '-')}</td>
                  <td>$${Number(item.amount || 0).toFixed(2)}</td>
                  <td>${escapeCeoHtml(item.displayStatus || item.status || '-')}</td>
                  <td>${item.status === 'sold' ? `$${Number(item.netProfitLoss || 0).toFixed(2)}` : '-'}</td>
                  <td>${item.createdAt ? new Date(item.createdAt).toLocaleString() : '-'}</td>
                </tr>
              `).join('') : '<tr><td colspan="7">No projects assigned yet.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>
      <p class="table-subtitle" style="margin-top:1rem;">
        Full control: reassign managers from Investments → Edit, review approvals in the Approval Workflow Queue, and complete sales via Profit &amp; Loss.
      </p>
    `;

    content.querySelectorAll('[data-open-investor]').forEach((el) => {
      el.addEventListener('click', (event) => {
        event.preventDefault();
        openInvestorDetail(el.dataset.openInvestor, { pushUrl: true });
      });
    });
  } catch (error) {
    content.innerHTML = `<p class="message">${escapeCeoHtml(error.message)}</p>`;
  }
}

function bindInvestorPmNavigation() {
  document.getElementById('backToInvestorsBtn')?.addEventListener('click', () => {
    window.history.pushState({}, '', '/admin');
    loadInvestorsModule();
  });
  document.getElementById('backToProjectManagersBtn')?.addEventListener('click', () => {
    window.history.pushState({}, '', '/admin');
    loadProjectManagersModule();
  });

  window.addEventListener('popstate', () => {
    handleAdminDeepLink();
  });
}

function handleAdminDeepLink() {
  const path = window.location.pathname;
  const investorMatch = path.match(/^\/admin\/investors\/([a-f\d]{24})$/i);
  const pmMatch = path.match(/^\/admin\/project-managers\/([a-f\d]{24})$/i);

  if (investorMatch) {
    openInvestorDetail(investorMatch[1], { pushUrl: false });
    return true;
  }
  if (pmMatch) {
    openProjectManagerDetail(pmMatch[1], { pushUrl: false });
    return true;
  }
  return false;
}

async function initCeoPanel() {
  try {
    await loadCeoStaffDirectory();
    await initMemberMigrationUi();
  } catch (error) {
    const messageEl = document.getElementById('ceoCreateMessage');
    if (messageEl) messageEl.textContent = error.message;
  }
}

let memberMigrationUiBound = false;

async function populateMigrationMemberSelects() {
  const openingSelect = document.getElementById('openingBalanceMemberSelect');
  const replaceSelect = document.getElementById('replaceDepartingSelect');
  const replaceNewSelect = document.getElementById('replaceNewMemberSelect');
  if (!openingSelect && !replaceSelect && !replaceNewSelect) return;

  try {
    const response = await fetch('/api/admin/members');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load members.');
    const members = (data.members || []).filter((m) => (m.status || 'active') === 'active');
    const options = members.map((m) => (
      `<option value="${m._id}" data-savings="${Number(m.savings || 0)}" data-profit="${Number(m.profit || 0)}" data-open-s="${Number(m.openingSavingsBalance || 0)}" data-open-p="${Number(m.openingProfitBalance || 0)}">${escapeCeoHtml(m.name)} (${escapeCeoHtml(m.email)})</option>`
    )).join('');

    if (openingSelect) {
      openingSelect.innerHTML = `<option value="">Select member…</option>${options}`;
    }
    if (replaceSelect) {
      replaceSelect.innerHTML = `<option value="">Select departing member…</option>${options}`;
    }
    if (replaceNewSelect) {
      replaceNewSelect.innerHTML = `<option value="">Select existing member account…</option>${options}`;
    }
  } catch (error) {
    console.error('Unable to populate migration member selects:', error);
  }
}

async function loadMigrationOverview() {
  const statsEl = document.getElementById('migrationOverviewStats');
  if (!statsEl) return;
  try {
    const response = await fetch('/api/admin/members/migration-overview');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load overview.');
    const t = data.totals || {};
    statsEl.innerHTML = `
      <div class="metric-card"><div class="metric-content"><span class="metric-label">Society Savings</span><strong class="metric-value">$${Number(t.totalSavings || 0).toFixed(2)}</strong></div></div>
      <div class="metric-card"><div class="metric-content"><span class="metric-label">Society Profit</span><strong class="metric-value">$${Number(t.totalProfit || 0).toFixed(2)}</strong></div></div>
      <div class="metric-card"><div class="metric-content"><span class="metric-label">Opening Savings</span><strong class="metric-value">$${Number(t.totalOpeningSavings || 0).toFixed(2)}</strong></div></div>
      <div class="metric-card"><div class="metric-content"><span class="metric-label">Opening Profit</span><strong class="metric-value">$${Number(t.totalOpeningProfit || 0).toFixed(2)}</strong></div></div>
      <div class="metric-card"><div class="metric-content"><span class="metric-label">Migrated Members</span><strong class="metric-value">${t.migratedMemberCount || 0}</strong></div></div>
      <div class="metric-card"><div class="metric-content"><span class="metric-label">Digital Deposits</span><strong class="metric-value">$${Number(t.digitalDepositTotal || 0).toFixed(2)}</strong></div></div>
    `;
  } catch (error) {
    statsEl.innerHTML = `<p class="message">${escapeCeoHtml(error.message)}</p>`;
  }
}

async function loadReplacementValuation(memberId) {
  const box = document.getElementById('replaceValuationBox');
  const entryInput = document.getElementById('replaceEntryAmountInput');
  if (!box) return;
  if (!memberId) {
    box.innerHTML = '<p class="table-subtitle">Select a departing member to load the calculated entry valuation.</p>';
    return;
  }

  try {
    const response = await fetch(`/api/admin/members/entry-valuation?replaceMemberId=${encodeURIComponent(memberId)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to calculate valuation.');
    const v = data.valuation || {};
    const d = v.departing || {};
    box.innerHTML = `
      <p><strong>Exact exit settlement / entry required: $${Number(v.entryAmount || 0).toFixed(2)}</strong></p>
      <p class="table-subtitle">${escapeCeoHtml(v.formula || '')}</p>
      <p class="table-subtitle">Departing: ${escapeCeoHtml(d.name || '')} — Savings $${Number(d.savings || 0).toFixed(2)} + Profit $${Number(d.profit || 0).toFixed(2)} + Advance $${Number(d.advanceBalance || 0).toFixed(2)}</p>
      <p class="table-subtitle">Incoming payment is credited to the bank ledger, then routed as exit settlement to the departing member (works even if prior bank cash was short).</p>
      <p class="table-subtitle">Society fund (all active): Savings $${Number(v.totalSavings || 0).toFixed(2)} · Profit $${Number(v.totalProfit || 0).toFixed(2)} · Advance $${Number(v.totalAdvance || 0).toFixed(2)} · Members ${v.activeCount || 0}</p>
    `;
    if (entryInput) {
      entryInput.value = Number(v.entryAmount || 0).toFixed(2);
      entryInput.readOnly = true;
    }
  } catch (error) {
    box.innerHTML = `<p class="message">${escapeCeoHtml(error.message)}</p>`;
  }
}

async function initMemberMigrationUi() {
  await populateMigrationMemberSelects();
  await loadMigrationOverview();

  if (memberMigrationUiBound) return;
  memberMigrationUiBound = true;

  document.getElementById('openingBalanceMemberSelect')?.addEventListener('change', (event) => {
    const option = event.target.selectedOptions?.[0];
    if (!option) return;
    const openS = document.getElementById('openingSavingsInput');
    const openP = document.getElementById('openingProfitInput');
    if (openS) openS.value = Number(option.dataset.openS || 0).toFixed(2);
    if (openP) openP.value = Number(option.dataset.openP || 0).toFixed(2);
  });

  document.getElementById('replaceDepartingSelect')?.addEventListener('change', (event) => {
    void loadReplacementValuation(event.target.value);
  });

  document.getElementById('openingBalanceForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const msg = document.getElementById('openingBalanceMessage');
    if (msg) msg.textContent = '';
    const formData = new FormData(event.target);
    const memberId = formData.get('memberId');
    try {
      const response = await fetch(`/api/admin/members/${memberId}/opening-balance`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          openingSavings: formData.get('openingSavings'),
          openingProfit: formData.get('openingProfit'),
          notes: formData.get('notes'),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to save opening balances.');
      if (msg) msg.textContent = 'Opening balances saved. Dashboards now include this historical amount.';
      await populateMigrationMemberSelects();
      await loadMigrationOverview();
      await fetchSummary();
      await fetchMembers();
    } catch (error) {
      if (msg) msg.textContent = error.message;
    }
  });

  document.getElementById('memberReplaceForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const msg = document.getElementById('memberReplaceMessage');
    if (msg) msg.textContent = '';
    const formData = new FormData(event.target);
    try {
      const response = await fetch('/api/admin/members/replace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          departingMemberId: formData.get('departingMemberId'),
          newMemberId: formData.get('newMemberId'),
          notes: formData.get('notes'),
          entryAmountPaid: formData.get('entryAmountPaid'),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to replace member.');
      if (msg) {
        const settled = Number(data.departingMember?.settledAmount || data.valuation?.entryAmount || 0).toFixed(2);
        msg.textContent = data.message
          || `Exit settled $${settled} for ${data.departingMember?.name || 'member'}; ${data.newMember?.name || 'successor'} activated.`;
      }
      event.target.reset();
      document.getElementById('replaceValuationBox').innerHTML = '<p class="table-subtitle">Select a departing member to load the calculated entry valuation.</p>';
      await populateMigrationMemberSelects();
      await loadMigrationOverview();
      await loadCeoStaffDirectory();
      await fetchSummary();
      await fetchMembers();
    } catch (error) {
      if (msg) msg.textContent = error.message;
    }
  });
}

// Initialize Donut Chart
function initializeDepositChart(summary = {}) {
  const ctx = document.getElementById('depositChart');
  if (!ctx || typeof Chart === 'undefined') return;

  const depositShare = Number(summary.totalDeposits || 0);
  const savingsShare = Number(summary.totalSavings || 0);
  const profitShare = Number(summary.totalProfit || 0);
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const legendColor = isLight ? '#334155' : '#e2e8f0';

  if (depositChart) {
    depositChart.destroy();
  }

  depositChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Deposits', 'Savings', 'Profit'],
      datasets: [
        {
          data: [depositShare || 1, savingsShare || 1, profitShare || 1],
          backgroundColor: [
            'rgba(99, 102, 241, 0.8)',
            'rgba(20, 184, 166, 0.8)',
            'rgba(245, 158, 11, 0.8)',
          ],
          borderColor: ['#6366f1', '#14b8a6', '#f59e0b'],
          borderWidth: 2,
          borderRadius: 8,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: legendColor,
            padding: 20,
            font: { size: 12, weight: 600 },
          },
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.8)',
          titleColor: '#e2e8f0',
          bodyColor: '#94a3b8',
          borderColor: '#6366f1',
          borderWidth: 1,
          padding: 12,
          displayColors: true,
        },
      },
    },
  });
}

async function fetchSummary() {
  const response = await fetch('/api/admin/summary');
  if (!response.ok) {
    return;
  }
  const data = await response.json();
  lastSummaryData = data;
  monthlyContributionAmount = Number(data.monthlyContributionAmount) > 0
    ? Number(data.monthlyContributionAmount)
    : null;
  applyDepositFormSettings();
  if (totalMembers) {
    totalMembers.textContent = data.totalMembers;
  }
  if (totalDeposits) {
    totalDeposits.textContent = data.totalDeposits;
  }
  if (totalSavings) {
    totalSavings.textContent = `$${Number(data.totalSavings || 0).toFixed(2)}`;
  }
  if (totalProfit) {
    totalProfit.textContent = `$${Number(data.totalProfit || 0).toFixed(2)}`;
  }

  const savingsFootnote = document.querySelector('[data-admin-dashboard-type="savings"] .kpi-footnote');
  if (savingsFootnote && (data.totalOpeningSavings || data.totalOpeningProfit)) {
    savingsFootnote.textContent = `Incl. opening $${Number(data.totalOpeningSavings || 0).toFixed(0)} + digital`;
  }
  const profitFootnote = document.querySelector('[data-admin-dashboard-type="profit"] .kpi-footnote');
  if (profitFootnote && data.totalOpeningProfit) {
    profitFootnote.textContent = `Incl. opening $${Number(data.totalOpeningProfit || 0).toFixed(0)}`;
  }

  const kpiActiveMembers = document.getElementById('kpiActiveMembers');
  if (kpiActiveMembers) {
    kpiActiveMembers.textContent = `${data.activeMembers || data.totalMembers || 0} active`;
  }

  const financeListSavings = document.getElementById('financeListSavings');
  const financeListProfit = document.getElementById('financeListProfit');
  const financeListDeposits = document.getElementById('financeListDeposits');
  const financeListInvestments = document.getElementById('financeListInvestments');
  const snapshotActiveMembers = document.getElementById('snapshotActiveMembers');

  if (financeListSavings) {
    financeListSavings.textContent = `$${Number(data.totalSavings || 0).toFixed(2)}`;
  }
  if (financeListProfit) {
    financeListProfit.textContent = `$${Number(data.totalProfit || 0).toFixed(2)}`;
  }
  if (financeListDeposits) {
    financeListDeposits.textContent = data.totalDeposits || 0;
  }
  if (snapshotActiveMembers) {
    snapshotActiveMembers.textContent = data.activeMembers || data.totalMembers || 0;
  }
  if (financeListInvestments && dashboardTotalInvestment) {
    financeListInvestments.textContent = dashboardTotalInvestment.textContent || '$0';
  }

  if (reportMembers) {
    reportMembers.textContent = data.totalMembers;
  }
  if (reportDeposits) {
    reportDeposits.textContent = data.totalDeposits;
  }

  initializeDepositChart(data);
}

async function loadDashboardSnapshot() {
    const pendingLoansEl = document.getElementById('snapshotPendingLoans');
    const pendingWithdrawalsEl = document.getElementById('snapshotPendingWithdrawals');
  const liveLoansBody = document.getElementById('dashboardLiveLoansBody');

  try {
    const [loansResponse, withdrawalsResponse] = await Promise.all([
      fetch('/api/loans/admin?status=pending'),
      fetch('/api/withdrawals/admin'),
    ]);

    const loansData = loansResponse.ok ? await loansResponse.json() : { loans: [] };
    const withdrawalsData = withdrawalsResponse.ok ? await withdrawalsResponse.json() : { requests: [] };
    const pendingLoans = (loansData.loans || []).filter((loan) => !loan.autoRejected);
    const pendingWithdrawals = (withdrawalsData.requests || []).filter((item) => item.status === 'pending');

    if (pendingLoansEl) {
      pendingLoansEl.textContent = pendingLoans.length;
    }
    if (pendingWithdrawalsEl) {
      pendingWithdrawalsEl.textContent = pendingWithdrawals.length;
    }

    if (liveLoansBody) {
      const recentLoans = pendingLoans.slice(0, 5);
      liveLoansBody.innerHTML = recentLoans.length
        ? recentLoans.map((loan) => `
          <tr>
            <td>${loan.member?.name || 'Unknown'} — ${loan.loanType === 'emergency' ? 'Emergency' : 'General'}</td>
            <td>$${Number(loan.amount || 0).toFixed(2)}</td>
            <td>${formatLoanStatusBadge(loan.status)}</td>
          </tr>
        `).join('')
        : '<tr><td colspan="3">No pending loan requests.</td></tr>';
    }
  } catch (error) {
    if (liveLoansBody) {
      liveLoansBody.innerHTML = '<tr><td colspan="3">Unable to load live snapshot.</td></tr>';
    }
  }
}

function bindDashboardQuickNav() {
  document.querySelectorAll('[data-quick-nav]').forEach((button) => {
    button.addEventListener('click', () => {
      const page = button.dataset.quickNav;
      if (page) {
        navigateToPage(page);
      }
    });
  });
}

function bindDashboardNavList() {
  document.querySelectorAll('[data-dashboard-nav]').forEach((button) => {
    button.addEventListener('click', () => {
      const page = button.dataset.dashboardNav;
      const sectionId = button.dataset.dashboardSection || null;
      if (page) {
        navigateToPage(page, sectionId);
      }
    });
  });
}

function bindDashboardNotes() {
  if (!dashboardNotesInput) {
    return;
  }
  dashboardNotesInput.value = localStorage.getItem('adminDashboardNotes') || '';
  dashboardNotesInput.addEventListener('input', () => {
    localStorage.setItem('adminDashboardNotes', dashboardNotesInput.value);
  });
}

const adminDashboardPageMap = {
  members: 'members',
  deposits: 'deposits',
  savings: 'members',
  profit: 'profit',
  investments: 'investments',
};

function setActiveAdminDashboardCard(reportType) {
  activeAdminDashboardType = reportType;
  document.querySelectorAll('.admin-dashboard-card').forEach((card) => {
    const isActive = card.dataset.adminDashboardType === reportType;
    card.classList.toggle('active', isActive);
    card.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function renderMemberStatusLists(members) {
  const rows = members.length
    ? members.map((member) => `
        <tr>
          <td>${member.name}</td>
          <td>${member.email}</td>
          <td>$${Number(member.savings || 0).toFixed(2)}</td>
          <td>$${Number(member.profit || 0).toFixed(2)}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="4">No members yet. Add members first.</td></tr>';

  if (profitMemberStatusList) {
    profitMemberStatusList.innerHTML = rows;
  }
}

function renderDashboardMembersList(members) {
  if (!dashboardMembersList) {
    return;
  }
  if (!members.length) {
    dashboardMembersList.innerHTML = '<p class="table-subtitle">No members yet. Add members from the Members page.</p>';
    return;
  }

  dashboardMembersList.innerHTML = members.map((member) => {
    const status = member.status || 'active';
    return `
      <button type="button" class="member-roster-item member-profile-link ${status === 'inactive' ? 'member-roster-inactive' : ''}" data-member-id="${member._id}">
        <img src="${member.profilePicture || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(member.name || 'Member') + '&background=6366f1&color=fff'}" alt="${member.name}" />
        <div>
          <strong>${member.name}</strong>
          <span>${member.email}</span>
          <small>Savings $${Number(member.savings || 0).toFixed(2)} · Profit $${Number(member.profit || 0).toFixed(2)}</small>
        </div>
      </button>
    `;
  }).join('');
}

function bindAdminDashboardCards() {
  document.querySelectorAll('.admin-dashboard-card').forEach((card) => {
    card.addEventListener('click', () => {
      const reportType = card.dataset.adminDashboardType;
      if (!reportType) {
        return;
      }
      setActiveAdminDashboardCard(reportType);
      const page = adminDashboardPageMap[reportType];
      if (page) {
        navigateToPage(page);
      }
    });
  });

  document.querySelectorAll('.dashboard-loan-kpi-card').forEach((card) => {
    card.addEventListener('click', () => {
      const tab = card.dataset.loansTabNav || 'applications';
      const monthFilter = card.dataset.loansMonthFilter || '';
      navigateToPage('loans', tab);
      if (monthFilter) {
        window.requestAnimationFrame(() => {
          const filterEl = document.getElementById('loanActiveBorrowerMonthFilter');
          if (filterEl) {
            filterEl.value = monthFilter;
            void loadActiveBorrowers();
          }
        });
      }
    });
  });
}

async function refreshReportData() {
  await Promise.all([
    fetchMembers(),
    fetchDepositHistory(),
    loadInvestments(),
  ]);
}

function setActiveReportCard(reportType) {
  document.querySelectorAll('.report-metric-card').forEach((card) => {
    const isActive = card.dataset.reportType === reportType;
    card.classList.toggle('active', isActive);
    card.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function renderMembersReport() {
  if (!reportDetailHead || !reportDetailBody) {
    return;
  }

  if (reportDetailTitle) {
    reportDetailTitle.textContent = 'Members Report';
  }
  if (reportDetailSubtitle) {
    reportDetailSubtitle.textContent = `${adminMembers.length} registered member${adminMembers.length === 1 ? '' : 's'}`;
  }

  reportDetailHead.innerHTML = `
    <tr>
      <th>Name</th>
      <th>Email</th>
      <th>Savings</th>
      <th>Profit</th>
      <th>Joined</th>
    </tr>
  `;

  if (!adminMembers.length) {
    reportDetailBody.innerHTML = '<tr><td colspan="5">No members found.</td></tr>';
    return;
  }

  reportDetailBody.innerHTML = adminMembers.map((member) => `
    <tr>
      <td>${member.name}</td>
      <td>${member.email}</td>
      <td>$${Number(member.savings || 0).toFixed(2)}</td>
      <td>$${Number(member.profit || 0).toFixed(2)}</td>
      <td>${member.createdAt ? new Date(member.createdAt).toLocaleDateString() : '-'}</td>
    </tr>
  `).join('');
}

function renderDepositsReport() {
  if (!reportDetailHead || !reportDetailBody) {
    return;
  }

  if (reportDetailTitle) {
    reportDetailTitle.textContent = 'Deposits Report';
  }
  if (reportDetailSubtitle) {
    reportDetailSubtitle.textContent = `${adminDeposits.length} deposit record${adminDeposits.length === 1 ? '' : 's'}`;
  }

  reportDetailHead.innerHTML = `
    <tr>
      <th>Member</th>
      <th>Email</th>
      <th>Amount</th>
      <th>Date</th>
      <th>Receipt</th>
    </tr>
  `;

  if (!adminDeposits.length) {
    reportDetailBody.innerHTML = '<tr><td colspan="5">No deposits recorded yet.</td></tr>';
    return;
  }

  reportDetailBody.innerHTML = adminDeposits.map((deposit) => `
    <tr>
      <td>${deposit.member?.name || 'Unknown'}</td>
      <td>${deposit.member?.email || 'Unknown'}</td>
      <td>$${Number(deposit.amount || 0).toFixed(2)}</td>
      <td>${new Date(deposit.createdAt).toLocaleString()}</td>
      <td><a href="/api/admin/deposits/${deposit._id}/receipt" class="receipt-button" target="_blank" rel="noopener">Download</a></td>
    </tr>
  `).join('');
}

function renderInvestmentsReport() {
  if (!reportDetailHead || !reportDetailBody) {
    return;
  }

  const runningCount = societyActiveInvestments.length;
  const soldCount = societySoldInvestments.length;

  if (reportDetailTitle) {
    reportDetailTitle.textContent = 'Investments Report';
  }
  if (reportDetailSubtitle) {
    reportDetailSubtitle.textContent = `${runningCount} running · ${soldCount} sold`;
  }

  reportDetailHead.innerHTML = `
    <tr>
      <th>Status</th>
      <th>Investment ID</th>
      <th>Name</th>
      <th>Date of Birth</th>
      <th>Location</th>
      <th>Amount</th>
      <th>Date</th>
      <th>Profit Due / Outcome</th>
      <th>Receipt</th>
    </tr>
  `;

  if (!societyInvestments.length) {
    reportDetailBody.innerHTML = '<tr><td colspan="9">No investments recorded yet.</td></tr>';
    return;
  }

  const activeRows = societyActiveInvestments.map((investment) => `
    <tr>
      <td>${formatRunningStatusBadge()}</td>
      <td><strong>${investment.investmentCode || '-'}</strong></td>
      <td>${investment.investorName || investment.partner || '-'}</td>
      <td>${formatInvestmentDate(investment.dateOfBirth)}</td>
      <td>${investment.location || investment.sector || '-'}</td>
      <td>$${Number(investment.amount || 0).toFixed(2)}</td>
      <td>${new Date(investment.createdAt).toLocaleString()}</td>
      <td>${formatProfitDueWindow(investment.createdAt)}</td>
      <td><button type="button" class="receipt-button" data-pdf-preview="/api/admin/investments/${investment._id}/receipt">View Receipt</button></td>
    </tr>
  `).join('');

  const soldRows = societySoldInvestments.map((investment) => `
    <tr>
      <td>${formatOutcomeStatusBadge(investment.outcomeType)}</td>
      <td><strong>${investment.investmentCode || '-'}</strong></td>
      <td>${investment.investorName || investment.partner || '-'}</td>
      <td>${formatInvestmentDate(investment.dateOfBirth)}</td>
      <td>${investment.location || investment.sector || '-'}</td>
      <td>$${Number(investment.amount || 0).toFixed(2)}</td>
      <td>${investment.soldAt ? new Date(investment.soldAt).toLocaleString() : new Date(investment.createdAt).toLocaleString()}</td>
      <td>${formatNetProfitLoss(investment.netProfitLoss)}</td>
      <td><button type="button" class="receipt-button" data-pdf-preview="/api/admin/investments/${investment._id}/receipt">View Receipt</button></td>
    </tr>
  `).join('');

  reportDetailBody.innerHTML = `${activeRows}${soldRows}`;
}

async function showReportDetail(reportType) {
  setActiveReportCard(reportType);

  if (reportType === 'members') {
    if (!adminMembers.length) {
      await fetchMembers();
    }
    renderMembersReport();
    return;
  }

  if (reportType === 'deposits') {
    await fetchDepositHistory();
    renderDepositsReport();
    return;
  }

  if (reportType === 'investments') {
    await loadInvestments();
    renderInvestmentsReport();
  }
}

document.querySelectorAll('.report-metric-card').forEach((card) => {
  card.addEventListener('click', () => {
    const reportType = card.dataset.reportType;
    if (reportType) {
      void showReportDetail(reportType);
    }
  });
});

async function fetchMembers() {
  const response = await fetch('/api/admin/members');
  if (!response.ok) {
    return;
  }
  const data = await response.json();
  adminMembers = data.members;
  renderMembers(adminMembers);

  if (reportMembers) {
    reportMembers.textContent = adminMembers.length;
  }

  void fetchDeletedMembers();
}

function renderMembers(members) {
  membersList.innerHTML = members
    .map((member) => {
      const status = member.status || 'active';
      const inactiveClass = status === 'inactive' ? ' member-row-inactive' : '';
      return `
      <tr class="clickable-row${inactiveClass}" data-member-id="${member._id}" data-member-name="${member.name}">
        <td class="member-name-cell">${member.name}</td>
        <td>${member.email}</td>
        <td>${formatMemberStatusBadge(status)}</td>
        <td>$${Number(member.savings || 0).toFixed(2)}</td>
        <td>$${Number(member.profit || 0).toFixed(2)}</td>
        <td><button type="button" class="secondary-btn member-profile-link" data-member-id="${member._id}">View Profile</button></td>
      </tr>
    `;
    })
    .join('');

  if (memberRosterList) {
    memberRosterList.innerHTML = members.map((member) => {
      const status = member.status || 'active';
      return `
      <button type="button" class="member-roster-item member-profile-link ${status === 'inactive' ? 'member-roster-inactive' : ''}" data-member-id="${member._id}">
        <img src="${member.profilePicture || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(member.name || 'Member') + '&background=6366f1&color=fff'}" alt="${member.name}" />
        <div>
          <strong>${member.name}</strong>
          <span>${member.email}</span>
          <small>${status === 'inactive' ? 'Inactive' : 'Active'}</small>
        </div>
      </button>
    `;
    }).join('');
  }

  renderMemberStatusLists(members);
  renderDashboardMembersList(members);

  if (selectedMemberId) {
    selectedMemberId.innerHTML = '<option value="">Choose a member</option>' + members
      .map((member) => `<option value="${member._id}" data-member-name="${member.name}" data-member-email="${member.email}">${member.name} (${member.email})</option>`)
      .join('');
  }

  renderMembersDirectory(members);

  attachMemberClickHandlers();
}

function attachMemberClickHandlers() {
  document.querySelectorAll('.clickable-row').forEach((row) => {
    row.addEventListener('click', () => {
      if (selectedMemberId) {
        selectedMemberId.value = row.dataset.memberId;
      }
      if (selectedMemberName) {
        selectedMemberName.value = row.dataset.memberName;
      }
      navigateToPage('deposits');
      depositAmount?.focus();
      document.querySelectorAll('.clickable-row').forEach((item) => item.classList.remove('selected-row'));
      row.classList.add('selected-row');
    });
  });

  document.querySelectorAll('.member-profile-link').forEach((button) => {
    button.addEventListener('click', async () => {
      const memberId = button.dataset.memberId;
      if (!memberId) {
        return;
      }
      await openMemberProfile(memberId);
    });
  });
}

function buildMonthlyHistoryRows(monthlyHistory) {
  if (!Array.isArray(monthlyHistory) || !monthlyHistory.length) {
    return '<tr><td colspan="3" class="member-empty-state">No deposit history recorded yet.</td></tr>';
  }

  return monthlyHistory.map((item) => `
    <tr>
      <td>${item.label}</td>
      <td><span class="status-badge ${item.status === 'completed' ? 'status-completed' : 'status-pending'}">${item.status}</span></td>
      <td>$${Number(item.amount || 0).toFixed(2)}</td>
    </tr>
  `).join('');
}

function buildProfileDepositForm(memberId, formPrefix = 'profile') {
  return `
    <section class="panel-card">
      <h3>Record Deposit</h3>
      <p class="table-subtitle">এই member-এর জন্য সরাসরি deposit যোগ করুন।</p>
      <form class="deposit-form profile-deposit-form" data-member-id="${memberId}" data-form-prefix="${formPrefix}">
        <div class="form-group">
          <label>
            Amount ($)
            <input type="number" name="amount" min="0.01" step="0.01" placeholder="0.00" required />
          </label>
        </div>
        <button type="submit" class="primary-btn">Add Deposit</button>
        <a class="receipt-button profile-deposit-receipt" target="_blank" hidden>Download Receipt</a>
        <p class="message profile-deposit-message"></p>
      </form>
    </section>
  `;
}

function formatMemberStatusBadge(status = 'active') {
  if (status === 'deleted') {
    return '<span class="status-badge status-fail">Removed</span>';
  }
  if (status === 'inactive') {
    return '<span class="status-badge status-fail">Inactive</span>';
  }
  return '<span class="status-badge status-completed">Active</span>';
}

function formatRefundStatusBadge(status = 'pending') {
  if (status === 'completed') {
    return '<span class="status-badge status-completed">Completed</span>';
  }
  if (status === 'processing') {
    return '<span class="status-badge status-pending">Processing</span>';
  }
  return '<span class="status-badge status-pending">Pending</span>';
}

function buildMemberStatusControl(member = {}) {
  const currentStatus = member.status || 'active';

  return `
    <section class="panel-card member-status-card">
      <div class="member-status-control">
        <div>
          <h3>Member Status</h3>
          <p class="table-subtitle">Status changes (activate / deactivate) are exclusive to User Management.</p>
        </div>
        <div class="member-status-actions">
          ${formatMemberStatusBadge(currentStatus)}
        </div>
      </div>
    </section>
  `;
}

function buildRefundHistoryRows(refunds = []) {
  if (!Array.isArray(refunds) || !refunds.length) {
    return '<tr><td colspan="6" class="member-empty-state">No refund records yet.</td></tr>';
  }

  return refunds.map((refund) => `
    <tr>
      <td>$${Number(refund.amount || 0).toFixed(2)}</td>
      <td>${refund.reason || '-'}</td>
      <td>${formatRefundStatusBadge(refund.status)}</td>
      <td>${refund.adminNote || '-'}</td>
      <td>${new Date(refund.createdAt).toLocaleString()}</td>
      <td>
        ${refund.status === 'pending' ? `<button type="button" class="secondary-btn" data-refund-status="${refund._id}" data-next-status="processing">Start Processing</button>` : ''}
        ${refund.status === 'processing' ? `<button type="button" class="primary-btn" data-refund-status="${refund._id}" data-next-status="completed">Mark Completed</button>` : ''}
        ${refund.status === 'completed' ? '<span class="member-profile-meta-pill">Refunded</span>' : ''}
      </td>
    </tr>
  `).join('');
}

function buildRefundSection(memberId, refunds = [], formPrefix = 'profile') {
  return `
    <section class="panel-card">
      <h3>Record Refund</h3>
      <p class="table-subtitle">Track when deposited savings are returned to this member.</p>
      <form class="profile-refund-form" data-member-id="${memberId}" data-form-prefix="${formPrefix}">
        <div class="form-grid-2">
          <div class="form-group">
            <label>
              Refund Amount ($)
              <input type="number" name="amount" min="0.01" step="0.01" placeholder="0.00" required />
            </label>
          </div>
          <div class="form-group">
            <label>
              Reason
              <input type="text" name="reason" placeholder="Deposit return, membership exit, etc." />
            </label>
          </div>
        </div>
        <button type="submit" class="primary-btn">Record Refund</button>
        <p class="message profile-refund-message"></p>
      </form>
    </section>
    <section class="panel-card">
      <h3>Refund History</h3>
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Amount</th>
              <th>Reason</th>
              <th>Status</th>
              <th>Admin Note</th>
              <th>Date</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody class="profile-refund-history">
            ${buildRefundHistoryRows(refunds)}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function formatPaymentMethodLabel(method = '') {
  const labels = {
    cash: 'Cash',
    bank_transfer: 'Bank Transfer',
    mobile_banking: 'Mobile Banking',
    check: 'Check',
    other: 'Other',
  };
  return labels[method] || method || 'N/A';
}

function buildLoanPaymentMethodOptions(selected = '') {
  const options = [
    ['cash', 'Cash'],
    ['bank_transfer', 'Bank Transfer'],
    ['mobile_banking', 'Mobile Banking'],
    ['check', 'Check'],
    ['other', 'Other'],
  ];
  return options.map(([value, label]) => `
    <option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>
  `).join('');
}

function buildLoanDisbursementDetailsHtml(loan = {}) {
  if (loan.status !== 'disbursed') {
    return '';
  }

  return `
    <section class="panel-card loan-disbursement-details">
      <h3>Loan Transfer Completed</h3>
      <div class="member-profile-meta">
        <span class="member-profile-meta-pill">Amount Sent: $${Number(loan.amount || 0).toFixed(2)}</span>
        <span class="member-profile-meta-pill">Method: ${formatPaymentMethodLabel(loan.paymentMethod)}</span>
        <span class="member-profile-meta-pill">Date: ${loan.disbursedAt ? new Date(loan.disbursedAt).toLocaleString() : '-'}</span>
        ${loan.disbursementReference ? `<span class="member-profile-meta-pill">Ref: ${loan.disbursementReference}</span>` : ''}
        ${loan.disbursedBy ? `<span class="member-profile-meta-pill">By: ${loan.disbursedBy}</span>` : ''}
      </div>
      ${loan.disbursementNote ? `<p class="table-subtitle"><strong>Transfer note:</strong> ${loan.disbursementNote}</p>` : ''}
    </section>
  `;
}

function buildLoanDisbursementFormHtml(loan = {}) {
  if (loan.status !== 'approved') {
    return '';
  }

  return `
    <section class="panel-card loan-disbursement-panel">
      <h3>Transfer Loan Money to Member</h3>
      <p class="table-subtitle">
        After you send <strong>$${Number(loan.amount || 0).toFixed(2)}</strong> to this member (cash, bank, mobile banking, etc.),
        confirm the transfer here. The member will see it on their dashboard immediately.
      </p>
      <form class="loan-disbursement-form add-member-form" data-loan-id="${loan._id}">
        <div class="form-grid-2">
          <div class="form-group">
            <label>
              Transfer Method
              <select name="paymentMethod" required>
                <option value="">Select transfer method</option>
                ${buildLoanPaymentMethodOptions(loan.paymentMethod || '')}
              </select>
            </label>
          </div>
          <div class="form-group">
            <label>
              Transfer Reference
              <input type="text" name="transferReference" placeholder="Bank txn ID, receipt number..." />
            </label>
          </div>
        </div>
        <div class="form-group">
          <label>
            Transfer Note
            <input type="text" name="disbursementNote" placeholder="Cash given at office, bKash sent to 01XXXXXXXX..." />
          </label>
        </div>
        <button type="submit" class="primary-btn">Confirm Transfer & Disburse Loan</button>
        <p class="message loan-disbursement-message"></p>
      </form>
    </section>
  `;
}

function buildLoanDecisionSummary(loan = {}) {
  if (loan.rejectionReason) {
    return loan.rejectionReason;
  }
  if (loan.adminNote) {
    return loan.adminNote;
  }
  if (loan.autoRejected) {
    return 'Auto-rejected (exceeds 80% limit)';
  }
  return '-';
}

function buildMemberLoansSectionHtml(loans = [], memberId = '', loanSummary = {}, repayments = []) {
  const hasOutstanding = Boolean(loanSummary.hasOutstandingLoan);
  const availableToPay = Number(loanSummary.availableToPay || 0);
  const pendingTransferLoans = loans.filter((loan) => loan.status === 'approved');

  const rows = loans.length ? loans.map((loan) => {
    const outstanding = loan.status === 'disbursed'
      ? Number(loan.outstandingBalance ?? Math.max(Number(loan.amount || 0) - Number(loan.totalRepaid || 0), 0))
      : 0;
    return `
    <tr>
      <td>${formatLoanTypeLabel(loan.loanType)}</td>
      <td>$${Number(loan.amount || 0).toFixed(2)}</td>
      <td>${formatLoanStatusBadge(loan.status)}</td>
      <td>${formatLoanClearanceBadge(loan)}</td>
      <td>${loan.status === 'disbursed' ? `$${outstanding.toFixed(2)}` : '-'}</td>
      <td>${loan.status === 'disbursed' ? `$${Number(loan.totalRepaid || 0).toFixed(2)}` : '-'}</td>
      <td>${buildLoanDecisionSummary(loan)}</td>
      <td>${formatPaymentMethodLabel(loan.paymentMethod)}</td>
      <td>${loan.status === 'disbursed'
        ? `$${Number(loan.amount || 0).toFixed(2)} via ${formatPaymentMethodLabel(loan.paymentMethod)}${loan.disbursementReference ? `<br><small>Ref: ${loan.disbursementReference}</small>` : ''}`
        : loan.status === 'approved'
          ? '<span class="status-badge status-pending">Awaiting Transfer</span>'
          : '-'
      }</td>
      <td>
        ${loan.contractPath ? `<a href="/api/loans/admin/${loan._id}/contract" class="receipt-button" target="_blank" rel="noopener">Contract</a>` : '-'}
      </td>
      <td>
        <button type="button" class="secondary-btn" data-loan-review="${loan._id}">Manage</button>
      </td>
    </tr>
  `;
  }).join('') : '<tr><td colspan="11">No loan applications for this member.</td></tr>';

  const repaymentRows = repayments.length ? repayments.map((item) => `
    <tr>
      <td>${new Date(item.createdAt).toLocaleString()}</td>
      <td>${item.repaymentType === 'full' ? 'Full' : 'Installment'}</td>
      <td>$${Number(item.amount || 0).toFixed(2)}</td>
      <td>${formatPaymentMethodLabel(item.paymentMethod)}</td>
      <td>${formatLoanStatusBadge(item.status)}</td>
      <td>${item.adminManual ? 'Admin Manual' : 'Member Request'}</td>
      <td>$${Number(item.balanceAfter || 0).toFixed(2)}</td>
      <td>${item.status === 'approved' && item._id ? `<a href="/api/loans/admin/repayments/${item._id}/receipt" class="receipt-button" target="_blank" rel="noopener">Receipt</a>` : '-'}</td>
    </tr>
  `).join('') : '<tr><td colspan="8">No loan payments recorded yet.</td></tr>';

  return `
    ${buildLoanClearanceStatusHtml(loanSummary)}

    ${pendingTransferLoans.length ? pendingTransferLoans.map((loan) => buildLoanDisbursementFormHtml(loan)).join('') : ''}

    ${loans.filter((loan) => loan.status === 'disbursed').map((loan) => buildLoanDisbursementDetailsHtml(loan)).join('')}

    <section class="panel-card member-loan-processing-card">
      <div class="member-profile-section-header">
        <div>
          <h3>Admin Manual Loan Payment</h3>
          <p class="table-subtitle">When a member returns loan money at the office (cash, bank, etc.), record it here. The system updates their balance and generates a PDF receipt automatically.</p>
        </div>
      </div>
      ${hasOutstanding ? `
        <div class="member-loan-outstanding-grid">
          <article class="profile-finance-card profile-finance-loans">
            <span>Outstanding Balance</span>
            <strong>$${Number(loanSummary.outstandingBalance || 0).toFixed(2)}</strong>
          </article>
          <article class="profile-finance-card profile-finance-deposits">
            <span>Total Repaid</span>
            <strong>$${Number(loanSummary.totalRepaid || 0).toFixed(2)}</strong>
          </article>
          <article class="profile-finance-card profile-finance-profit">
            <span>Available to Pay Now</span>
            <strong>$${availableToPay.toFixed(2)}</strong>
          </article>
        </div>
        <form class="admin-loan-repayment-form add-member-form" data-member-id="${memberId}">
          <div class="form-grid-2">
            <div class="form-group">
              <label>
                Payment Type
                <select name="repaymentType" class="admin-loan-repayment-type">
                  <option value="installment">Installment</option>
                  <option value="full">Full Payment</option>
                </select>
              </label>
            </div>
            <div class="form-group">
              <label>
                Payment Method
                <select name="paymentMethod">
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="mobile_banking">Mobile Banking</option>
                  <option value="check">Check</option>
                  <option value="other">Other</option>
                </select>
              </label>
            </div>
          </div>
          <div class="form-grid-2">
            <div class="form-group">
              <label>
                Amount ($)
                <input type="number" name="amount" class="admin-loan-repayment-amount" min="0.01" max="${availableToPay}" step="0.01" value="${availableToPay.toFixed(2)}" required />
              </label>
            </div>
            <div class="form-group">
              <label>
                Admin Note
                <input type="text" name="adminNote" placeholder="Cash received at office, July installment..." />
              </label>
            </div>
          </div>
          <button type="submit" class="primary-btn">Record Loan Payment</button>
          <p class="message admin-loan-repayment-message"></p>
        </form>
      ` : `
        <div class="member-loan-no-outstanding">
          <p class="table-subtitle">${loanSummary.loanCleared
            ? 'This loan is fully cleared. Payment history and receipts are listed below.'
            : 'No active disbursed loan with outstanding balance. Approve and disburse a loan first.'}</p>
        </div>
      `}
    </section>

    <section class="panel-card table-card-wide">
      <div class="member-profile-section-header">
        <div>
          <h3>Loan Applications</h3>
          <p class="table-subtitle">Review, approve, disburse, and manage contracts from here.</p>
        </div>
      </div>
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Clearance</th>
              <th>Outstanding</th>
              <th>Repaid</th>
              <th>Decision</th>
              <th>Payment</th>
              <th>Transfer</th>
              <th>Contract</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>

    <section class="panel-card table-card-wide">
      <h3>Loan Payment History</h3>
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Amount</th>
              <th>Method</th>
              <th>Status</th>
              <th>Source</th>
              <th>Balance After</th>
              <th>Receipt</th>
            </tr>
          </thead>
          <tbody>${repaymentRows}</tbody>
        </table>
      </div>
    </section>
  `;
}

function formatProfileField(value, fallback = 'Not provided') {
  const trimmed = String(value || '').trim();
  return trimmed || fallback;
}

function formatKycStatusBadge(status = 'pending') {
  const labels = {
    verified: '<span class="status-badge status-completed">KYC Verified</span>',
    submitted: '<span class="status-badge status-pending">KYC Submitted</span>',
    rejected: '<span class="status-badge status-fail">KYC Rejected</span>',
    pending: '<span class="status-badge status-pending">KYC Pending</span>',
  };
  return labels[status] || labels.pending;
}

function computeMemberHealth(data = {}) {
  const completed = Number(data.completedPayments || 0);
  const missed = Number(data.missedPayments || 0);
  const total = completed + missed;
  if (!total) {
    return { label: 'New Member', tone: 'neutral', score: 75 };
  }
  const score = Math.round((completed / total) * 100);
  if (score >= 90) return { label: 'Excellent Standing', tone: 'good', score };
  if (score >= 75) return { label: 'Good Standing', tone: 'ok', score };
  if (score >= 50) return { label: 'Needs Attention', tone: 'warn', score };
  return { label: 'At Risk', tone: 'bad', score };
}

function buildMemberActivityTimeline(data = {}) {
  const events = [];
  (data.deposits || []).forEach((deposit) => {
    events.push({
      type: 'deposit',
      date: deposit.createdAt,
      title: 'Deposit recorded',
      detail: `$${Number(deposit.amount || 0).toFixed(2)} added to savings`,
      icon: '💰',
    });
  });
  (data.refunds || []).forEach((refund) => {
    events.push({
      type: 'refund',
      date: refund.createdAt,
      title: 'Refund update',
      detail: `$${Number(refund.amount || 0).toFixed(2)} · ${refund.status || 'pending'}`,
      icon: '↩️',
    });
  });
  (data.loans || []).forEach((loan) => {
    events.push({
      type: 'loan',
      date: loan.updatedAt || loan.createdAt,
      title: `Loan ${loan.status || 'pending'}`,
      detail: `${formatLoanTypeLabel(loan.loanType)} · $${Number(loan.amount || 0).toFixed(2)}`,
      icon: '🏛️',
    });
  });

  events.sort((a, b) => new Date(b.date) - new Date(a.date));

  if (!events.length) {
    return '<p class="table-subtitle member-empty-state">No recent activity yet.</p>';
  }

  return `
    <div class="profile-timeline">
      ${events.slice(0, 14).map((event) => `
        <article class="profile-timeline-item profile-timeline-${event.type}">
          <div class="profile-timeline-icon" aria-hidden="true">${event.icon}</div>
          <div class="profile-timeline-body">
            <strong>${event.title}</strong>
            <span>${event.detail}</span>
            <small>${new Date(event.date).toLocaleString()}</small>
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

function buildMemberLifecyclePanel(member = {}) {
  const isDeleted = member.status === 'deleted';

  if (isDeleted) {
    return `
      <section class="panel-card member-lifecycle-card member-lifecycle-deleted">
        <div class="member-lifecycle-banner">
          <span class="member-lifecycle-banner-icon" aria-hidden="true">🚪</span>
          <div>
            <h3>Member Soft-Deleted</h3>
            <p class="table-subtitle">Removed ${member.deletedAt ? `on ${new Date(member.deletedAt).toLocaleString()}` : 'recently'}${member.deletedBy ? ` by ${member.deletedBy}` : ''}${member.deletedReason ? ` · ${member.deletedReason}` : ''}</p>
            <p class="table-subtitle">Financial history is preserved. Restore or manage this account only in User Management → All Accounts → Deleted.</p>
          </div>
        </div>
      </section>
    `;
  }

  return `
    <section class="panel-card member-lifecycle-card">
      <div class="member-lifecycle-banner">
        <span class="member-lifecycle-banner-icon" aria-hidden="true">ℹ️</span>
        <div>
          <h3>Account lifecycle</h3>
          <p class="table-subtitle">Soft-delete, restore, deactivate, and password changes are exclusive to User Management. This page is for inspection and operations only.</p>
        </div>
      </div>
    </section>
  `;
}

function buildMemberProfileHtml(data, options = {}) {
  const member = data.member || {};
  const memberId = member._id || '';
  const loans = data.loans || [];
  const isDeleted = member.status === 'deleted';
  const { showBackButton = false, formPrefix = 'profile', activeTab = 'overview' } = options;
  const historyRows = buildMonthlyHistoryRows(data.monthlyHistory);
  const memberStatus = member.status || 'active';
  const health = computeMemberHealth(data);
  const memberCode = memberId ? String(memberId).slice(-6).toUpperCase() : '------';
  const joinedDate = member.createdAt
    ? new Date(member.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : 'Unknown';
  const activeLoans = loans.filter((loan) => ['pending', 'approved', 'disbursed'].includes(loan.status)).length;
  const avatarUrl = member.profilePicture || `https://ui-avatars.com/api/?name=${encodeURIComponent(member.name || 'Member')}&background=6366f1&color=fff&size=128`;

  return `
    <div class="member-profile-shell member-profile-shell-v2">
      <section class="member-profile-hero-v2">
        <div class="member-profile-hero-v2-main">
          <div class="member-profile-avatar-wrap">
            <img src="${avatarUrl}" alt="${member.name || 'Member'}" class="member-profile-avatar" />
            <div class="member-profile-health-ring profile-health-${health.tone}" style="--health-score:${health.score}">
              <span>${health.score}</span>
            </div>
          </div>
          <div class="member-profile-hero-v2-body">
            <div class="member-profile-hero-heading">
              <div>
                <p class="member-profile-eyebrow">Member Profile · ${memberCode}</p>
                <h3>${member.name}</h3>
                <p class="member-profile-subtitle">${member.email}</p>
              </div>
              ${showBackButton ? '<button type="button" class="receipt-button" id="backToMembersDirectory">Back to directory</button>' : ''}
            </div>
            <div class="member-profile-meta">
              ${formatMemberStatusBadge(memberStatus)}
              ${isDeleted ? '<span class="member-profile-meta-pill member-deleted-pill">Left society</span>' : ''}
              ${!isDeleted ? formatKycStatusBadge(member.kycStatus) : ''}
              <span class="member-profile-meta-pill">Joined ${joinedDate}</span>
              ${!isDeleted ? `<span class="member-profile-meta-pill profile-health-pill profile-health-${health.tone}">${health.label}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="member-profile-contact-grid">
          <div><span>Phone</span><strong>${formatProfileField(member.phone)}</strong></div>
          <div><span>Address</span><strong>${formatProfileField(member.address)}</strong></div>
          <div><span>Gender</span><strong>${formatProfileField(member.gender)}</strong></div>
          <div><span>NID</span><strong>${formatProfileField(member.nidNumber)}</strong></div>
        </div>
        <div class="member-profile-quick-actions">
          <button type="button" class="secondary-btn profile-quick-action" data-profile-tab-target="overview">Overview</button>
          <button type="button" class="secondary-btn profile-quick-action" data-profile-tab-target="activity">Activity</button>
          <button type="button" class="secondary-btn profile-quick-action" data-profile-tab-target="loans">Loan Processing (${loans.length})</button>
        <button type="button" class="secondary-btn profile-quick-action" data-profile-tab-target="refunds">Refunds</button>
        <button type="button" class="secondary-btn profile-quick-action" data-profile-tab-target="messages">Messages</button>
      </div>
      </section>

      <div class="member-profile-financial-grid">
        <article class="profile-finance-card profile-finance-savings">
          <span>Current Savings</span>
          <strong>$${Number(member.savings || 0).toFixed(2)}</strong>
          <small>Live balance</small>
        </article>
        <article class="profile-finance-card profile-finance-profit">
          <span>Profit Share</span>
          <strong>$${Number(member.profit || 0).toFixed(2)}</strong>
          <small>Total distributed</small>
        </article>
        <article class="profile-finance-card profile-finance-deposits">
          <span>Total Deposits</span>
          <strong>$${Number(data.totalDeposits || 0).toFixed(2)}</strong>
          <small>${data.completedPayments || 0} completed months</small>
        </article>
        <article class="profile-finance-card profile-finance-loans">
          <span>Active Loans</span>
          <strong>${activeLoans}</strong>
          <small>${loans.length} total applications</small>
        </article>
      </div>

      ${isDeleted ? '' : buildMemberStatusControl(member)}

      <div class="profile-tabs profile-tabs-v2" role="tablist" aria-label="Member profile sections">
        <button type="button" class="profile-tab ${activeTab === 'overview' ? 'active' : ''}" data-profile-tab="overview">Overview</button>
        <button type="button" class="profile-tab ${activeTab === 'activity' ? 'active' : ''}" data-profile-tab="activity">Activity</button>
        <button type="button" class="profile-tab ${activeTab === 'loans' ? 'active' : ''}" data-profile-tab="loans">Loan Processing</button>
        <button type="button" class="profile-tab ${activeTab === 'refunds' ? 'active' : ''}" data-profile-tab="refunds">Refunds</button>
        <button type="button" class="profile-tab ${activeTab === 'messages' ? 'active' : ''}" data-profile-tab="messages">Messages</button>
      </div>

      <div class="profile-tab-panel ${activeTab === 'overview' ? '' : 'hidden'}" data-profile-panel="overview">
        <div class="member-profile-stats member-profile-stats-v2">
          <div class="metric-card metric-card-1">
            <div class="metric-content">
              <span class="metric-label">Completed Payments</span>
              <strong class="metric-value">${data.completedPayments || 0}</strong>
            </div>
          </div>
          <div class="metric-card metric-card-2">
            <div class="metric-content">
              <span class="metric-label">Missed Payments</span>
              <strong class="metric-value">${data.missedPayments || 0}</strong>
            </div>
          </div>
          <div class="metric-card metric-card-3">
            <div class="metric-content">
              <span class="metric-label">Total Refunded</span>
              <strong class="metric-value">$${Number(data.totalRefunded || 0).toFixed(2)}</strong>
            </div>
          </div>
          <div class="metric-card metric-card-4">
            <div class="metric-content">
              <span class="metric-label">Payment Health</span>
              <strong class="metric-value">${health.score}%</strong>
            </div>
          </div>
        </div>
        ${isDeleted ? '' : buildProfileDepositForm(memberId, formPrefix)}
        <section class="panel-card">
          <h3>Monthly Deposit History</h3>
          <div class="table-wrapper">
            <table class="data-table">
              <thead>
                <tr><th>Month</th><th>Status</th><th>Amount</th></tr>
              </thead>
              <tbody>
                ${historyRows}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div class="profile-tab-panel ${activeTab === 'activity' ? '' : 'hidden'}" data-profile-panel="activity">
        <section class="panel-card">
          <div class="member-profile-section-header">
            <div>
              <h3>Recent Activity</h3>
              <p class="table-subtitle">Deposits, refunds, and loan updates in one timeline.</p>
            </div>
          </div>
          ${buildMemberActivityTimeline(data)}
        </section>
      </div>

      <div class="profile-tab-panel ${activeTab === 'loans' ? '' : 'hidden'}" data-profile-panel="loans">
        ${buildMemberLoansSectionHtml(loans, memberId, data.loanSummary || {}, data.repayments || [])}
      </div>

      <div class="profile-tab-panel ${activeTab === 'refunds' ? '' : 'hidden'}" data-profile-panel="refunds">
        ${buildRefundSection(memberId, data.refunds || [], formPrefix)}
      </div>

      <div class="profile-tab-panel ${activeTab === 'messages' ? '' : 'hidden'}" data-profile-panel="messages">
        ${isDeleted ? '<p class="table-subtitle">This member has left the society. Chat history is no longer available here.</p>' : buildMemberChatSectionHtml(memberId, member.name)}
      </div>

      ${buildMemberLifecyclePanel(member)}
    </div>
  `;
}

async function recordMemberDeposit(memberId, amount) {
  const response = await fetch('/api/admin/deposits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memberId, amount }),
  });

  let data = {};
  try {
    data = await response.json();
  } catch (error) {
    data = { error: 'Unexpected server response while saving deposit.' };
  }

  return { ok: response.ok, data };
}

function validateDepositAmount(amount) {
  const numericAmount = Number(amount);
  if (!numericAmount || numericAmount <= 0 || Number.isNaN(numericAmount)) {
    return 'Enter a valid deposit amount.';
  }
  return '';
}

function applyDepositFormSettings() {
  const hint = document.getElementById('depositAmountHint');
  const target = monthlyContributionAmount;

  if (depositAmount) {
    depositAmount.readOnly = false;
    if (target) {
      if (!depositAmount.value) depositAmount.value = target.toFixed(2);
      if (hint) {
        hint.textContent = `This month’s fixed target: $${target.toFixed(2)}. Extra goes to Advance; shortfall stays as unpaid dues.`;
      }
    } else if (hint) {
      hint.textContent = 'No fixed target set for this month yet — full amount credits savings. Configure a month target above.';
    }
  }

  document.querySelectorAll('.profile-deposit-form [name="amount"]').forEach((input) => {
    input.readOnly = false;
    if (target && !input.value) {
      input.value = target.toFixed(2);
    }
  });
}

async function loadMonthlyTargetsUi() {
  const box = document.getElementById('activeMonthTargetBox');
  const body = document.getElementById('monthlyTargetsBody');
  const monthInput = document.getElementById('monthlyTargetMonth');
  if (!box && !body) return;

  try {
    const response = await fetch('/api/admin/monthly-targets');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load monthly targets.');

    const active = data.active || {};
    if (box) {
      if (active.amount != null) {
        box.innerHTML = `
          <p><strong>Active month (${escapeCeoHtml(active.monthLabel || active.yearMonth)}): $${Number(active.amount).toFixed(2)}</strong></p>
          <p class="table-subtitle">Source: ${escapeCeoHtml(active.source || '—')}${active.configured ? '' : ' (env fallback — save a month target to override)'}</p>
        `;
      } else {
        box.innerHTML = '<p class="table-subtitle">No target for the active month. Set one below so deposits can split surplus / dues.</p>';
      }
    }

    if (monthInput && !monthInput.value && active.yearMonth) {
      monthInput.value = active.yearMonth;
    }
    if (document.getElementById('monthlyTargetAmount') && active.amount != null && !document.getElementById('monthlyTargetAmount').value) {
      document.getElementById('monthlyTargetAmount').value = Number(active.amount).toFixed(2);
    }

    const targets = data.targets || [];
    if (body) {
      body.innerHTML = targets.length
        ? targets.map((t) => `
          <tr>
            <td>${escapeCeoHtml(t.monthLabel || t.yearMonth)}</td>
            <td>$${Number(t.amount || 0).toFixed(2)}</td>
            <td>${escapeCeoHtml(t.setBy || '—')}</td>
            <td>${escapeCeoHtml(t.notes || '—')}</td>
          </tr>
        `).join('')
        : '<tr><td colspan="4">No month targets saved yet.</td></tr>';
    }
  } catch (error) {
    if (box) box.innerHTML = `<p class="message">${escapeCeoHtml(error.message)}</p>`;
    if (body) body.innerHTML = `<tr><td colspan="4">${escapeCeoHtml(error.message)}</td></tr>`;
  }
}

function bindMonthlyTargetForm() {
  const form = document.getElementById('monthlyTargetForm');
  if (!form || form.dataset.bound === '1') return;
  form.dataset.bound = '1';

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const msg = document.getElementById('monthlyTargetMessage');
    if (msg) msg.textContent = '';
    const formData = new FormData(form);
    const yearMonth = String(formData.get('yearMonth') || '');
    try {
      const response = await fetch(`/api/admin/monthly-targets/${encodeURIComponent(yearMonth)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: formData.get('amount'),
          notes: formData.get('notes'),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to save target.');
      if (msg) {
        msg.classList.add('success');
        msg.textContent = data.message || 'Month target saved.';
      }
      monthlyContributionAmount = Number(data.target?.amount) > 0 ? Number(data.target.amount) : monthlyContributionAmount;
      applyDepositFormSettings();
      await loadMonthlyTargetsUi();
      await loadMonthlyContributionDashboard();
      await fetchSummary();
    } catch (error) {
      if (msg) {
        msg.classList.remove('success');
        msg.textContent = error.message;
      }
    }
  });
}

function setDepositSubmitting(form, isSubmitting) {
  const submitBtn = form?.querySelector('[type="submit"]');
  if (!submitBtn) {
    return;
  }
  if (isSubmitting) {
    submitBtn.dataset.defaultLabel = submitBtn.dataset.defaultLabel || submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';
    return;
  }
  submitBtn.disabled = false;
  submitBtn.textContent = submitBtn.dataset.defaultLabel || 'Record Deposit';
}

function bindProfileDepositForms(container, onDepositSuccess) {
  if (!container) {
    return;
  }

  applyDepositFormSettings();

  container.querySelectorAll('.profile-deposit-form').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const messageEl = form.querySelector('.profile-deposit-message');
      const receiptLinkEl = form.querySelector('.profile-deposit-receipt');
      const memberId = form.dataset.memberId;
      const amount = Number(form.querySelector('[name="amount"]').value);

      messageEl.textContent = '';
      messageEl.classList.remove('success', 'error');

      if (!memberId) {
        messageEl.classList.add('error');
        messageEl.textContent = 'Member not found.';
        return;
      }

      if (!amount || amount <= 0) {
        messageEl.classList.add('error');
        messageEl.textContent = 'Enter a valid deposit amount.';
        return;
      }

      const amountError = validateDepositAmount(amount);
      if (amountError) {
        messageEl.classList.add('error');
        messageEl.textContent = amountError;
        return;
      }

      try {
        setDepositSubmitting(form, true);
        const { ok, data } = await recordMemberDeposit(memberId, amount);
        if (!ok) {
          if (receiptLinkEl) {
            receiptLinkEl.hidden = true;
          }
          messageEl.classList.add('error');
          messageEl.textContent = data.error || 'Unable to record deposit.';
          return;
        }

        form.reset();
        messageEl.classList.add('success');
        messageEl.textContent = data.emailSent
          ? 'Deposit recorded and receipt email sent.'
          : 'Deposit recorded successfully. Receipt can be downloaded below.';
        if (receiptLinkEl) {
          receiptLinkEl.hidden = false;
          receiptLinkEl.href = `/api/admin/deposits/${data.deposit._id}/receipt`;
        }

        await fetchMembers();
        await fetchSummary();
        await fetchDepositHistory();

        if (onDepositSuccess) {
          await onDepositSuccess();
        }
      } catch (error) {
        if (receiptLinkEl) {
          receiptLinkEl.hidden = true;
        }
        messageEl.classList.add('error');
        messageEl.textContent = 'Unable to record deposit.';
      } finally {
        setDepositSubmitting(form, false);
      }
    });
  });
}

function bindProfileTabs(container, activeTab = 'overview') {
  if (!container) {
    return;
  }

  const tabs = container.querySelectorAll('.profile-tab');
  const panels = container.querySelectorAll('.profile-tab-panel');

  const activateTab = (target) => {
    tabs.forEach((item) => item.classList.toggle('active', item.dataset.profileTab === target));
    panels.forEach((panel) => {
      panel.classList.toggle('hidden', panel.dataset.profilePanel !== target);
    });
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => activateTab(tab.dataset.profileTab));
  });

  container.querySelectorAll('.profile-quick-action').forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.profileTabTarget;
      if (target) {
        activateTab(target);
      }
    });
  });

  activateTab(activeTab);
}

async function updateMemberStatus(memberId, status) {
  const response = await fetch(`/api/admin/members/${memberId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  const data = await response.json();
  return { ok: response.ok, data };
}

function bindMemberStatusToggle(container, onStatusChanged) {
  if (!container) {
    return;
  }

  container.querySelectorAll('[data-member-status-toggle]').forEach((button) => {
    button.addEventListener('click', async () => {
      const memberId = button.dataset.memberStatusToggle;
      const currentStatus = button.dataset.currentStatus || 'active';
      const nextStatus = currentStatus === 'active' ? 'inactive' : 'active';
      const messageEl = container.querySelector('.member-status-message');

      if (messageEl) {
        messageEl.textContent = '';
        messageEl.classList.remove('success', 'error');
      }

      try {
        const { ok, data } = await updateMemberStatus(memberId, nextStatus);
        if (!ok) {
          if (messageEl) {
            messageEl.classList.add('error');
            messageEl.textContent = data.error || 'Unable to update member status.';
          }
          return;
        }

        await fetchMembers();
        if (typeof onStatusChanged === 'function') {
          await onStatusChanged();
        }
      } catch (error) {
        if (messageEl) {
          messageEl.classList.add('error');
          messageEl.textContent = 'Unable to update member status.';
        }
      }
    });
  });
}

function bindProfileRefundForms(container, onRefundChanged) {
  if (!container) {
    return;
  }

  container.querySelectorAll('.profile-refund-form').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const messageEl = form.querySelector('.profile-refund-message');
      const memberId = form.dataset.memberId;
      const formData = new FormData(form);
      const amount = Number(formData.get('amount'));
      const reason = formData.get('reason')?.trim() || '';

      if (messageEl) {
        messageEl.textContent = '';
        messageEl.classList.remove('success', 'error');
      }

      if (!amount || amount <= 0) {
        if (messageEl) {
          messageEl.classList.add('error');
          messageEl.textContent = 'Enter a valid refund amount.';
        }
        return;
      }

      try {
        const response = await fetch(`/api/admin/members/${memberId}/refunds`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount, reason }),
        });
        const data = await response.json();
        if (!response.ok) {
          if (messageEl) {
            messageEl.classList.add('error');
            messageEl.textContent = data.error || 'Unable to record refund.';
          }
          return;
        }

        form.reset();
        if (messageEl) {
          messageEl.classList.add('success');
          messageEl.textContent = 'Refund recorded successfully.';
        }
        if (typeof onRefundChanged === 'function') {
          await onRefundChanged();
        }
      } catch (error) {
        if (messageEl) {
          messageEl.classList.add('error');
          messageEl.textContent = 'Unable to record refund.';
        }
      }
    });
  });

  container.querySelectorAll('[data-refund-status]').forEach((button) => {
    button.addEventListener('click', async () => {
      const refundId = button.dataset.refundStatus;
      const nextStatus = button.dataset.nextStatus;
      if (!refundId || !nextStatus) {
        return;
      }

      try {
        const response = await fetch(`/api/admin/refunds/${refundId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: nextStatus }),
        });
        const data = await response.json();
        if (!response.ok) {
          window.alert(data.error || 'Unable to update refund status.');
          return;
        }
        if (typeof onRefundChanged === 'function') {
          await onRefundChanged();
        }
      } catch (error) {
        window.alert('Unable to update refund status.');
      }
    });
  });
}

function bindProfileLoanProcessing(container, memberId, refreshProfile) {
  if (!container) {
    return;
  }

  const form = container.querySelector('.admin-loan-repayment-form');
  if (!form) {
    return;
  }

  const typeSelect = form.querySelector('.admin-loan-repayment-type');
  const amountInput = form.querySelector('.admin-loan-repayment-amount');
  const messageEl = form.querySelector('.admin-loan-repayment-message');
  const maxAmount = Number(amountInput?.max || 0);

  if (typeSelect && amountInput) {
    typeSelect.addEventListener('change', () => {
      if (typeSelect.value === 'full') {
        amountInput.value = maxAmount.toFixed(2);
        amountInput.readOnly = true;
      } else {
        amountInput.readOnly = false;
      }
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (messageEl) {
      messageEl.textContent = '';
      messageEl.classList.remove('success', 'error');
    }

    const formData = new FormData(form);
    const payload = {
      repaymentType: formData.get('repaymentType') || 'installment',
      paymentMethod: formData.get('paymentMethod') || 'cash',
      amount: Number(formData.get('amount')),
      adminNote: formData.get('adminNote') || '',
    };

    try {
      const response = await fetch(`/api/loans/admin/member/${memberId}/repayments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        if (messageEl) {
          messageEl.classList.add('error');
          messageEl.textContent = data.error || 'Unable to record loan payment.';
        }
        return;
      }

      if (messageEl) {
        messageEl.classList.add('success');
        const remaining = Number(data.summary?.outstandingBalance || 0);
        messageEl.textContent = remaining <= 0
          ? `Payment of $${Number(data.repayment?.amount || payload.amount).toFixed(2)} recorded. Loan is fully cleared.`
          : `Payment of $${Number(data.repayment?.amount || payload.amount).toFixed(2)} recorded. Remaining balance: $${remaining.toFixed(2)}.`;
      }
      form.reset();
      if (typeof refreshProfile === 'function') {
        await refreshProfile();
      }
      await refreshLoanPortfolioData();
    } catch (error) {
      if (messageEl) {
        messageEl.classList.add('error');
        messageEl.textContent = 'Unable to record loan payment.';
      }
    }
  });
}

function bindMemberProfileInteractions(container, memberId, refreshProfile, activeTab = 'overview') {
  bindProfileTabs(container, activeTab);
  bindProfileDepositForms(container, refreshProfile);
  bindMemberStatusToggle(container, refreshProfile);
  bindProfileRefundForms(container, refreshProfile);
  bindMemberLifecycleActions(container, memberId, refreshProfile);
  bindProfileLoanProcessing(container, memberId, refreshProfile);
  bindProfileChat(container, memberId, activeTab);
}

const chatPollTimers = new Map();
let activeAdminChatMemberId = null;
let adminChatReplyTo = null;

function escapeChatHtml(value = '') {
  return window.SocietyChat?.escapeChatHtml(value) || String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatChatTimestamp(value) {
  return window.SocietyChat?.formatChatTimestamp(value) || (value ? new Date(value).toLocaleString() : '');
}

function setAdminReplyTarget(target = null) {
  adminChatReplyTo = target;
  const bar = document.getElementById('adminChatReplyBar');
  const nameEl = document.getElementById('adminChatReplyName');
  const previewEl = document.getElementById('adminChatReplyPreview');
  if (!bar) return;
  if (!target) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');
  if (nameEl) nameEl.textContent = `Reply to ${target.name || 'message'}`;
  if (previewEl) previewEl.textContent = target.preview || '';
}

function renderChatMessages(threadEl, messages = [], viewerRole = 'admin') {
  if (window.SocietyChat) {
    window.SocietyChat.renderChatMessages(threadEl, messages, viewerRole, {
      onReplyClick: setAdminReplyTarget,
    });
    return;
  }
  if (!threadEl) return;
  threadEl.innerHTML = '<p class="table-subtitle chat-empty-state">Chat UI failed to load.</p>';
}

function buildMemberChatSectionHtml(memberId, memberName = 'Member') {
  return `
    <section class="panel-card chat-thread-panel chat-thread-panel-embedded">
      <div class="chat-thread-header">
        <h3>Chat with ${escapeChatHtml(memberName)}</h3>
        <p class="table-subtitle">Send text, images, or documents. Use Reply to keep the thread clear.</p>
      </div>
      <div class="chat-thread" data-chat-thread data-member-id="${memberId}">
        <p class="table-subtitle chat-empty-state">Loading messages...</p>
      </div>
      <form class="chat-compose-form" data-chat-form data-member-id="${memberId}">
        <textarea name="body" rows="3" maxlength="2000" placeholder="Write a message to ${escapeChatHtml(memberName)}..."></textarea>
        <div class="chat-compose-actions">
          <label class="secondary-btn chat-attach-btn">
            Attach
            <input type="file" name="files" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" multiple hidden />
          </label>
          <button type="submit" class="primary-btn">Send Message</button>
        </div>
        <p class="message chat-compose-message"></p>
      </form>
    </section>
  `;
}

function stopChatPolling(key) {
  const timer = chatPollTimers.get(key);
  if (timer) {
    clearInterval(timer);
    chatPollTimers.delete(key);
  }
}

function startChatPolling(key, callback, intervalMs = (window.SocietyChat?.POLL_MS || 2500)) {
  stopChatPolling(key);
  chatPollTimers.set(key, window.setInterval(() => {
    void callback();
  }, intervalMs));
}

async function fetchAdminMemberChat(memberId) {
  const response = await fetch(`/api/admin/chat/members/${memberId}/messages`);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Unable to load chat messages.');
  }
  return data.messages || [];
}

async function sendAdminChatMessage(memberId, { body = '', replyTo = null, files = [] } = {}) {
  const response = await fetch(`/api/admin/chat/members/${memberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, replyTo, files }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Unable to send message.');
  }
  return data.message;
}

async function refreshEmbeddedMemberChat(container, memberId) {
  const thread = container.querySelector(`[data-chat-thread][data-member-id="${memberId}"]`);
  if (!thread) {
    return;
  }
  try {
    const messages = await fetchAdminMemberChat(memberId);
    renderChatMessages(thread, messages, 'admin');
  } catch (error) {
    thread.innerHTML = '<p class="table-subtitle chat-empty-state">Unable to load messages.</p>';
  }
}

function bindProfileChat(container, memberId, activeTab = 'overview') {
  if (!container || !memberId) {
    return;
  }

  const form = container.querySelector(`[data-chat-form][data-member-id="${memberId}"]`);
  const messageEl = form?.querySelector('.chat-compose-message');
  const pollKey = `profile-${memberId}`;

  const activateChat = () => {
    void refreshEmbeddedMemberChat(container, memberId);
    startChatPolling(pollKey, () => refreshEmbeddedMemberChat(container, memberId));
  };

  const deactivateChat = () => {
    stopChatPolling(pollKey);
  };

  container.querySelectorAll('[data-profile-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      if (tab.dataset.profileTab === 'messages') {
        activateChat();
      } else {
        deactivateChat();
      }
    });
  });

  container.querySelectorAll('[data-profile-tab-target="messages"]').forEach((button) => {
    button.addEventListener('click', activateChat);
  });

  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (messageEl) {
        messageEl.textContent = '';
        messageEl.classList.remove('success', 'error');
      }

      const body = form.body?.value?.trim() || '';
      const fileInput = form.querySelector('input[type="file"]');
      try {
        const files = window.SocietyChat
          ? await window.SocietyChat.readFilesAsPayload(fileInput?.files || [])
          : [];
        if (!body && !files.length) {
          if (messageEl) {
            messageEl.classList.add('error');
            messageEl.textContent = 'Add a message or attachment.';
          }
          return;
        }
        await sendAdminChatMessage(memberId, { body, files });
        form.reset();
        await refreshEmbeddedMemberChat(container, memberId);
        if (messageEl) {
          messageEl.classList.add('success');
          messageEl.textContent = 'Message sent.';
        }
      } catch (error) {
        if (messageEl) {
          messageEl.classList.add('error');
          messageEl.textContent = error.message || 'Unable to send message.';
        }
      }
    });
  }

  if (activeTab === 'messages') {
    activateChat();
  }
}

async function loadAdminChatInbox(selectedMemberId = activeAdminChatMemberId) {
  const list = document.getElementById('adminChatInboxList');
  if (!list) {
    return;
  }

  try {
    const response = await fetch('/api/admin/chat/inbox');
    const data = await response.json();
    const inbox = data.inbox || [];

    if (!inbox.length) {
      list.innerHTML = '<p class="table-subtitle">No conversations yet. Open a member profile or wait for a member message.</p>';
      return;
    }

    list.innerHTML = inbox.map((entry) => {
      const member = entry.member || {};
      const last = entry.lastMessage || {};
      const preview = window.SocietyChat?.lastMessagePreview(last) || last.body || 'No messages yet';
      const isActive = selectedMemberId && String(selectedMemberId) === String(entry.memberId);
      return `
        <button type="button" class="chat-inbox-item ${isActive ? 'active' : ''}" data-chat-inbox-member="${entry.memberId}">
          <div class="chat-inbox-item-head">
            <strong>${escapeChatHtml(member.name || 'Member')}</strong>
            ${entry.unreadCount ? `<span class="chat-unread-badge">${entry.unreadCount}</span>` : ''}
          </div>
          <p class="chat-inbox-preview">${escapeChatHtml(preview)}</p>
          <small>${formatChatTimestamp(last.createdAt)}</small>
        </button>
      `;
    }).join('');
  } catch (error) {
    list.innerHTML = '<p class="table-subtitle">Unable to load inbox.</p>';
  }
}

async function openAdminChatConversation(memberId, memberName = 'Member') {
  activeAdminChatMemberId = memberId;
  setAdminReplyTarget(null);
  const header = document.getElementById('adminChatThreadHeader');
  const thread = document.getElementById('adminChatThread');
  const form = document.getElementById('adminChatComposeForm');

  if (header) {
    header.innerHTML = `
      <h3>${escapeChatHtml(memberName)}</h3>
      <p class="table-subtitle">Direct chat with this member · live updates</p>
    `;
  }
  if (form) {
    form.classList.remove('hidden');
    form.dataset.memberId = memberId;
  }

  await loadAdminChatInbox(memberId);

  try {
    const messages = await fetchAdminMemberChat(memberId);
    renderChatMessages(thread, messages, 'admin');
  } catch (error) {
    if (thread) {
      thread.innerHTML = '<p class="table-subtitle chat-empty-state">Unable to load messages.</p>';
    }
  }

  startChatPolling('admin-page', async () => {
    if (!activeAdminChatMemberId) {
      return;
    }
    const messages = await fetchAdminMemberChat(activeAdminChatMemberId);
    renderChatMessages(document.getElementById('adminChatThread'), messages, 'admin');
    await loadAdminChatInbox(activeAdminChatMemberId);
  });
}

function bindAdminMessagesPage() {
  const inboxList = document.getElementById('adminChatInboxList');
  const composeForm = document.getElementById('adminChatComposeForm');
  const refreshBtn = document.getElementById('refreshAdminChatInboxBtn');

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      void loadAdminChatInbox(activeAdminChatMemberId);
    });
  }

  if (inboxList) {
    inboxList.addEventListener('click', async (event) => {
      const item = event.target.closest('[data-chat-inbox-member]');
      if (!item) {
        return;
      }
      const memberId = item.dataset.chatInboxMember;
      const memberName = item.querySelector('strong')?.textContent || 'Member';
      await openAdminChatConversation(memberId, memberName);
    });
  }

  if (composeForm) {
    const filesInput = document.getElementById('adminChatFiles');
    const fileLabel = document.getElementById('adminChatFileLabel');
    document.getElementById('adminChatReplyClear')?.addEventListener('click', () => setAdminReplyTarget(null));
    filesInput?.addEventListener('change', () => {
      const count = filesInput.files?.length || 0;
      if (fileLabel) fileLabel.textContent = count ? `${count} file(s) selected` : '';
    });

    composeForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const memberId = composeForm.dataset.memberId || activeAdminChatMemberId;
      const messageEl = composeForm.querySelector('.chat-compose-message');
      const body = composeForm.body?.value?.trim() || '';

      if (!memberId) {
        return;
      }

      if (messageEl) {
        messageEl.textContent = '';
        messageEl.classList.remove('success', 'error');
      }

      try {
        const files = window.SocietyChat
          ? await window.SocietyChat.readFilesAsPayload(filesInput?.files || [])
          : [];
        if (!body && !files.length) {
          if (messageEl) {
            messageEl.classList.add('error');
            messageEl.textContent = 'Add a message or attachment.';
          }
          return;
        }
        await sendAdminChatMessage(memberId, {
          body,
          replyTo: adminChatReplyTo?.id || null,
          files,
        });
        composeForm.reset();
        if (fileLabel) fileLabel.textContent = '';
        setAdminReplyTarget(null);
        await openAdminChatConversation(memberId, document.getElementById('adminChatThreadHeader')?.querySelector('h3')?.textContent || 'Member');
        if (messageEl) {
          messageEl.classList.add('success');
          messageEl.textContent = 'Message sent.';
        }
      } catch (error) {
        if (messageEl) {
          messageEl.classList.add('error');
          messageEl.textContent = error.message || 'Unable to send message.';
        }
      }
    });
  }
}

async function removeMemberToDeletedList(memberId, reason, messageEl, onSuccess) {
  try {
    const response = await fetch(`/api/admin/members/${memberId}/remove`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    const data = await response.json();
    if (!response.ok) {
      if (messageEl) {
        messageEl.classList.add('error');
        messageEl.textContent = data.error || 'Unable to remove member.';
      }
      return;
    }
    if (messageEl) {
      messageEl.classList.add('success');
      messageEl.textContent = data.message || 'Member moved to deleted list.';
    }
    await fetchMembers();
    await fetchDeletedMembers();
    if (memberProfileModal) {
      memberProfileModal.classList.add('hidden');
    }
    if (typeof onSuccess === 'function') {
      await onSuccess();
    }
  } catch (error) {
    if (messageEl) {
      messageEl.classList.add('error');
      messageEl.textContent = 'Unable to remove member.';
    }
  }
}

async function restoreDeletedMember(memberId, messageEl, onSuccess) {
  try {
    const response = await fetch(`/api/admin/members/${memberId}/restore`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.json();
    if (!response.ok) {
      if (messageEl) {
        messageEl.classList.add('error');
        messageEl.textContent = data.error || 'Unable to restore member.';
      }
      return;
    }
    if (messageEl) {
      messageEl.classList.add('success');
      messageEl.textContent = data.message || 'Member restored successfully.';
    }
    await fetchMembers();
    await fetchDeletedMembers();
    if (typeof onSuccess === 'function') {
      await onSuccess();
    }
  } catch (error) {
    if (messageEl) {
      messageEl.classList.add('error');
      messageEl.textContent = 'Unable to restore member.';
    }
  }
}

async function permanentlyDeleteMember(_memberId, _confirmName, messageEl) {
  if (messageEl) {
    messageEl.classList.add('error');
    messageEl.textContent = 'Hard delete is disabled. Soft-deleted accounts stay in the database and can be restored from User Management.';
  }
}

function bindMemberLifecycleActions(container, memberId, refreshProfile) {
  if (!container) {
    return;
  }

  const messageEl = container.querySelector('.member-lifecycle-message');
  const removeBtn = container.querySelector('.member-remove-btn');
  const restoreBtn = container.querySelector('.member-restore-btn');
  const permanentBtn = container.querySelector('.member-permanent-delete-btn');
  const confirmWrap = container.querySelector('.member-permanent-delete-confirm');
  const confirmInput = container.querySelector('.member-permanent-delete-input');
  const confirmBtn = container.querySelector('.member-permanent-delete-confirm-btn');
  const cancelBtn = container.querySelector('.member-permanent-delete-cancel');
  const reasonInput = container.querySelector('.member-remove-reason');

  if (removeBtn) {
    removeBtn.addEventListener('click', async () => {
      const memberName = removeBtn.dataset.memberName || 'this member';
      const confirmed = window.confirm(`Move ${memberName} to the deleted list? Their financial records will stay saved.`);
      if (!confirmed) {
        return;
      }
      await removeMemberToDeletedList(
        removeBtn.dataset.memberId || memberId,
        reasonInput?.value || '',
        messageEl,
        refreshProfile
      );
    });
  }

  if (restoreBtn) {
    restoreBtn.addEventListener('click', async () => {
      const confirmed = window.confirm('Restore this member to the active list?');
      if (!confirmed) {
        return;
      }
      await restoreDeletedMember(restoreBtn.dataset.memberId || memberId, messageEl, refreshProfile);
    });
  }

  if (permanentBtn && confirmWrap) {
    if (window.adminSessionUser?.role !== 'developer') {
      permanentBtn.classList.add('hidden');
      confirmWrap.classList.add('hidden');
    } else {
      permanentBtn.addEventListener('click', () => {
        confirmWrap.classList.remove('hidden');
        if (confirmInput) {
          confirmInput.value = '';
          confirmInput.focus();
        }
      });
    }
  }

  if (cancelBtn && confirmWrap) {
    cancelBtn.addEventListener('click', () => {
      confirmWrap.classList.add('hidden');
      if (confirmInput) {
        confirmInput.value = '';
      }
    });
  }

  if (confirmBtn) {
    confirmBtn.addEventListener('click', async () => {
      await permanentlyDeleteMember(
        confirmBtn.dataset.memberId || memberId,
        confirmInput?.value || '',
        messageEl,
        refreshProfile
      );
    });
  }
}

function bindDeletedMemberRowActions() {
  document.querySelectorAll('.deleted-member-view').forEach((button) => {
    button.addEventListener('click', async () => {
      await openMemberProfile(button.dataset.memberId);
    });
  });

  document.querySelectorAll('.deleted-member-restore').forEach((button) => {
    button.addEventListener('click', async () => {
      const confirmed = window.confirm('Restore this member to the active list?');
      if (!confirmed) {
        return;
      }
      await restoreDeletedMember(button.dataset.memberId, null, async () => {
        switchMemberListTab('active');
      });
    });
  });

  document.querySelectorAll('.deleted-member-permanent').forEach((button) => {
    button.addEventListener('click', async () => {
      const memberName = button.dataset.memberName || '';
      const confirmName = window.prompt(`Type "${memberName}" to permanently delete this account:`);
      if (!confirmName) {
        return;
      }
      await permanentlyDeleteMember(button.dataset.memberId, confirmName, null, null);
    });
  });
}

function switchMemberListTab(tab = 'active') {
  document.querySelectorAll('[data-member-list-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.memberListTab === tab);
  });
  const activePanel = document.getElementById('activeMembersPanel');
  const deletedPanel = document.getElementById('deletedMembersPanel');
  if (activePanel) {
    activePanel.classList.toggle('hidden', tab !== 'active');
  }
  if (deletedPanel) {
    deletedPanel.classList.toggle('hidden', tab !== 'deleted');
  }
  if (tab === 'deleted') {
    void fetchDeletedMembers();
  }
}

function bindMemberListTabs() {
  document.querySelectorAll('[data-member-list-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      switchMemberListTab(button.dataset.memberListTab || 'active');
    });
  });
}

function renderDeletedMembers(members = adminDeletedMembers) {
  const list = document.getElementById('deletedMembersList');
  const badge = document.getElementById('deletedMembersCountBadge');
  if (badge) {
    badge.textContent = members.length;
  }
  if (!list) {
    return;
  }
  if (!members.length) {
    list.innerHTML = '<tr><td colspan="7">No deleted members yet.</td></tr>';
    return;
  }

  list.innerHTML = members.map((member) => `
    <tr class="member-row-deleted">
      <td class="member-name-cell">${member.name}</td>
      <td>${member.email}</td>
      <td>${member.deletedAt ? new Date(member.deletedAt).toLocaleString() : '-'}</td>
      <td>${member.deletedReason || '-'}</td>
      <td>$${Number(member.savings || 0).toFixed(2)}</td>
      <td>$${Number(member.profit || 0).toFixed(2)}</td>
      <td class="member-lifecycle-table-actions">
        <button type="button" class="receipt-button deleted-member-view" data-member-id="${member._id}">View</button>
      </td>
    </tr>
  `).join('');

  bindDeletedMemberRowActions();
}

async function fetchDeletedMembers() {
  try {
    const response = await fetch('/api/admin/members/deleted/list');
    if (!response.ok) {
      renderDeletedMembers([]);
      return;
    }
    const data = await response.json();
    adminDeletedMembers = data.members || [];
    renderDeletedMembers(adminDeletedMembers);
  } catch (error) {
    renderDeletedMembers([]);
  }
}

async function openMemberProfile(memberId, options = {}) {
  try {
    const [profileResponse, loansResponse, outstandingResponse, repaymentsResponse] = await Promise.all([
      fetch(`/api/admin/members/${memberId}/profile`),
      fetch(`/api/loans/admin/member/${memberId}`),
      fetch(`/api/loans/admin/member/${memberId}/outstanding`),
      fetch(`/api/loans/admin/member/${memberId}/repayments`),
    ]);
    if (!profileResponse.ok) {
      return;
    }
    const data = await profileResponse.json();
    const loansData = loansResponse.ok ? await loansResponse.json() : { loans: [] };
    data.loans = loansData.loans || [];
    data.loanSummary = outstandingResponse.ok ? await outstandingResponse.json() : {};
    const repaymentsData = repaymentsResponse.ok ? await repaymentsResponse.json() : { repayments: [] };
    data.repayments = repaymentsData.repayments || [];
    if (memberProfileModal) {
      memberProfileModal.classList.remove('hidden');
    }
    if (memberProfileContent) {
      memberProfileContent.innerHTML = buildMemberProfileHtml(data, {
        showBackButton: false,
        formPrefix: 'modal',
        activeTab: options.activeTab || 'overview',
      });
      bindMemberProfileInteractions(memberProfileContent, memberId, async () => {
        await openMemberProfile(memberId, options);
      }, options.activeTab || 'overview');
    }
  } catch (error) {
    console.error('Unable to open member profile:', error);
  }
}

async function openMemberLoanHub(memberId) {
  await openMemberProfile(memberId, { activeTab: 'loans' });
}

async function fetchDepositHistory() {
  const response = await fetch('/api/admin/deposits');
  if (!response.ok) {
    return;
  }
  const data = await response.json();
  adminDeposits = data.deposits || [];
  if (depositHistory) {
    depositHistory.innerHTML = adminDeposits
      .map((deposit) => {
        const typeLabel = deposit.type === 'opening_balance'
          ? 'Opening'
          : deposit.type === 'replacement_entry'
            ? 'Replacement'
            : 'Regular';
        return `
      <tr>
        <td>${deposit.member?.name || 'Unknown'}</td>
        <td>${deposit.member?.email || 'Unknown'}</td>
        <td>$${Number(deposit.amount || 0).toFixed(2)} <span class="kpi-footnote">(${typeLabel})</span></td>
        <td>${new Date(deposit.createdAt).toLocaleString()}</td>
        <td><a href="/api/admin/deposits/${deposit._id}/receipt" class="receipt-button" target="_blank">Download</a></td>
      </tr>
    `;
      })
      .join('');
  }

  if (reportDeposits) {
    reportDeposits.textContent = adminDeposits.length;
  }
}

if (adminDepositForm) {
  adminDepositForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (depositMessage) {
      depositMessage.textContent = '';
      depositMessage.classList.remove('success', 'error');
    }

    const payload = {
      memberId: selectedMemberId?.value || '',
      amount: Number(depositAmount?.value),
    };

    if (!payload.memberId) {
      depositMessage?.classList.add('error');
      if (depositMessage) depositMessage.textContent = 'Please choose a member first.';
      return;
    }

    const amountError = validateDepositAmount(payload.amount);
    if (amountError) {
      depositMessage?.classList.add('error');
      if (depositMessage) depositMessage.textContent = amountError;
      return;
    }

    try {
      setDepositSubmitting(adminDepositForm, true);
      const { ok, data } = await recordMemberDeposit(payload.memberId, payload.amount);
      if (!ok) {
        if (latestReceiptLink) latestReceiptLink.hidden = true;
        depositMessage?.classList.add('error');
        if (depositMessage) depositMessage.textContent = data.error || 'Unable to record deposit.';
        return;
      }

      depositMessage?.classList.add('success');
      if (depositMessage) {
        const base = data.message
          || (data.monthlySplit?.splitApplied
            ? `Toward target $${Number(data.monthlySplit.towardTarget).toFixed(2)}${data.monthlySplit.surplus > 0 ? ` · surplus $${Number(data.monthlySplit.surplus).toFixed(2)} → advance` : ''}${data.monthlySplit.remainingUnpaid > 0 ? ` · still due $${Number(data.monthlySplit.remainingUnpaid).toFixed(2)}` : ''}`
            : 'Deposit recorded successfully. Receipt can be downloaded below.');
        const book = data.bookBalance ?? data.bankLedger?.ledger?.bookBalance;
        depositMessage.textContent = book != null
          ? `${base}${String(base).includes('book balance') ? '' : ` · Bank book balance now $${Number(book).toFixed(2)}`}`
          : base;
      }
      if (latestReceiptLink) {
        latestReceiptLink.hidden = false;
        latestReceiptLink.href = `/api/admin/deposits/${data.deposit._id}/receipt`;
      }
      adminDepositForm.reset();
      applyDepositFormSettings();
      if (selectedMemberName) {
        selectedMemberName.value = '';
      }
      if (selectedMemberId) {
        selectedMemberId.value = '';
      }
      await fetchMembers();
      await fetchSummary();
      await fetchDepositHistory();
      await loadMonthlyContributionDashboard();
    } catch (error) {
      if (latestReceiptLink) latestReceiptLink.hidden = true;
      depositMessage?.classList.add('error');
      if (depositMessage) depositMessage.textContent = 'Unable to record deposit.';
    } finally {
      setDepositSubmitting(adminDepositForm, false);
    }
  });
}

if (memberSearch) {
  memberSearch.addEventListener('input', () => {
  const term = memberSearch.value.toLowerCase().trim();
  const visiblePage = document.querySelector('.page-section.active')?.getAttribute('data-page-section');

  const filteredMembers = adminMembers.filter((member) => {
    const haystack = `${member.name || ''} ${member.email || ''}`.toLowerCase();
    return haystack.includes(term);
  });

  if (term && searchMemberDetails) {
    if (filteredMembers.length) {
      searchMemberDetails.innerHTML = filteredMembers.slice(0, 5).map((member) => `
        <button type="button" class="search-member-link" data-member-id="${member._id}">
          <strong>${member.name}</strong>
          <span>${member.email}</span>
          <span class="search-member-meta">Savings: $${Number(member.savings || 0).toFixed(2)}</span>
          <span class="search-member-meta">Profit: $${Number(member.profit || 0).toFixed(2)}</span>
        </button>
      `).join('');
      searchMemberDetails.classList.remove('hidden');
    } else {
      searchMemberDetails.innerHTML = '<div class="search-empty">No members found.</div>';
      searchMemberDetails.classList.remove('hidden');
    }
  } else if (searchMemberDetails) {
    searchMemberDetails.innerHTML = '';
    searchMemberDetails.classList.add('hidden');
  }

  if (visiblePage === 'members' || !visiblePage) {
    renderMembers(filteredMembers);
    if (!term) {
      if (selectedMemberId) {
        selectedMemberId.value = '';
      }
      if (selectedMemberName) {
        selectedMemberName.value = '';
      }
    }
    return;
  }

  if (visiblePage === 'deposits' && depositHistory) {
    const rows = Array.from(depositHistory.querySelectorAll('tr'));
    rows.forEach((row) => {
      const haystack = row.textContent.toLowerCase();
      row.style.display = haystack.includes(term) ? '' : 'none';
    });
  }

  if (visiblePage === 'withdrawals' && withdrawalRequestsList) {
    const rows = Array.from(withdrawalRequestsList.querySelectorAll('tr'));
    rows.forEach((row) => {
      const haystack = row.textContent.toLowerCase();
      row.style.display = haystack.includes(term) ? '' : 'none';
    });
  }
  });
}

if (newMemberForm) {
  newMemberForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  adminMessage.textContent = '';
  adminMessage.classList.remove('success', 'error');

  const formData = new FormData(newMemberForm);
  const payload = {
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
    dateOfBirth: formData.get('dateOfBirth'),
    gender: formData.get('gender'),
    phone: formData.get('phone'),
    address: formData.get('address'),
    nidNumber: formData.get('nidNumber'),
  };

  const profilePictureFile = formData.get('profilePicture');
  if (profilePictureFile && profilePictureFile.name) {
    payload.profilePicture = profilePictureFile.name;
  }

  try {
    const response = await fetch('/api/admin/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      adminMessage.classList.add('error');
      adminMessage.textContent = data.error || 'Unable to create member.';
      return;
    }
    newMemberForm.reset();
    if (memberModal) {
      memberModal.classList.add('hidden');
    }
    await fetchMembers();
    await fetchSummary();
    adminMessage.classList.add('success');
    adminMessage.textContent = 'Member created successfully.';
  } catch (error) {
    adminMessage.classList.add('error');
    adminMessage.textContent = 'Unable to create member.';
  }
  });
}

async function loadProfitHistory() {
  try {
    const response = await fetch('/api/admin/profit/history');
    if (!response.ok) {
      if (profitHistoryList) {
        profitHistoryList.innerHTML = '<tr><td colspan="5">Unable to load profit history.</td></tr>';
      }
      return;
    }

    const data = await response.json();
    const distributions = data.distributions || [];
    adminProfitDistributions = distributions;

    if (lastProfitDistribution) {
      if (!distributions.length) {
        lastProfitDistribution.textContent = 'Last distribution: Not yet distributed';
      } else {
        const latest = distributions[0];
        lastProfitDistribution.textContent = `Last distribution: $${Number(latest.totalAmount || 0).toFixed(2)} on ${new Date(latest.createdAt).toLocaleString()} (Equal Share)`;
      }
    }

    if (!profitHistoryList) {
      return;
    }

    if (!distributions.length) {
      profitHistoryList.innerHTML = '<tr><td colspan="5">No profit distributions yet.</td></tr>';
      return;
    }

    profitHistoryList.innerHTML = distributions.map((item) => `
      <tr>
        <td>${new Date(item.createdAt).toLocaleString()}</td>
        <td>$${Number(item.totalAmount || 0).toFixed(2)}</td>
        <td>Equal Share</td>
        <td>${item.memberCount || 0}</td>
        <td>${item.notes || '-'}</td>
      </tr>
    `).join('');

  } catch (error) {
    if (profitHistoryList) {
      profitHistoryList.innerHTML = '<tr><td colspan="5">Unable to load profit history.</td></tr>';
    }
  }
}

async function handleProfitDistribution(form, messageEl) {
  if (!form || !messageEl) {
    return;
  }

  messageEl.textContent = '';
  messageEl.classList.remove('success', 'error');

  const formData = new FormData(form);
  const payload = {
    totalAmount: Number(formData.get('totalAmount')),
    distributionType: formData.get('distributionType'),
    notes: formData.get('notes'),
  };

  if (!payload.totalAmount || payload.totalAmount <= 0) {
    messageEl.classList.add('error');
    messageEl.textContent = 'Enter a valid profit amount.';
    return;
  }

  try {
    const response = await fetch('/api/admin/profit/distribute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      messageEl.classList.add('error');
      messageEl.textContent = data.error || 'Unable to distribute profit.';
      return;
    }

    form.reset();
    await fetchMembers();
    await fetchSummary();
    await loadProfitHistory();
    await loadNotices();
    messageEl.classList.add('success');
    messageEl.textContent = `Profit distributed to ${data.updatedMembers?.length || 0} members. All member dashboards updated.`;
  } catch (error) {
    messageEl.classList.add('error');
    messageEl.textContent = 'Unable to distribute profit.';
  }
}

function bindProfitDistributionForm(form, messageEl) {
  if (!form) {
    return;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await handleProfitDistribution(form, messageEl);
  });
}

bindProfitDistributionForm(profitDistributionForm, profitDistributionMessage);

if (goToProfitPageBtn) {
  goToProfitPageBtn.addEventListener('click', () => {
    navigateToPage('profit');
  });
}

async function loadInvestmentProfitHistory() {
  if (!investmentProfitHistoryList) {
    return;
  }

  try {
    const response = await fetch('/api/admin/profit/investment-history');
    if (!response.ok) {
      investmentProfitHistoryList.innerHTML = '<tr><td colspan="9">Unable to load investment profit history.</td></tr>';
      return;
    }

    const data = await response.json();
    const records = data.records || [];
    adminInvestmentProfitRecords = records;

    if (!records.length) {
      investmentProfitHistoryList.innerHTML = '<tr><td colspan="9">No investment profit records yet.</td></tr>';
      return;
    }

    investmentProfitHistoryList.innerHTML = records.map((item) => {
      const isLoss = item.outcomeType === 'loss';
      const amount = Number(item.profitAmount || 0);
      return `
      <tr>
        <td>${new Date(item.createdAt).toLocaleString()}</td>
        <td>${item.investmentCode || '-'}</td>
        <td>${item.sector || '-'}</td>
        <td>${item.partner || '-'}</td>
        <td>$${Number(item.investmentAmount || 0).toFixed(2)}</td>
        <td>$${Number(item.saleAmount || 0).toFixed(2)}</td>
        <td>${isLoss ? '-' : ''}$${amount.toFixed(2)}</td>
        <td>${isLoss ? 'Loss (Equal Share)' : 'Profit (Equal Share)'}</td>
        <td>${item.notes || '-'}</td>
      </tr>
    `;
    }).join('');

  } catch (error) {
    investmentProfitHistoryList.innerHTML = '<tr><td colspan="9">Unable to load investment profit history.</td></tr>';
  }
}

async function loadIouCodePreview() {
  if (!nextIouCode) {
    return;
  }

  try {
    const response = await fetch('/api/admin/ious/preview-code');
    if (!response.ok) {
      nextIouCode.textContent = 'Unavailable';
      return;
    }
    const data = await response.json();
    nextIouCode.textContent = data.iouCode || 'Unavailable';
  } catch (error) {
    nextIouCode.textContent = 'Unavailable';
  }
}

async function loadInvestmentIous() {
  try {
    const response = await fetch('/api/admin/ious');
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (investmentIouList) {
        investmentIouList.innerHTML = `<tr><td colspan="9">${data.error || 'Unable to load IOUs.'}</td></tr>`;
      }
      return;
    }

    investmentIous = data.ious || [];

    if (investmentIouList) {
      if (!investmentIous.length) {
        investmentIouList.innerHTML = '<tr><td colspan="9">No investment IOUs recorded yet.</td></tr>';
      } else {
        investmentIouList.innerHTML = investmentIous.map((iou) => `
          <tr>
            <td><strong>${iou.iouCode || '-'}</strong></td>
            <td>${iou.investorName || '-'}</td>
            <td>${formatInvestmentDate(iou.dateOfBirth)}</td>
            <td>${iou.location || '-'}</td>
            <td>$${Number(iou.amount || 0).toFixed(2)}</td>
            <td>${iou.status || 'pending'}</td>
            <td>${new Date(iou.createdAt).toLocaleString()}</td>
            <td>
              <button type="button" class="receipt-button" data-pdf-preview="/api/admin/ious/${iou._id}/receipt" data-pdf-title="${iou.iouCode || 'IOU'}">View Receipt</button>
            </td>
            <td>
              <button type="button" class="secondary-btn" data-iou-delete="${iou._id}">Delete</button>
            </td>
          </tr>
        `).join('');
      }
    }

  } catch (error) {
    if (investmentIouList) {
      investmentIouList.innerHTML = '<tr><td colspan="9">Unable to load IOUs.</td></tr>';
    }
  }
}

async function deleteInvestmentIou(iouId) {
  if (!iouId || !window.confirm('Delete this investment IOU?')) {
    return;
  }

  try {
    const response = await fetch(`/api/admin/ious/${iouId}`, { method: 'DELETE' });
    if (!response.ok) {
      return;
    }
    await loadInvestmentIous();
    await loadIouCodePreview();
  } catch (error) {
    console.error('Unable to delete IOU:', error);
  }
}

if (openIouModalBtn) {
  openIouModalBtn.addEventListener('click', () => {
    if (iouModal) {
      iouModal.classList.remove('hidden');
      void loadIouCodePreview();
    }
  });
}

if (closeIouModalBtn) {
  closeIouModalBtn.addEventListener('click', () => {
    if (iouModal) {
      iouModal.classList.add('hidden');
    }
  });
}

if (iouModal) {
  iouModal.addEventListener('click', (event) => {
    if (event.target === iouModal) {
      iouModal.classList.add('hidden');
    }
  });
}

if (iouForm) {
  iouForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (iouMessage) {
      iouMessage.textContent = '';
      iouMessage.classList.remove('success', 'error');
    }

    const formData = new FormData(iouForm);
    const payload = {
      investorName: formData.get('investorName')?.trim(),
      dateOfBirth: formData.get('dateOfBirth'),
      location: formData.get('location')?.trim(),
      amount: Number(formData.get('amount')),
      notes: formData.get('notes'),
    };

    if (!payload.investorName || !payload.dateOfBirth || !payload.location || !payload.amount || payload.amount <= 0) {
      if (iouMessage) {
        iouMessage.classList.add('error');
        iouMessage.textContent = 'Name, date of birth, location, and a valid amount are required.';
      }
      return;
    }

    try {
      const response = await fetch('/api/admin/ious', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        if (iouMessage) {
          iouMessage.classList.add('error');
          iouMessage.textContent = data.error || 'Unable to save IOU.';
        }
        return;
      }

      const iouCode = data.iou?.iouCode || 'N/A';
      const receiptUrl = `/api/admin/ious/${data.iou._id}/receipt`;
      if (nextIouCode) {
        nextIouCode.textContent = iouCode;
      }
      await loadInvestmentIous();
      await loadIouCodePreview();
      iouForm.reset();
      if (iouModal) {
        iouModal.classList.add('hidden');
      }
      openPdfPreview(
        receiptUrl,
        `IOU ${iouCode}`,
        `IOU receipt ready for ${payload.investorName}. IOU ID: ${iouCode}`
      );
    } catch (error) {
      if (iouMessage) {
        iouMessage.classList.add('error');
        iouMessage.textContent = 'Unable to save IOU.';
      }
    }
  });
}

async function loadInvestmentCodePreview() {
  if (!nextInvestmentCode) {
    return;
  }

  try {
    const response = await fetch('/api/admin/investments/preview-code');
    const data = await response.json();
    if (!response.ok) {
      nextInvestmentCode.textContent = 'Unavailable';
      return;
    }
    nextInvestmentCode.textContent = data.investmentCode || 'Unavailable';
  } catch (error) {
    nextInvestmentCode.textContent = 'Unavailable';
  }
}

let investmentFormOptions = {
  investors: [],
  projectManagers: [],
  types: [],
};

function fillSelectOptions(selectEl, items, { valueKey = '_id', labelFn, placeholder, includeEmpty = true } = {}) {
  if (!selectEl) return;
  const current = selectEl.value;
  const options = [];
  if (includeEmpty) {
    options.push(`<option value="">${placeholder || 'Select…'}</option>`);
  }
  for (const item of items) {
    const value = item[valueKey];
    const label = labelFn ? labelFn(item) : item.name;
    options.push(`<option value="${value}">${label}</option>`);
  }
  selectEl.innerHTML = options.join('');
  if ([...selectEl.options].some((opt) => opt.value === current)) {
    selectEl.value = current;
  }
}

async function loadInvestmentFormOptions() {
  const [typesRes, investorsRes, managersRes] = await Promise.all([
    fetch('/api/admin/investments/types'),
    fetch('/api/admin/investments/investors'),
    fetch('/api/admin/investments/project-managers'),
  ]);

  const typesData = await typesRes.json();
  const investorsData = await investorsRes.json();
  const managersData = await managersRes.json();

  if (!typesRes.ok) throw new Error(typesData.error || 'Unable to load investment types.');
  if (!investorsRes.ok) throw new Error(investorsData.error || 'Unable to load investors.');
  if (!managersRes.ok) throw new Error(managersData.error || 'Unable to load project managers.');

  investmentFormOptions = {
    types: typesData.types || [],
    investors: investorsData.investors || [],
    projectManagers: managersData.projectManagers || [],
  };

  fillSelectOptions(document.getElementById('investmentTypeSelect'), investmentFormOptions.types, {
    valueKey: 'name',
    labelFn: (item) => item.name,
    placeholder: 'Choose type…',
  });
  fillSelectOptions(document.getElementById('investmentInvestorSelect'), investmentFormOptions.investors, {
    labelFn: (item) => `${item.name} (${item.email})`,
    placeholder: 'Choose investor…',
  });
  fillSelectOptions(document.getElementById('investmentProjectManagerSelect'), investmentFormOptions.projectManagers, {
    labelFn: (item) => `${item.name} (${item.email})`,
    placeholder: 'Unassigned',
  });
  fillSelectOptions(document.getElementById('portfolioInvestorSelect'), investmentFormOptions.investors, {
    labelFn: (item) => `${item.name} (${item.email})`,
    placeholder: 'Choose an investor…',
  });
}

function applySelectedInvestorDefaults() {
  const investorSelect = document.getElementById('investmentInvestorSelect');
  const dobInput = document.getElementById('investmentDobInput');
  const locationInput = document.getElementById('investmentLocationInput');
  if (!investorSelect) return;

  const investor = investmentFormOptions.investors.find((item) => item._id === investorSelect.value);
  if (!investor) return;

  if (dobInput && investor.dateOfBirth) {
    dobInput.value = new Date(investor.dateOfBirth).toISOString().slice(0, 10);
  }
  if (locationInput && investor.address) {
    locationInput.value = investor.address;
  } else if (locationInput && !locationInput.value) {
    locationInput.value = 'Not specified';
  }
}

async function loadInvestorPortfolio(investorId = null) {
  const select = document.getElementById('portfolioInvestorSelect');
  const summaryEl = document.getElementById('investorPortfolioSummary');
  const byTypeEl = document.getElementById('investorPortfolioByType');
  const messageEl = document.getElementById('investorPortfolioMessage');
  const selectedId = investorId || select?.value;

  if (!selectedId) {
    if (summaryEl) summaryEl.innerHTML = '';
    if (byTypeEl) byTypeEl.innerHTML = '<p class="table-subtitle">Select an investor to view their portfolio.</p>';
    if (messageEl) messageEl.textContent = '';
    return;
  }

  try {
    const response = await fetch(`/api/admin/investments/portfolio/${selectedId}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load portfolio.');

    if (summaryEl) {
      summaryEl.innerHTML = `
        <div class="metric-card metric-card-1"><div class="metric-content"><span class="metric-label">Investments</span><strong class="metric-value">${data.summary.totalInvestments}</strong></div></div>
        <div class="metric-card metric-card-2"><div class="metric-content"><span class="metric-label">Active Amount</span><strong class="metric-value">$${Number(data.summary.activeAmount || 0).toFixed(2)}</strong></div></div>
        <div class="metric-card metric-card-3"><div class="metric-content"><span class="metric-label">Sold Amount</span><strong class="metric-value">$${Number(data.summary.soldAmount || 0).toFixed(2)}</strong></div></div>
        <div class="metric-card metric-card-5"><div class="metric-content"><span class="metric-label">Total Invested</span><strong class="metric-value">$${Number(data.summary.totalAmount || 0).toFixed(2)}</strong></div></div>
      `;
    }

    if (!data.byType?.length) {
      if (byTypeEl) byTypeEl.innerHTML = '<p class="table-subtitle">No investments yet for this investor.</p>';
      return;
    }

    if (byTypeEl) {
      byTypeEl.innerHTML = data.byType.map((bucket) => `
        <section class="panel-card" style="margin-top: 0.85rem;">
          <h3 style="margin: 0 0 0.35rem;">${bucket.investmentType}</h3>
          <p class="table-subtitle">${bucket.count} investment(s) · Total $${Number(bucket.totalAmount || 0).toFixed(2)} · Active $${Number(bucket.activeAmount || 0).toFixed(2)}</p>
          <div class="table-wrapper">
            <table class="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Amount</th>
                  <th>Project Manager</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                ${bucket.investments.map((item) => `
                  <tr>
                    <td><strong>${item.investmentCode || '-'}</strong></td>
                    <td>$${Number(item.amount || 0).toFixed(2)}</td>
                    <td>${item.projectManager?.name || 'Unassigned'}</td>
                    <td>${item.status || '-'}</td>
                    <td>${item.createdAt ? new Date(item.createdAt).toLocaleString() : '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </section>
      `).join('');
    }

    if (messageEl) messageEl.textContent = '';
  } catch (error) {
    if (messageEl) messageEl.textContent = error.message;
  }
}

if (openInvestmentModalBtn) {
  openInvestmentModalBtn.addEventListener('click', async () => {
    if (!investmentModal) return;
    investmentMessage.textContent = '';
    investmentMessage.classList.remove('success', 'error');
    investmentModal.classList.remove('hidden');
    void loadInvestmentCodePreview();
    try {
      await loadInvestmentFormOptions();
    } catch (error) {
      investmentMessage.classList.add('error');
      investmentMessage.textContent = error.message;
    }
  });
}

if (closeInvestmentModalBtn) {
  closeInvestmentModalBtn.addEventListener('click', () => {
    if (investmentModal) {
      investmentModal.classList.add('hidden');
    }
  });
}

document.getElementById('investmentInvestorSelect')?.addEventListener('change', applySelectedInvestorDefaults);

document.getElementById('addInvestmentTypeBtn')?.addEventListener('click', async () => {
  const input = document.getElementById('newInvestmentTypeName');
  const name = input?.value?.trim();
  if (!name) {
    investmentMessage.classList.add('error');
    investmentMessage.textContent = 'Enter a custom investment type name.';
    return;
  }

  try {
    const response = await fetch('/api/admin/investments/types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to add investment type.');
    if (input) input.value = '';
    await loadInvestmentFormOptions();
    const typeSelect = document.getElementById('investmentTypeSelect');
    if (typeSelect && data.type?.name) {
      typeSelect.value = data.type.name;
    }
    investmentMessage.classList.remove('error');
    investmentMessage.classList.add('success');
    investmentMessage.textContent = `Added type: ${data.type.name}`;
  } catch (error) {
    investmentMessage.classList.add('error');
    investmentMessage.textContent = error.message;
  }
});

document.getElementById('portfolioInvestorSelect')?.addEventListener('change', () => {
  void loadInvestorPortfolio();
});

document.getElementById('refreshPortfolioBtn')?.addEventListener('click', () => {
  void loadInvestorPortfolio();
});

if (investmentModal) {
  investmentModal.addEventListener('click', (event) => {
    if (event.target === investmentModal) {
      investmentModal.classList.add('hidden');
    }
  });
}

if (closeEditInvestmentModalBtn) {
  closeEditInvestmentModalBtn.addEventListener('click', () => {
    if (editInvestmentModal) {
      editInvestmentModal.classList.add('hidden');
    }
  });
}

if (editInvestmentModal) {
  editInvestmentModal.addEventListener('click', (event) => {
    if (event.target === editInvestmentModal) {
      editInvestmentModal.classList.add('hidden');
    }
  });
}

if (editInvestmentForm) {
  editInvestmentForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    editInvestmentMessage.textContent = '';
    editInvestmentMessage.classList.remove('success', 'error');

    const formData = new FormData(editInvestmentForm);
    const investmentId = formData.get('investmentId');
    const payload = {
      investorName: formData.get('investorName'),
      dateOfBirth: formData.get('dateOfBirth'),
      location: formData.get('location'),
      profit: Number(formData.get('profit')) || 0,
      notes: formData.get('notes'),
    };

    try {
      const response = await fetch(`/api/admin/investments/${investmentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        editInvestmentMessage.classList.add('error');
        editInvestmentMessage.textContent = data.error || 'Unable to update investment.';
        return;
      }

      if (editInvestmentModal) {
        editInvestmentModal.classList.add('hidden');
      }
      await loadInvestments();
      editInvestmentMessage.classList.add('success');
      editInvestmentMessage.textContent = 'Investment updated successfully.';
    } catch (error) {
      editInvestmentMessage.classList.add('error');
      editInvestmentMessage.textContent = 'Unable to update investment.';
    }
  });
}

function openEditInvestmentModal(investment) {
  if (!editInvestmentForm || !editInvestmentModal) {
    return;
  }

  editInvestmentForm.querySelector('[name="investmentId"]').value = investment._id;
  editInvestmentForm.querySelector('[name="investorName"]').value = investment.investorName || investment.partner || '';
  editInvestmentForm.querySelector('[name="location"]').value = investment.location || investment.sector || '';
  const dobInput = editInvestmentForm.querySelector('[name="dateOfBirth"]');
  if (dobInput) {
    dobInput.value = investment.dateOfBirth
      ? new Date(investment.dateOfBirth).toISOString().slice(0, 10)
      : '';
  }
  editInvestmentForm.querySelector('[name="profit"]').value = Number(investment.profit || 0);
  editInvestmentForm.querySelector('[name="notes"]').value = investment.notes || '';
  editInvestmentMessage.textContent = '';
  editInvestmentMessage.classList.remove('success', 'error');
  editInvestmentModal.classList.remove('hidden');
}

async function deleteInvestmentRecord(investmentId) {
  if (!window.confirm('Delete this investment and refund the amount back to total savings?')) {
    return;
  }

  try {
    const response = await fetch(`/api/admin/investments/${investmentId}`, {
      method: 'DELETE',
    });
    const data = await response.json();
    if (!response.ok) {
      window.alert(data.error || 'Unable to delete investment.');
      return;
    }

    await fetchMembers();
    await fetchSummary();
    await loadInvestments();
  } catch (error) {
    window.alert('Unable to delete investment.');
  }
}

function bindInvestmentActions(investments) {
  document.querySelectorAll('[data-investment-edit]').forEach((button) => {
    button.addEventListener('click', () => {
      const investment = investments.find((item) => item._id === button.dataset.investmentEdit);
      if (investment) {
        openEditInvestmentModal(investment);
      }
    });
  });

  document.querySelectorAll('[data-investment-delete]').forEach((button) => {
    button.addEventListener('click', () => {
      const investmentId = button.dataset.investmentDelete;
      if (investmentId) {
        void deleteInvestmentRecord(investmentId);
      }
    });
  });

  document.querySelectorAll('[data-open-investor]').forEach((el) => {
    el.addEventListener('click', (event) => {
      event.preventDefault();
      if (el.dataset.openInvestor) openInvestorDetail(el.dataset.openInvestor, { pushUrl: true });
    });
  });

  document.querySelectorAll('[data-open-pm]').forEach((el) => {
    el.addEventListener('click', (event) => {
      event.preventDefault();
      if (el.dataset.openPm) openProjectManagerDetail(el.dataset.openPm, { pushUrl: true });
    });
  });
}

if (investmentForm) {
  investmentForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    investmentMessage.textContent = '';
    investmentMessage.classList.remove('success', 'error');

    const formData = new FormData(investmentForm);
    const documentsInput = document.getElementById('investmentDocumentsInput');
    let documents = [];
    try {
      documents = await readFilesAsBase64(documentsInput?.files);
    } catch (error) {
      investmentMessage.classList.add('error');
      investmentMessage.textContent = 'Unable to read uploaded documents.';
      return;
    }

    const payload = {
      investorId: formData.get('investorId'),
      investmentType: formData.get('investmentType'),
      projectManagerId: formData.get('projectManagerId') || null,
      dateOfBirth: formData.get('dateOfBirth') || null,
      location: formData.get('location')?.trim(),
      amount: Number(formData.get('amount')),
      notes: formData.get('notes'),
      documents,
    };

    if (!payload.investorId || !payload.investmentType || !payload.amount || payload.amount <= 0) {
      investmentMessage.classList.add('error');
      investmentMessage.textContent = 'Investor, investment type, and a valid amount are required.';
      return;
    }

    if (!payload.location) {
      payload.location = 'Not specified';
    }

    try {
      const response = await fetch('/api/admin/investments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        investmentMessage.classList.add('error');
        investmentMessage.textContent = data.error || 'Unable to record investment.';
        return;
      }

      const investmentCode = data.investment?.investmentCode || 'N/A';
      investmentMessage.classList.add('success');
      investmentMessage.textContent = data.message || `Proposal ${investmentCode} submitted for member approval.`;
      await fetchMembers();
      await fetchSummary();
      await loadInvestments();
      await loadInvestmentCodePreview();
      await loadInvestmentFormOptions();
      const portfolioSelect = document.getElementById('portfolioInvestorSelect');
      if (portfolioSelect && payload.investorId) {
        portfolioSelect.value = payload.investorId;
        await loadInvestorPortfolio(payload.investorId);
      }
      investmentForm.reset();
      if (documentsInput) documentsInput.value = '';
      // Keep modal open briefly so CEO sees success, then close
      window.setTimeout(() => {
        if (investmentModal) investmentModal.classList.add('hidden');
      }, 700);
    } catch (error) {
      investmentMessage.classList.add('error');
      investmentMessage.textContent = 'Unable to record investment.';
    }
  });
}

function applyInvestmentDashboardSummary(summary = {}) {
  const total = Number(summary.totalInvested || 0);
  const active = Number(summary.activeInvested || 0);
  const sold = Number(summary.soldInvested || 0);
  const soldProceeds = Number(summary.totalSoldProceeds || 0);
  const activeCount = summary.activeCount ?? 0;
  const soldCount = summary.soldCount ?? 0;

  if (dashboardTotalInvestment) {
    dashboardTotalInvestment.textContent = `$${total.toFixed(0)}`;
  }

  const activeAmount = document.getElementById('dashboardInvestmentActiveAmount');
  const soldAmount = document.getElementById('dashboardInvestmentSoldAmount');
  if (activeAmount) {
    activeAmount.textContent = `$${active.toFixed(0)}`;
  }
  if (soldAmount) {
    soldAmount.textContent = `$${sold.toFixed(0)}`;
  }

  const investedNote = document.getElementById('dashboardInvestmentInvestedNote');
  const soldNote = document.getElementById('dashboardInvestmentSoldNote');
  if (investedNote) {
    investedNote.textContent = `${activeCount} running investment${activeCount === 1 ? '' : 's'}`;
  }
  if (soldNote) {
    soldNote.textContent = soldProceeds > 0
      ? `${soldCount} sold · proceeds $${soldProceeds.toFixed(0)}`
      : `${soldCount} sold investment${soldCount === 1 ? '' : 's'}`;
  }

  const financeListInvestments = document.getElementById('financeListInvestments');
  if (financeListInvestments) {
    financeListInvestments.textContent = `$${total.toFixed(2)}`;
  }

  const investmentSoldAmount = document.getElementById('investmentSoldAmount');
  const investmentPageTotal = document.getElementById('investmentPageTotalInvested');
  const investmentPageTotalNote = document.getElementById('investmentPageTotalNote');
  if (investmentSoldAmount) {
    investmentSoldAmount.textContent = soldProceeds > 0
      ? `$${sold.toFixed(2)} invested · $${soldProceeds.toFixed(2)} sale proceeds`
      : `$${sold.toFixed(2)} sold amount`;
  }
  if (investmentPageTotal) {
    investmentPageTotal.textContent = `$${total.toFixed(2)}`;
  }
  if (investmentPageTotalNote) {
    investmentPageTotalNote.textContent = `$${active.toFixed(2)} running · $${sold.toFixed(2)} sold`;
  }
}

async function loadMonthlyContributionDashboard() {
  const givenList = document.getElementById('monthlyGivenList');
  const notGivenList = document.getElementById('monthlyNotGivenList');
  if (!givenList || !notGivenList) {
    return;
  }

  try {
    const response = await fetch('/api/admin/monthly-contributions');
    const report = response.ok ? await response.json() : null;
    if (!report) {
      givenList.innerHTML = '<li class="table-subtitle">Unable to load monthly report.</li>';
      notGivenList.innerHTML = '<li class="table-subtitle">Unable to load monthly report.</li>';
      return;
    }

    const monthLabel = report.monthLabel || 'This month';
    const givenSubtitle = document.getElementById('monthlyGivenSubtitle');
    const notGivenSubtitle = document.getElementById('monthlyNotGivenSubtitle');
    const givenTotal = document.getElementById('monthlyGivenTotal');
    const givenCountNumber = document.getElementById('monthlyGivenCountNumber');
    const notGivenTotal = document.getElementById('monthlyNotGivenTotal');
    const notGivenCountNumber = document.getElementById('monthlyNotGivenCountNumber');

    if (givenSubtitle) givenSubtitle.textContent = `Paid in ${monthLabel}`;
    if (notGivenSubtitle) notGivenSubtitle.textContent = `Not paid in ${monthLabel}`;
    if (givenCountNumber) givenCountNumber.textContent = String(report.paidCount || 0);
    if (givenTotal) givenTotal.textContent = `$${Number(report.paidTotal || 0).toFixed(2)}`;
    if (notGivenCountNumber) notGivenCountNumber.textContent = String(report.unpaidCount || 0);
    if (notGivenTotal) notGivenTotal.textContent = `$${Number(report.unpaidTotal || 0).toFixed(2)}`;

    const paidRows = report.paid || [];
    givenList.innerHTML = paidRows.length ? paidRows.map((row) => `
      <li class="monthly-contribution-row">
        <span class="monthly-contribution-name">${row.member?.name || 'Unknown'}</span>
        <span class="monthly-contribution-amount">$${Number(row.amount || 0).toFixed(2)}</span>
      </li>
    `).join('') : '<li class="table-subtitle">No deposits recorded this month yet.</li>';

    const unpaidRows = report.unpaid || [];
    notGivenList.innerHTML = unpaidRows.length ? unpaidRows.map((row) => `
      <li class="monthly-contribution-row">
        <span class="monthly-contribution-name">${row.member?.name || 'Unknown'}</span>
        <span class="monthly-contribution-amount monthly-contribution-amount-warn">${report.expectedAmount ? `$${Number(row.expectedAmount || 0).toFixed(2)} due` : 'Not paid'}</span>
      </li>
    `).join('') : '<li class="table-subtitle">All active members deposited this month.</li>';
  } catch (error) {
    givenList.innerHTML = '<li class="table-subtitle">Unable to load monthly report.</li>';
    notGivenList.innerHTML = '<li class="table-subtitle">Unable to load monthly report.</li>';
  }
}

function bindMonthlyContributionDashboard() {
  document.addEventListener('click', (event) => {
    const pdfBtn = event.target.closest('[data-monthly-pdf]');
    if (!pdfBtn) {
      return;
    }

    const type = pdfBtn.dataset.monthlyPdf;
    const title = type === 'unpaid' ? 'Not Deposited This Month' : 'Deposited This Month';
    void openPdfPreview(`/api/admin/monthly-contributions/report.pdf?type=${type}`, title);
  });
}

async function loadInvestments() {
  try {
    const response = await fetch('/api/admin/investments');
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMessage = data.error || 'Unable to load investment records.';
      if (societyActiveInvestmentList) {
        societyActiveInvestmentList.innerHTML = `<tr><td colspan="9">${errorMessage}</td></tr>`;
      }
      if (societySoldInvestmentList) {
        societySoldInvestmentList.innerHTML = `<tr><td colspan="9">${errorMessage}</td></tr>`;
      }
      return;
    }

    societyActiveInvestments = data.activeInvestments || [];
    societySoldInvestments = data.soldInvestments || [];
    societyInvestments = data.investments || [...societyActiveInvestments, ...societySoldInvestments];
    const pendingInvestments = data.pendingInvestments || [];
    const summary = data.summary || {};

    if (investmentTotalSavings) {
      investmentTotalSavings.textContent = `$${Number(summary.totalSavings || 0).toFixed(2)}`;
    }
    if (investmentActiveCount) {
      investmentActiveCount.textContent = summary.activeCount ?? societyActiveInvestments.length;
    }
    if (investmentActiveInvested) {
      investmentActiveInvested.textContent = `$${Number(summary.activeInvested || 0).toFixed(2)}`;
    }
    if (investmentSoldCount) {
      investmentSoldCount.textContent = summary.soldCount ?? societySoldInvestments.length;
    }
    applyInvestmentDashboardSummary(summary);
    if (reportInvestments) {
      reportInvestments.textContent = summary.investmentCount || societyInvestments.length;
    }

    if (societyActiveInvestmentList) {
      societyActiveInvestmentList.innerHTML = societyActiveInvestments.length
        ? renderActiveInvestmentTableRows(societyActiveInvestments)
        : '<tr><td colspan="9">No running investments yet.</td></tr>';
    }

    if (societySoldInvestmentList) {
      societySoldInvestmentList.innerHTML = societySoldInvestments.length
        ? renderSoldInvestmentTableRows(societySoldInvestments)
        : '<tr><td colspan="9">No sold investments yet.</td></tr>';
    }

    renderPendingInvestmentApprovals(pendingInvestments);
    bindInvestmentActions(societyActiveInvestments);

  } catch (error) {
    console.error('Unable to load investments:', error);
    if (societyActiveInvestmentList) {
      societyActiveInvestmentList.innerHTML = '<tr><td colspan="9">Unable to load investment records. Please refresh the page.</td></tr>';
    }
    if (societySoldInvestmentList) {
      societySoldInvestmentList.innerHTML = '<tr><td colspan="9">Unable to load investment records. Please refresh the page.</td></tr>';
    }
  }
}

function renderPendingInvestmentApprovals(pendingInvestments = []) {
  const list = document.getElementById('pendingInvestmentApprovalsList');
  if (!list) return;

  if (!pendingInvestments.length) {
    list.innerHTML = '<tr><td colspan="8">No investments awaiting approval or cashier payment.</td></tr>';
    return;
  }

  list.innerHTML = pendingInvestments.map((item) => {
    const tracking = item.approvalTracking || {};
    return `
      <tr>
        <td><strong>${item.investmentCode || '-'}</strong></td>
        <td>${item.investor?.name || item.investorName || '-'}</td>
        <td>${item.investmentType || '-'}</td>
        <td>$${Number(item.amount || 0).toFixed(2)}</td>
        <td>${item.displayStatus || item.status}</td>
        <td>${tracking.approvedCount ?? 0}/${tracking.totalMembers ?? 0}</td>
        <td>${tracking.pendingCount ?? 0}</td>
        <td><button type="button" class="secondary-btn" data-approval-detail="${item._id}">View Members</button></td>
      </tr>
    `;
  }).join('');

  list.querySelectorAll('[data-approval-detail]').forEach((btn) => {
    btn.addEventListener('click', () => {
      void showInvestmentApprovalDetail(btn.dataset.approvalDetail);
    });
  });
}

async function showInvestmentApprovalDetail(investmentId) {
  const panel = document.getElementById('investmentApprovalDetailPanel');
  if (!panel) return;
  panel.innerHTML = '<p class="table-subtitle">Loading approval details…</p>';

  try {
    const response = await fetch(`/api/admin/investments/${investmentId}/approvals`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load details.');

    const investment = data.investment || {};
    const tracking = data.approvalTracking || {};
    const docs = (investment.documents || []).map((doc) => `
      <li><a href="${doc.filePath}" target="_blank" rel="noopener">${doc.originalName || 'Document'}</a></li>
    `).join('') || '<li>No documents uploaded.</li>';

    panel.innerHTML = `
      <h3 style="margin:0 0 0.4rem;">${investment.investmentCode || 'Investment'} · Approval Tracking</h3>
      <p class="table-subtitle">${tracking.displayStatus || investment.status} · $${Number(investment.amount || 0).toFixed(2)}</p>
      <div class="metrics-grid u-my-1">
        <div class="metric-card"><div class="metric-content"><span class="metric-label">Approved</span><strong class="metric-value">${tracking.approvedCount || 0}</strong></div></div>
        <div class="metric-card"><div class="metric-content"><span class="metric-label">Not Yet Approved</span><strong class="metric-value">${tracking.pendingCount || 0}</strong></div></div>
        <div class="metric-card"><div class="metric-content"><span class="metric-label">Total Members</span><strong class="metric-value">${tracking.totalMembers || 0}</strong></div></div>
      </div>
      <div class="form-row-2">
        <div>
          <h4>Approved Members</h4>
          <ul>${(tracking.approvedMembers || []).map((m) => `<li>${m.name}${m.approvedAt ? ` · ${new Date(m.approvedAt).toLocaleString()}` : ''}</li>`).join('') || '<li>None yet</li>'}</ul>
        </div>
        <div>
          <h4>Awaiting Response</h4>
          <ul>${(tracking.pendingMembers || []).map((m) => `<li>${m.name}${m.email ? ` (${m.email})` : ''}</li>`).join('') || '<li>Everyone approved</li>'}</ul>
        </div>
      </div>
      <h4>Documents</h4>
      <ul>${docs}</ul>
    `;
  } catch (error) {
    panel.innerHTML = `<p class="message">${error.message}</p>`;
  }
}

async function loadNotices() {
  try {
    const response = await fetch('/api/admin/summary');
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    if (noticeBoardList) {
      noticeBoardList.innerHTML = (data.notices || []).map((notice) => `
        <div class="member-roster-item">
          <strong>${notice.title}</strong>
          <span>${notice.message}</span>
          <small>${new Date(notice.createdAt).toLocaleDateString()}</small>
        </div>
      `).join('');
    }
  } catch (error) {
    console.error('Unable to load notices:', error);
  }
}

noticeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  noticeMessage.textContent = '';
  noticeMessage.classList.remove('success', 'error');

  const formData = new FormData(noticeForm);
  try {
    const response = await fetch('/api/admin/notices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: formData.get('title'),
        message: formData.get('message'),
        author: formData.get('author'),
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      noticeMessage.classList.add('error');
      noticeMessage.textContent = data.error || 'Unable to publish notice.';
      return;
    }

    noticeForm.reset();
    await fetchSummary();
    await loadNotices();
    noticeMessage.classList.add('success');
    noticeMessage.textContent = 'Notice published.';
  } catch (error) {
    noticeMessage.classList.add('error');
    noticeMessage.textContent = 'Unable to publish notice.';
  }
});

async function loadWithdrawalRequests() {
  try {
    const response = await fetch('/api/withdrawals/admin');
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    withdrawalRequests = data.requests || [];
    if (withdrawalRequestsList) {
      withdrawalRequestsList.innerHTML = withdrawalRequests.map((request) => `
        <tr>
          <td>${request.member?.name || 'Unknown'}</td>
          <td>$${Number(request.amount || 0).toFixed(2)}</td>
          <td>${request.status}</td>
          <td>${request.reason || '-'}</td>
          <td>
            <div class="action-group">
              <button class="secondary-btn" data-action="approve" data-id="${request._id}">Approve</button>
              <button class="secondary-btn" data-action="process" data-id="${request._id}">Process</button>
            </div>
          </td>
        </tr>
      `).join('');
    }
  } catch (error) {
    if (withdrawalRequestsList) {
      withdrawalRequestsList.innerHTML = '<tr><td colspan="5">Unable to load withdrawal requests.</td></tr>';
    }
  }
}

async function updateWithdrawalRequest(requestId, status) {
  try {
    const response = await fetch(`/api/withdrawals/admin/${requestId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });

    if (!response.ok) {
      return;
    }

    await loadWithdrawalRequests();
    await fetchSummary();
  } catch (error) {
    console.error('Failed to update withdrawal request:', error);
  }
}

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/';
});

logoutDropdown.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/';
});

async function readFilesAsBase64(fileList) {
  const files = Array.from(fileList || []);
  const encoded = [];
  for (const file of files) {
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    encoded.push({ name: file.name, data });
  }
  return encoded;
}

function formatLoanStatusBadge(status = 'pending') {
  if (status === 'approved' || status === 'disbursed') {
    return '<span class="status-badge status-completed">'+status+'</span>';
  }
  if (status === 'rejected') {
    return '<span class="status-badge status-fail">Rejected</span>';
  }
  return '<span class="status-badge status-pending">Pending</span>';
}

function formatLoanClearanceBadge(loan = {}) {
  if (loan.status === 'disbursed' && loan.repaymentStatus === 'paid_off') {
    return '<span class="status-badge status-completed">Loan Cleared</span>';
  }
  if (loan.status === 'disbursed') {
    const outstanding = Number(loan.outstandingBalance ?? Math.max(Number(loan.amount || 0) - Number(loan.totalRepaid || 0), 0));
    if (outstanding <= 0) {
      return '<span class="status-badge status-completed">Loan Cleared</span>';
    }
    return '<span class="status-badge status-pending">Outstanding</span>';
  }
  return '-';
}

function buildLoanClearanceStatusHtml(loanSummary = {}) {
  if (loanSummary.hasOutstandingLoan) {
    return `
      <div class="loan-clearance-banner loan-clearance-active">
        <strong>Active Loan — Payment Due</strong>
        <p class="table-subtitle">
          ${formatLoanTypeLabel(loanSummary.loanType)} loan of $${Number(loanSummary.originalAmount || 0).toFixed(2)} —
          outstanding balance: <strong>$${Number(loanSummary.outstandingBalance || 0).toFixed(2)}</strong>
          (repaid so far: $${Number(loanSummary.totalRepaid || 0).toFixed(2)}).
          Record cash or office payments below.
        </p>
      </div>
    `;
  }

  if (loanSummary.loanCleared) {
    return `
      <div class="loan-clearance-banner loan-clearance-complete">
        <strong>Loan Cleared</strong>
        <p class="table-subtitle">
          This member has fully repaid their ${formatLoanTypeLabel(loanSummary.loanType)} loan of
          $${Number(loanSummary.originalAmount || 0).toFixed(2)}.
          Total repaid: <strong>$${Number(loanSummary.totalRepaid || 0).toFixed(2)}</strong>.
          ${loanSummary.clearedAt ? `Cleared on ${new Date(loanSummary.clearedAt).toLocaleString()}.` : ''}
        </p>
      </div>
    `;
  }

  return `
    <div class="loan-clearance-banner loan-clearance-neutral">
      <strong>No Active Loan</strong>
      <p class="table-subtitle">This member has no disbursed loan with an outstanding balance right now.</p>
    </div>
  `;
}

function formatLoanTypeLabel(type = 'general') {
  return type === 'emergency' ? 'Emergency' : 'General';
}

function applyLoanPortfolioSummary(summary = {}) {
  const takers = summary.totalLoanTakers ?? 0;
  const active = summary.activeBorrowers ?? 0;
  const notPaid = summary.notPaidThisMonth ?? 0;
  const paid = summary.paidThisMonth ?? 0;
  const outstanding = Number(summary.totalOutstanding || 0);
  const monthLabel = summary.currentMonthLabel || 'This month';

  const dashboardTakers = document.getElementById('dashboardLoanTakersCount');
  const dashboardActive = document.getElementById('dashboardActiveBorrowersCount');
  const dashboardOutstanding = document.getElementById('dashboardTotalLoanOutstanding');
  const dashboardTakersNote = document.getElementById('dashboardLoanTakersNote');
  const pageTakers = document.getElementById('loanPageTakersCount');
  const pageActive = document.getElementById('loanPageActiveBorrowersCount');
  const pageOutstanding = document.getElementById('loanPageTotalOutstanding');
  const pageNotPaid = document.getElementById('loanPageNotPaidCount');
  const pageMonthLabel = document.getElementById('loanPageMonthLabel');

  if (dashboardTakers) dashboardTakers.textContent = takers;
  if (dashboardActive) dashboardActive.textContent = active;
  if (dashboardOutstanding) {
    dashboardOutstanding.textContent = `${notPaid} not paid · $${outstanding.toFixed(2)} due`;
  }
  if (dashboardTakersNote) {
    dashboardTakersNote.textContent = `${takers} received loan money`;
  }
  if (pageTakers) pageTakers.textContent = takers;
  if (pageActive) pageActive.textContent = active;
  if (pageOutstanding) pageOutstanding.textContent = `$${outstanding.toFixed(2)}`;
  if (pageNotPaid) pageNotPaid.textContent = `${notPaid} not paid · ${paid} paid this month`;
  if (pageMonthLabel) pageMonthLabel.textContent = monthLabel;
}

async function loadLoanPortfolioSummary() {
  try {
    const response = await fetch('/api/loans/admin/summary');
    if (!response.ok) {
      return;
    }
    const summary = await response.json();
    applyLoanPortfolioSummary(summary);
  } catch (error) {
    // Keep existing values if summary fails.
  }
}

function renderLoanPortfolioMemberCell(member = {}) {
  return `
    <button type="button" class="member-loan-hub-link" data-member-id="${member._id || ''}">${member.name || 'Unknown'}</button>
    <br><small>${member.email || ''}</small>
  `;
}

function renderLoanPortfolioActions(memberId, { showPayment = false } = {}) {
  if (!memberId) {
    return '-';
  }
  return `
    <div class="loan-portfolio-actions">
      <button type="button" class="secondary-btn loan-portfolio-action" data-loan-portfolio-action="profile" data-member-id="${memberId}">View Profile</button>
      ${showPayment ? `<button type="button" class="secondary-btn loan-portfolio-action" data-loan-portfolio-action="payment" data-member-id="${memberId}">Process Payment</button>` : ''}
    </div>
  `;
}

function switchLoanListTab(tab = 'applications') {
  const panels = {
    takers: document.getElementById('loanTakersPanel'),
    active: document.getElementById('loanActiveBorrowersPanel'),
    applications: document.getElementById('loanApplicationsPanel'),
  };

  Object.entries(panels).forEach(([key, panel]) => {
    if (panel) {
      panel.classList.toggle('hidden', key !== tab);
    }
  });

  document.querySelectorAll('[data-loan-list-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.loanListTab === tab);
  });
}

function formatMonthlyPaymentBadge(entry = {}) {
  if (entry.paidThisMonth) {
    return '<span class="status-badge status-completed">Paid this month</span>';
  }
  return '<span class="status-badge status-pending">Not paid this month</span>';
}

function bindLoanListTabs() {
  document.querySelectorAll('[data-loan-list-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      const tab = button.dataset.loanListTab;
      if (tab) {
        switchLoanListTab(tab);
      }
    });
  });

  document.querySelectorAll('.loan-stat-card[data-loan-list-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      const tab = button.dataset.loanListTab;
      if (tab) {
        switchLoanListTab(tab);
      }
    });
  });

  const monthFilter = document.getElementById('loanActiveBorrowerMonthFilter');
  const refreshActiveBtn = document.getElementById('refreshActiveBorrowersBtn');
  if (monthFilter) {
    monthFilter.addEventListener('change', () => void loadActiveBorrowers());
  }
  if (refreshActiveBtn) {
    refreshActiveBtn.addEventListener('click', () => void refreshLoanPortfolioData());
  }

  document.addEventListener('click', async (event) => {
    const actionBtn = event.target.closest('.loan-portfolio-action');
    if (!actionBtn?.dataset?.memberId) {
      return;
    }

    const memberId = actionBtn.dataset.memberId;
    if (actionBtn.dataset.loanPortfolioAction === 'payment') {
      await openMemberProfile(memberId, { activeTab: 'loans' });
      return;
    }
    await openMemberProfile(memberId);
  });
}

async function loadLoanTakers() {
  const list = document.getElementById('loanTakersList');
  if (!list) {
    return;
  }

  try {
    const response = await fetch('/api/loans/admin/takers');
    const data = response.ok ? await response.json() : { takers: [] };
    const takers = data.takers || [];

    list.innerHTML = takers.length ? takers.map((entry) => `
      <tr>
        <td>${renderLoanPortfolioMemberCell(entry.member)}</td>
        <td>${entry.totalApplications || 0}</td>
        <td>$${Number(entry.totalBorrowed || 0).toFixed(2)}</td>
        <td>$${Number(entry.totalOutstanding || 0).toFixed(2)}</td>
        <td>${entry.lastLoanDate ? new Date(entry.lastLoanDate).toLocaleDateString() : '-'}</td>
        <td>${formatLoanStatusBadge(entry.lastLoanStatus)}</td>
        <td>${renderLoanPortfolioActions(entry.memberId, { showPayment: Number(entry.totalOutstanding || 0) > 0 })}</td>
      </tr>
    `).join('') : '<tr><td colspan="7">No loan takers yet.</td></tr>';
  } catch (error) {
    list.innerHTML = '<tr><td colspan="7">Unable to load loan takers.</td></tr>';
  }
}

async function loadActiveBorrowers() {
  const list = document.getElementById('loanActiveBorrowersList');
  if (!list) {
    return;
  }

  const monthFilter = document.getElementById('loanActiveBorrowerMonthFilter')?.value || '';
  const params = new URLSearchParams();
  if (monthFilter) {
    params.set('monthlyStatus', monthFilter);
  }

  try {
    const response = await fetch(`/api/loans/admin/active-borrowers?${params.toString()}`);
    const data = response.ok ? await response.json() : { borrowers: [] };
    const borrowers = data.borrowers || [];

    list.innerHTML = borrowers.length ? borrowers.map((entry) => `
      <tr>
        <td>${renderLoanPortfolioMemberCell(entry.member)}</td>
        <td>$${Number(entry.totalOutstanding || 0).toFixed(2)}</td>
        <td>$${Number(entry.totalRepaid || 0).toFixed(2)}</td>
        <td>${formatMonthlyPaymentBadge(entry)}</td>
        <td>${entry.lastPaymentDate
          ? `$${Number(entry.lastPaymentAmount || 0).toFixed(2)}<br><small>${new Date(entry.lastPaymentDate).toLocaleDateString()}</small>`
          : 'No payment yet'
        }</td>
        <td>${entry.lastLoanDate ? new Date(entry.lastLoanDate).toLocaleDateString() : '-'}</td>
        <td>${formatLoanTypeLabel(entry.lastLoanType)}</td>
        <td>${renderLoanPortfolioActions(entry.memberId, { showPayment: true })}</td>
      </tr>
    `).join('') : `<tr><td colspan="8">${monthFilter === 'paid'
      ? 'No active borrowers paid this month yet.'
      : monthFilter === 'not_paid'
        ? 'All active borrowers paid this month.'
        : 'No active borrowers right now.'
    }</td></tr>`;
  } catch (error) {
    list.innerHTML = '<tr><td colspan="8">Unable to load active borrowers.</td></tr>';
  }
}

async function refreshLoanPortfolioData() {
  await Promise.all([
    loadLoanPortfolioSummary(),
    loadLoanTakers(),
    loadActiveBorrowers(),
  ]);
}

function formatLoanMaxEligible(loan = {}) {
  if (loan.loanType === 'emergency') {
    return 'Unlimited';
  }
  return `$${Number(loan.maxEligibleAmount || 0).toFixed(2)}`;
}

function buildLoanDocumentLinks(documents = []) {
  if (!documents.length) {
    return '<span class="member-profile-meta-pill">No documents</span>';
  }
  return documents.map((doc) => `
    <a href="${doc.filePath}" class="receipt-button" target="_blank" rel="noopener">${doc.originalName || 'Document'}</a>
  `).join(' ');
}

function buildLoanReviewHtml(loan = {}) {
  const member = loan.member || {};
  return `
    <div class="member-profile-shell">
      <section class="panel-card">
        <h3>${formatLoanTypeLabel(loan.loanType)} Loan — <button type="button" class="member-loan-hub-link" data-member-id="${member._id || ''}">${member.name || 'Unknown'}</button></h3>
        <div class="member-profile-meta">
          <span class="member-profile-meta-pill">Amount: $${Number(loan.amount || 0).toFixed(2)}</span>
          <span class="member-profile-meta-pill">Savings: $${Number(loan.memberSavingsAtApply || member.savings || 0).toFixed(2)}</span>
          <span class="member-profile-meta-pill">Max Eligible (80%): ${loan.loanType === 'emergency' ? 'Unlimited' : `$${Number(loan.maxEligibleAmount || 0).toFixed(2)}`}</span>
          <span class="member-profile-meta-pill">Status: ${loan.status}</span>
          ${loan.paymentMethod ? `<span class="member-profile-meta-pill">Payment: ${formatPaymentMethodLabel(loan.paymentMethod)}</span>` : ''}
          ${loan.autoRejected ? '<span class="status-badge status-fail">Auto-rejected</span>' : ''}
        </div>
        <p class="table-subtitle"><strong>Reason:</strong> ${loan.reason || '-'}</p>
        <p class="table-subtitle"><strong>Witness:</strong> ${loan.witnessName || '-'} (${loan.witnessPhone || '-'}) — ${loan.witnessRelation || 'N/A'}</p>
        ${loan.rejectionReason ? `<p class="table-subtitle"><strong>Rejection:</strong> ${loan.rejectionReason}</p>` : ''}
        ${loan.adminNote ? `<p class="table-subtitle"><strong>Admin Note:</strong> ${loan.adminNote}</p>` : ''}
        ${loan.contractPath ? `<p class="table-subtitle"><a href="/api/loans/admin/${loan._id}/contract" class="receipt-button" target="_blank" rel="noopener">Download Contract PDF</a>${loan.signedContractPath ? ` <a href="${loan.signedContractPath}" class="receipt-button" target="_blank" rel="noopener">View Signed Copy</a>` : ''}</p>` : ''}
      </section>
      <section class="panel-card">
        <h3>Supporting Documents</h3>
        <div class="member-profile-meta">${buildLoanDocumentLinks(loan.documents)}</div>
      </section>
      ${loan.status === 'pending' && !loan.autoRejected ? `
        <section class="panel-card">
          <h3>Review Decision</h3>
          <div class="form-group">
            <label>Payment Method (required for approval)
              <select id="loanReviewPaymentMethod">
                <option value="">Select payment method</option>
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="mobile_banking">Mobile Banking</option>
                <option value="check">Check</option>
                <option value="other">Other</option>
              </select>
            </label>
          </div>
          <div class="form-group">
            <label>Admin Note <input type="text" id="loanReviewAdminNote" placeholder="Optional note for member" /></label>
          </div>
          <div class="member-status-actions">
            <button type="button" class="primary-btn" data-loan-review-action="approved" data-loan-id="${loan._id}">Approve Loan</button>
            <button type="button" class="secondary-btn" data-loan-review-action="rejected" data-loan-id="${loan._id}">Reject Loan</button>
          </div>
          <p class="message" id="loanReviewMessage"></p>
        </section>
      ` : ''}
      ${loan.status === 'approved' ? buildLoanDisbursementFormHtml(loan) : ''}
      ${loan.status === 'disbursed' ? buildLoanDisbursementDetailsHtml(loan) : ''}
    </div>
  `;
}

async function openLoanReviewModal(loanId) {
  const modal = document.getElementById('loanReviewModal');
  const content = document.getElementById('loanReviewContent');
  if (!modal || !content) return;

  content.innerHTML = '<p class="table-subtitle">Loading loan details...</p>';
  modal.classList.remove('hidden');

  try {
    const response = await fetch(`/api/loans/admin/${loanId}`);
    const data = await response.json();
    if (!response.ok) {
      content.innerHTML = '<p class="table-subtitle">Unable to load loan application.</p>';
      return;
    }
    content.innerHTML = buildLoanReviewHtml(data.loan);
  } catch (error) {
    content.innerHTML = '<p class="table-subtitle">Unable to load loan application.</p>';
  }
}

function bindLoanReviewUi() {
  const closeBtn = document.getElementById('closeLoanReviewModal');
  const modal = document.getElementById('loanReviewModal');
  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        modal.classList.add('hidden');
      }
    });
  }

  const statusFilter = document.getElementById('loanFilterStatus');
  const typeFilter = document.getElementById('loanFilterType');
  const refreshBtn = document.getElementById('refreshLoanApplicationsBtn');
  if (statusFilter) statusFilter.addEventListener('change', () => void loadLoanApplications());
  if (typeFilter) typeFilter.addEventListener('change', () => void loadLoanApplications());
  if (refreshBtn) refreshBtn.addEventListener('click', () => void loadLoanApplications());

  document.addEventListener('submit', async (event) => {
    const disburseForm = event.target.closest('.loan-disbursement-form');
    if (!disburseForm) {
      return;
    }

    event.preventDefault();
    const loanId = disburseForm.dataset.loanId;
    const messageEl = disburseForm.querySelector('.loan-disbursement-message');
    const formData = new FormData(disburseForm);
    const paymentMethod = formData.get('paymentMethod') || '';

    if (!paymentMethod) {
      if (messageEl) {
        messageEl.classList.add('error');
        messageEl.textContent = 'Please select a transfer method.';
      }
      return;
    }

    try {
      const response = await fetch(`/api/loans/admin/${loanId}/disburse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentMethod,
          transferReference: formData.get('transferReference') || '',
          disbursementNote: formData.get('disbursementNote') || '',
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (messageEl) {
          messageEl.classList.add('error');
          messageEl.textContent = data.error || 'Unable to disburse loan.';
        }
        return;
      }

      if (messageEl) {
        messageEl.classList.remove('error');
        messageEl.classList.add('success');
        messageEl.textContent = `Transfer of $${Number(data.loan?.amount || 0).toFixed(2)} recorded. Member can now see it on their panel.`;
      }

      if (modal && !modal.classList.contains('hidden')) {
        await openLoanReviewModal(loanId);
      }

      const profileModal = document.getElementById('memberProfileModal');
      if (profileModal && !profileModal.classList.contains('hidden') && data.loan?.member) {
        const memberId = data.loan.member._id || data.loan.member;
        await openMemberProfile(memberId, { activeTab: 'loans' });
      }

      await loadLoanApplications();
      await refreshLoanPortfolioData();
    } catch (error) {
      if (messageEl) {
        messageEl.classList.add('error');
        messageEl.textContent = 'Unable to disburse loan.';
      }
    }
  });

  document.addEventListener('click', async (event) => {
    const memberHubLink = event.target.closest('.member-loan-hub-link');
    if (memberHubLink?.dataset?.memberId) {
      if (modal) modal.classList.add('hidden');
      await openMemberLoanHub(memberHubLink.dataset.memberId);
      return;
    }

    const reviewBtn = event.target.closest('[data-loan-review]');
    if (reviewBtn) {
      await openLoanReviewModal(reviewBtn.dataset.loanReview);
      return;
    }

    const actionBtn = event.target.closest('[data-loan-review-action]');
    if (actionBtn) {
      const loanId = actionBtn.dataset.loanId;
      const status = actionBtn.dataset.loanReviewAction;
      const noteInput = document.getElementById('loanReviewAdminNote');
      const paymentInput = document.getElementById('loanReviewPaymentMethod');
      const messageEl = document.getElementById('loanReviewMessage');
      const adminNote = noteInput?.value?.trim() || (status === 'rejected' ? window.prompt('Rejection reason:', '') || '' : '');
      const paymentMethod = paymentInput?.value || '';

      if (status === 'approved' && !paymentMethod) {
        if (messageEl) {
          messageEl.classList.add('error');
          messageEl.textContent = 'Please select a payment method before approving.';
        }
        return;
      }

      const response = await fetch(`/api/loans/admin/${loanId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, adminNote, paymentMethod }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (messageEl) {
          messageEl.classList.add('error');
          messageEl.textContent = data.error || 'Unable to update loan.';
        }
        return;
      }
      if (modal && status === 'approved') {
        await openLoanReviewModal(loanId);
      } else if (modal) {
        modal.classList.add('hidden');
      }
      await loadLoanApplications();
      await refreshLoanPortfolioData();
    }
  });
}

async function loadLoanApplications() {
  const list = document.getElementById('loanApplicationsList');
  if (!list) return;

  const status = document.getElementById('loanFilterStatus')?.value || '';
  const loanType = document.getElementById('loanFilterType')?.value || '';
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (loanType) params.set('loanType', loanType);

  try {
    const response = await fetch(`/api/loans/admin?${params.toString()}`);
    const data = await response.json();
    const loans = data.loans || [];
    list.innerHTML = loans.length ? loans.map((loan) => `
      <tr>
        <td>
          <button type="button" class="member-loan-hub-link" data-member-id="${loan.member?._id || ''}">${loan.member?.name || 'Unknown'}</button>
          <br><small>${loan.member?.email || ''}</small>
        </td>
        <td>${formatLoanTypeLabel(loan.loanType)}</td>
        <td>$${Number(loan.amount || 0).toFixed(2)}</td>
        <td>$${Number(loan.memberSavingsAtApply || loan.member?.savings || 0).toFixed(2)}<br><small>Max: ${formatLoanMaxEligible(loan)}</small></td>
        <td>${loan.reason || '-'}</td>
        <td>${loan.witnessName || '-'}<br><small>${loan.witnessPhone || ''}</small></td>
        <td>${formatLoanStatusBadge(loan.status)}${loan.autoRejected ? '<br><small>Auto-rejected</small>' : ''}${loan.status === 'disbursed' ? `<br><small>Outstanding: $${Number(loan.outstandingBalance ?? loan.amount ?? 0).toFixed(2)}</small>` : ''}${loan.status === 'approved' ? '<br><small>Awaiting transfer</small>' : ''}</td>
        <td>${loan.status === 'disbursed'
          ? `$${Number(loan.amount || 0).toFixed(2)} via ${formatPaymentMethodLabel(loan.paymentMethod)}${loan.disbursedAt ? `<br><small>${new Date(loan.disbursedAt).toLocaleString()}</small>` : ''}`
          : loan.status === 'approved'
            ? '<span class="status-badge status-pending">Pending Transfer</span>'
            : '-'
        }</td>
        <td>${new Date(loan.createdAt).toLocaleString()}</td>
        <td>
          <button class="secondary-btn" data-loan-review="${loan._id}">Review</button>
        </td>
      </tr>
    `).join('') : '<tr><td colspan="10">No loan applications yet.</td></tr>';
  } catch (error) {
    list.innerHTML = '<tr><td colspan="10">Unable to load loan applications.</td></tr>';
  }
}

function formatRepaymentStatusBadge(status = 'pending') {
  if (status === 'approved') {
    return '<span class="status-badge status-completed">Approved</span>';
  }
  if (status === 'rejected') {
    return '<span class="status-badge status-fail">Rejected</span>';
  }
  return '<span class="status-badge status-pending">Pending</span>';
}

async function loadLoanRepayments() {
  const list = document.getElementById('loanRepaymentsList');
  if (!list) return;

  const status = document.getElementById('loanRepaymentFilterStatus')?.value || '';
  const params = new URLSearchParams();
  if (status) params.set('status', status);

  try {
    const response = await fetch(`/api/loans/admin/repayments?${params.toString()}`);
    const data = await response.json();
    const repayments = data.repayments || [];
    list.innerHTML = repayments.length ? repayments.map((item) => `
      <tr>
        <td>${item.member?.name || 'Unknown'}<br><small>${item.member?.email || ''}</small></td>
        <td>${formatLoanTypeLabel(item.loan?.loanType)}<br><small>$${Number(item.loan?.amount || 0).toFixed(2)}</small></td>
        <td>$${Number(item.amount || 0).toFixed(2)}</td>
        <td>${item.repaymentType === 'full' ? 'Full' : 'Installment'}</td>
        <td>${formatPaymentMethodLabel(item.paymentMethod)}</td>
        <td>$${Number(item.loan?.outstandingBalance ?? item.balanceBefore ?? 0).toFixed(2)}</td>
        <td>${formatRepaymentStatusBadge(item.status)}</td>
        <td>${new Date(item.createdAt).toLocaleString()}</td>
        <td>
          ${item.status === 'pending' ? `
            <button type="button" class="primary-btn" data-loan-repayment-action="approved" data-loan-repayment-id="${item._id}">Approve</button>
            <button type="button" class="secondary-btn" data-loan-repayment-action="rejected" data-loan-repayment-id="${item._id}">Reject</button>
          ` : ''}
          ${item.status === 'approved' && item.receiptPath ? `<a href="/api/loans/admin/repayments/${item._id}/receipt" class="receipt-button" target="_blank" rel="noopener">Receipt</a>` : ''}
        </td>
      </tr>
    `).join('') : '<tr><td colspan="9">No loan repayment requests yet.</td></tr>';
  } catch (error) {
    list.innerHTML = '<tr><td colspan="9">Unable to load loan repayments.</td></tr>';
  }
}

async function updateLoanRepayment(repaymentId, status) {
  const adminNote = status === 'rejected' ? window.prompt('Rejection note (optional):', '') || '' : '';
  const response = await fetch(`/api/loans/admin/repayments/${repaymentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, adminNote }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    window.alert(data.error || 'Unable to update loan repayment.');
    return;
  }
  await loadLoanRepayments();
  await loadLoanApplications();
  await refreshLoanPortfolioData();
  await loadDashboardSnapshot();
}

function bindLoanRepaymentAdminUi() {
  const statusFilter = document.getElementById('loanRepaymentFilterStatus');
  const refreshBtn = document.getElementById('refreshLoanRepaymentsBtn');
  if (statusFilter) statusFilter.addEventListener('change', () => void loadLoanRepayments());
  if (refreshBtn) refreshBtn.addEventListener('click', () => void loadLoanRepayments());

  document.addEventListener('click', async (event) => {
    const actionBtn = event.target.closest('[data-loan-repayment-action]');
    if (!actionBtn) return;
    const repaymentId = actionBtn.dataset.loanRepaymentId;
    const status = actionBtn.dataset.loanRepaymentAction;
    if (!repaymentId || !status) return;
    await updateLoanRepayment(repaymentId, status);
  });
}

async function updateLoanApplication(loanId, status) {
  const adminNote = status === 'rejected' ? window.prompt('Rejection note (optional):', '') || '' : '';
  const response = await fetch(`/api/loans/admin/${loanId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, adminNote }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    window.alert(data.error || 'Unable to update loan application.');
    return;
  }
  await loadLoanApplications();
  await refreshLoanPortfolioData();
}

async function loadAdminNotifications({ openPanel = false } = {}) {
  const list = document.getElementById('adminNotificationList');
  const badge = document.getElementById('adminNotificationBadge');
  const panel = document.getElementById('adminNotificationPanel');
  if (!openPanel) {
    return;
  }

  if (list) {
    list.innerHTML = '<p class="table-subtitle">Loading notifications...</p>';
  }

  try {
    const response = await fetch('/api/admin/notifications');
    if (!response.ok) return;
    const data = await response.json();
    const notifications = data.notifications || [];
    const unreadCount = data.unreadCount || 0;
    if (badge) {
      badge.textContent = unreadCount;
      badge.classList.toggle('hidden', unreadCount === 0);
    }
    const snapshotUnreadAlerts = document.getElementById('snapshotUnreadAlerts');
    if (snapshotUnreadAlerts) {
      snapshotUnreadAlerts.textContent = unreadCount;
    }
    if (list) {
      list.innerHTML = notifications.length ? notifications.map((item) => `
        <button type="button" class="notification-item ${item.read ? '' : 'notification-item-unread'}" data-notification-id="${item._id}">
          <strong>${item.title}</strong>
          <span>${item.message}</span>
          <small>${new Date(item.createdAt).toLocaleString()}</small>
        </button>
      `).join('') : '<p class="table-subtitle">No notifications yet.</p>';
    }
    if (panel) {
      panel.classList.remove('hidden');
      panel.hidden = false;
    }
  } catch (error) {
    if (list) list.innerHTML = '<p class="table-subtitle">Unable to load notifications.</p>';
  }
}

function bindAdminNotificationUi() {
  const btn = document.getElementById('adminNotificationBtn');
  const panel = document.getElementById('adminNotificationPanel');
  const markAllBtn = document.getElementById('markAllNotificationsReadBtn');
  const snapshotOpenBtn = document.getElementById('snapshotOpenNotificationsBtn');

  const openNotifications = () => {
    void loadAdminNotifications({ openPanel: true });
  };

  if (btn && panel) {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      if (panel.classList.contains('hidden')) {
        openNotifications();
      } else {
        panel.classList.add('hidden');
        panel.hidden = true;
      }
    });
  }

  if (snapshotOpenBtn) {
    snapshotOpenBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      openNotifications();
    });
  }

  document.addEventListener('click', (event) => {
    if (!panel || panel.classList.contains('hidden')) {
      return;
    }
    if (!panel.contains(event.target) && event.target !== btn && event.target !== snapshotOpenBtn) {
      panel.classList.add('hidden');
      panel.hidden = true;
    }
  });

  if (markAllBtn) {
    markAllBtn.addEventListener('click', async () => {
      await fetch('/api/admin/notifications/read-all', { method: 'PATCH' });
      await loadAdminNotifications({ openPanel: true });
    });
  }

  document.addEventListener('click', async (event) => {
    const item = event.target.closest('[data-notification-id]');
    if (!item || !panel || panel.classList.contains('hidden')) return;
    await fetch(`/api/admin/notifications/${item.dataset.notificationId}/read`, { method: 'PATCH' });
    await loadAdminNotifications({ openPanel: true });
  });
}

async function loadPendingKycDocuments() {
  const list = document.getElementById('pendingKycList');
  if (!list) return;
  try {
    const response = await fetch('/api/kyc/admin/pending');
    const data = await response.json();
    const documents = data.documents || [];
    list.innerHTML = documents.length ? documents.map((doc) => `
      <tr>
        <td>${doc.member?.name || 'Unknown'}</td>
        <td><a href="${doc.filePath}" target="_blank" rel="noopener">${doc.originalName || 'Document'}</a></td>
        <td>${doc.documentType}</td>
        <td>${doc.status}</td>
        <td>${new Date(doc.createdAt).toLocaleString()}</td>
        <td>
          <button class="secondary-btn" data-kyc-action="verified" data-kyc-id="${doc._id}">Verify</button>
          <button class="secondary-btn" data-kyc-action="rejected" data-kyc-id="${doc._id}">Reject</button>
        </td>
      </tr>
    `).join('') : '<tr><td colspan="6">No pending KYC documents.</td></tr>';
  } catch (error) {
    list.innerHTML = '<tr><td colspan="6">Unable to load KYC documents.</td></tr>';
  }
}

async function reviewKycDocument(documentId, status) {
  const adminNote = status === 'rejected' ? window.prompt('Rejection note (optional):', '') || '' : '';
  const response = await fetch(`/api/kyc/admin/${documentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, adminNote }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    window.alert(data.error || 'Unable to review KYC document.');
    return;
  }
  await loadPendingKycDocuments();
}

function bindDividendUi() {
  const previewBtn = document.getElementById('previewDividendBtn');
  const form = document.getElementById('dividendPreviewForm');
  const previewBody = document.getElementById('dividendPreviewBody');
  const messageEl = document.getElementById('dividendMessage');
  const amountInput = document.getElementById('dividendPoolAmount');

  if (previewBtn) {
    previewBtn.addEventListener('click', async () => {
      const totalAmount = Number(amountInput?.value || 0);
      if (!totalAmount || totalAmount <= 0) return;
      const response = await fetch('/api/admin/profit/dividend/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ totalAmount }),
      });
      const data = await response.json();
      if (!response.ok || !previewBody) return;
      previewBody.innerHTML = (data.preview || []).map((row) => `
        <tr>
          <td>${row.memberName}</td>
          <td>$${Number(row.savings || 0).toFixed(2)}</td>
          <td>$${Number(row.profit || 0).toFixed(2)}</td>
          <td>${Number(row.weight || 0).toFixed(2)}</td>
          <td>$${Number(row.dividendShare || 0).toFixed(2)}</td>
        </tr>
      `).join('') || '<tr><td colspan="5">No active members found.</td></tr>';
    });
  }

  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const totalAmount = Number(amountInput?.value || 0);
      if (messageEl) {
        messageEl.textContent = '';
        messageEl.classList.remove('success', 'error');
      }
      const response = await fetch('/api/admin/profit/dividend/distribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ totalAmount, notes: 'Automatic dividend distribution' }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (messageEl) {
          messageEl.classList.add('error');
          messageEl.textContent = data.error || 'Unable to distribute dividend.';
        }
        return;
      }
      if (messageEl) {
        messageEl.classList.add('success');
        messageEl.textContent = 'Dividend distributed successfully.';
      }
      await fetchMembers();
      await loadProfitHistory();
    });
  }
}

document.addEventListener('click', async (event) => {
  const pdfButton = event.target.closest('[data-pdf-preview]');
  if (pdfButton) {
    event.preventDefault();
    const url = pdfButton.dataset.pdfPreview;
    const title = pdfButton.dataset.pdfTitle || 'Investment Receipt';
    if (url) {
      void openPdfPreview(url, title);
    }
    return;
  }

  const iouDeleteButton = event.target.closest('[data-iou-delete]');
  if (iouDeleteButton) {
    event.preventDefault();
    await deleteInvestmentIou(iouDeleteButton.dataset.iouDelete);
    return;
  }

  const actionButton = event.target.closest('[data-action]');
  if (actionButton) {
    const { action, id } = actionButton.dataset;
    if (action === 'approve') {
      await updateWithdrawalRequest(id, 'approved');
    }
    if (action === 'process') {
      await updateWithdrawalRequest(id, 'processed');
    }
    return;
  }

  const loanButton = event.target.closest('[data-loan-action]');
  if (loanButton) {
    await updateLoanApplication(loanButton.dataset.loanId, loanButton.dataset.loanAction);
    return;
  }

  const kycButton = event.target.closest('[data-kyc-action]');
  if (kycButton) {
    await reviewKycDocument(kycButton.dataset.kycId, kycButton.dataset.kycAction);
    return;
  }

  const searchLink = event.target.closest('.search-member-link');
  if (searchLink) {
    const { memberId } = searchLink.dataset;
    if (memberId) {
      history.pushState({}, '', `/members/${memberId}`);
      void renderMemberDirectoryDetail(memberId);
    }
    if (searchMemberDetails) {
      searchMemberDetails.classList.add('hidden');
    }
    return;
  }
});

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  bindSidebarControls();
  bindDashboardQuickNav();
  bindDashboardNavList();
  bindDashboardNotes();
  bindMemberListTabs();
  bindAdminDashboardCards();
  bindAdminNotificationUi();
  bindDividendUi();
  bindLoanReviewUi();
  bindLoanRepaymentAdminUi();
  bindLoanListTabs();
  bindAdminMessagesPage();
  bindMonthlyContributionDashboard();
  bindMonthlyTargetForm();
  bindInvestorPmNavigation();
  renderMembersDirectory([], true);

  const bootAdmin = async () => {
    await loadAdminProfile();
    if (!window.adminSessionUser) return;
    if (window.adminSessionUser.role === 'developer') {
      window.location.href = '/user-management';
      return;
    }
    const hashPage = (window.location.hash || '').replace(/^#/, '');

    if (hashPage === 'developer') {
      window.location.href = '/user-management';
      return;
    }

    if (hashPage === 'ceo') {
      if (canOpenOpsPage('ceo')) {
        navigateToPage(hashPage);
      } else {
        navigateToPage(firstAllowedOpsPage());
      }
      return;
    }

    if (hashPage && canOpenOpsPage(hashPage)) {
      navigateToPage(hashPage);
      return;
    }

    if (!handleAdminDeepLink()) {
      const isStaff = !['ceo', 'admin'].includes(window.adminSessionUser.role);
      navigateToPage(isStaff ? firstAllowedOpsPage() : currentPage);
    }
  };
  void bootAdmin();

  // Critical dashboard data only — everything else waits for idle time
  void fetchSummary();
  void fetchMembers();

  document.getElementById('selfPasswordForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const msg = document.getElementById('selfPasswordMessage');
    msg.textContent = '';
    const formData = new FormData(event.target);
    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: formData.get('currentPassword'),
          newPassword: formData.get('newPassword'),
        }),
        skipPasswordConfirm: true,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to update password.');
      msg.textContent = data.message || 'Password updated.';
      event.target.reset();
    } catch (error) {
      msg.textContent = error.message;
    }
  });

  const deferSecondaryLoads = () => {
    void fetchDepositHistory();
    void loadMonthlyContributionDashboard();
    void loadMonthlyTargetsUi();
    void refreshLoanPortfolioData();
    void loadDashboardSnapshot();
    void loadNotices();
    void loadInvestments();
    void loadInvestmentIous();
    void loadProfitHistory();
    void loadInvestmentProfitHistory();
    void loadWithdrawalRequests();
    void loadLoanApplications();
    void loadLoanRepayments();
  };

  if (window.requestIdleCallback) {
    window.requestIdleCallback(deferSecondaryLoads, { timeout: 2000 });
  } else {
    window.setTimeout(deferSecondaryLoads, 400);
  }

  window.addEventListener('themechange', () => {
    initializeDepositChart(lastSummaryData);
  });
});
