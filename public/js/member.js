const logoutBtn = document.getElementById('logoutBtn');
const memberName = document.getElementById('memberName');
const fullName = document.getElementById('fullName');
const memberEmail = document.getElementById('memberEmail');
const memberRole = document.getElementById('memberRole');
const memberSavings = document.getElementById('memberSavings');
const memberProfit = document.getElementById('memberProfit');
const investmentValue = document.getElementById('investmentValue');
const totalWithdrawn = document.getElementById('totalWithdrawn');
const totalMembers = document.getElementById('totalMembers');
const userInitial = document.getElementById('userInitial');
const memberJoined = document.getElementById('memberJoined');
const monthlyAllocation = document.getElementById('monthlyAllocation');
const lastDistribution = document.getElementById('lastDistribution');
const distributionRate = document.getElementById('distributionRate');
const profitHistoryTableBody = document.getElementById('profitHistoryTableBody');
const memberActiveInvestmentsBody = document.getElementById('memberActiveInvestmentsBody');
const memberSoldInvestmentsBody = document.getElementById('memberSoldInvestmentsBody');
const memberActiveCount = document.getElementById('memberActiveCount');
const memberSoldCount = document.getElementById('memberSoldCount');
const memberTotalSavings = document.getElementById('memberTotalSavings');
const memberTotalInvested = document.getElementById('memberTotalInvested');
const memberDetailTitle = document.getElementById('memberDetailTitle');
const memberDetailSubtitle = document.getElementById('memberDetailSubtitle');
const memberDetailHead = document.getElementById('memberDetailHead');
const memberDetailBody = document.getElementById('memberDetailBody');
const withdrawalForm = document.getElementById('withdrawalForm');
const withdrawalMessage = document.getElementById('withdrawalMessage');
const withdrawalTableBody = document.getElementById('withdrawalTableBody');
const refundTableBody = document.getElementById('refundTableBody');
const sidebarMemberStatus = document.getElementById('sidebarMemberStatus');
const accountStatus = document.getElementById('accountStatus');
const duesAlert = document.getElementById('duesAlert');
const noticeBoard = document.getElementById('noticeBoard');
const profitUpdateAlert = document.getElementById('profitUpdateAlert');
let currentUser = null;
let lastKnownProfit = null;
let memberFinancialData = {
  deposits: [],
  profitHistory: [],
  investments: [],
  activeInvestments: [],
  soldInvestments: [],
  withdrawalRequests: [],
  refunds: [],
};
let activeMemberReportType = null;

// Sidebar Navigation
const memberPageTitles = {
  dashboard: ['Dashboard', 'Welcome back! Track your savings, investments, and profits.'],
  investments: ['Investments', 'View all society investments and receipts.'],
  'investment-requests': ['Investment Requests', 'Review and approve new investment proposals.'],
  portfolio: ['Portfolio', 'Track your savings and investment progress.'],
  withdrawals: ['Withdrawals', 'Submit and track your withdrawal requests.'],
  refunds: ['Refunds', 'Track refund status for returned deposits.'],
  loans: ['Loans', 'Apply for society loans and track approval status.'],
  messages: ['Messages', 'Chat directly with the society admin office.'],
  documents: ['Documents', 'Complete digital KYC and upload onboarding documents.'],
  settings: ['Settings', 'Manage your account preferences.'],
};

function updateMemberPageContent(page) {
  const pageTitle = document.getElementById('pageTitle');
  const pageNote = document.getElementById('pageNote');
  const meta = memberPageTitles[page] || memberPageTitles.dashboard;
  if (pageTitle) {
    pageTitle.textContent = meta[0];
  }
  if (pageNote) {
    pageNote.textContent = meta[1];
  }
}

function navigateMemberPage(page) {
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.getAttribute('data-page') === page);
  });
  document.querySelectorAll('.page-section').forEach((section) => {
    section.classList.toggle('active', section.getAttribute('data-page-section') === page);
  });
  updateMemberPageContent(page);
  if (page === 'loans' || page === 'dashboard') {
    void loadLoanEligibility();
    void loadOutstandingLoanSummary();
    if (page === 'loans') {
      void loadLoanApplications();
      void loadLoanRepayments();
    }
    if (page === 'dashboard') {
      void loadLoanDashboardSummary();
      void loadMemberInvestmentRequests();
    }
  }
  if (page === 'investment-requests') {
    void loadMemberInvestmentRequests();
  }
  if (page === 'messages') {
    void loadMemberChat();
  } else {
    stopMemberChatPolling();
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

document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const page = item.getAttribute('data-page');
    if (page) {
      navigateMemberPage(page);
      closeSidebar();
    }
  });
});

function renderMemberSelfProfile(user = {}) {
  const card = document.getElementById('memberSelfProfileCard');
  if (!card || !user) {
    return;
  }

  const avatarUrl = user.profilePicture || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || 'Member')}&background=6366f1&color=fff&size=128`;
  const memberCode = user._id ? String(user._id).slice(-6).toUpperCase() : '------';
  const joinedDate = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : '--';

  card.innerHTML = `
    <div class="member-self-profile-shell">
      <div class="member-self-profile-top">
        <img src="${avatarUrl}" alt="${user.name || 'Member'}" />
        <div>
          <p class="member-profile-eyebrow">My Profile · ${memberCode}</p>
          <h2 style="margin:0;">${user.name || 'Member'}</h2>
          <p class="table-subtitle">${user.email || ''}</p>
          <div class="member-profile-meta" style="margin-top:0.65rem;">
            <span class="member-profile-meta-pill">Joined ${joinedDate}</span>
            <span class="member-profile-meta-pill">${user.kycStatus ? `KYC ${user.kycStatus}` : 'KYC pending'}</span>
          </div>
        </div>
      </div>
      <div class="member-self-profile-stats">
        <div class="member-self-stat">
          <span>Savings</span>
          <strong id="memberSelfSavings">$${Number(user.savings || 0).toFixed(2)}</strong>
        </div>
        <div class="member-self-stat">
          <span>Profit</span>
          <strong id="memberSelfProfit">$${Number(user.profit || 0).toFixed(2)}</strong>
        </div>
        <div class="member-self-stat">
          <span>Status</span>
          <strong>${(user.status || 'active') === 'active' ? 'Active' : 'Inactive'}</strong>
        </div>
        <div class="member-self-stat">
          <span>Phone</span>
          <strong>${user.phone || 'Not provided'}</strong>
        </div>
      </div>
    </div>
  `;
}

async function loadProfile() {
  const selfCard = document.getElementById('memberSelfProfileCard');
  try {
    const response = await fetch('/api/member/profile');
    if (!response.ok) {
      if (selfCard) {
        selfCard.innerHTML = '<p class="table-subtitle">Unable to load your profile. Please refresh or sign in again.</p>';
      }
      window.location.href = '/';
      return;
    }
    const data = await response.json();
    const user = data.member;
    currentUser = user;

    // Update UI elements
    memberName.textContent = user.name;
    fullName.textContent = user.name;
    memberEmail.textContent = user.email;
    memberRole.textContent = user.role;
    updateMemberStatusDisplay(user.status || 'active');
    memberSavings.textContent = `$${Number(user.savings || 0).toFixed(2)}`;
    memberProfit.textContent = `$${Number(user.profit || 0).toFixed(2)}`;

    if (lastKnownProfit !== null && Number(user.profit) > Number(lastKnownProfit)) {
      const increase = Number(user.profit) - Number(lastKnownProfit);
      if (profitUpdateAlert) {
        profitUpdateAlert.classList.remove('hidden', 'error');
        profitUpdateAlert.classList.add('success');
        profitUpdateAlert.textContent = `New profit received! +$${increase.toFixed(2)} added to your account. Total profit: $${Number(user.profit || 0).toFixed(2)}`;
      }
    }
    lastKnownProfit = Number(user.profit || 0);
    
    // Set user initial
    userInitial.textContent = (user.name || 'M')[0].toUpperCase();
    const sidebarMemberName = document.getElementById('sidebarMemberName');
    const sidebarMemberInitial = document.getElementById('sidebarMemberInitial');
    if (sidebarMemberName) {
      sidebarMemberName.textContent = user.name || 'Member';
    }
    if (sidebarMemberInitial) {
      sidebarMemberInitial.textContent = (user.name || 'M')[0].toUpperCase();
    }
    
    // Format joined date
    const joinedDate = user.createdAt
      ? new Date(user.createdAt).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : '--';
    memberJoined.textContent = joinedDate;

    renderMemberSelfProfile(user);

    // Load additional financial data
    await loadFinancialData(user._id);
    void loadLoanEligibility();
  } catch (error) {
    console.error('Failed to load profile:', error);
    if (selfCard) {
      selfCard.innerHTML = '<p class="table-subtitle">Unable to load your profile (server may be offline). Refresh after the server is running.</p>';
    }
  }
}

function formatProfitSource(item) {
  if (item.source === 'investment-loss' || item.outcomeType === 'loss') {
    return 'Investment Loss';
  }
  if (item.source === 'investment') {
    return 'Investment Profit';
  }
  return 'General';
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

function formatLoanStatusBadge(status = 'pending') {
  if (status === 'approved' || status === 'disbursed') {
    return `<span class="status-badge status-completed">${status}</span>`;
  }
  if (status === 'rejected') {
    return '<span class="status-badge status-fail">Rejected</span>';
  }
  return '<span class="status-badge status-pending">Pending</span>';
}

function formatPaymentMethodLabel(method = '') {
  const labels = {
    cash: 'Cash',
    bank_transfer: 'Bank Transfer',
    mobile_banking: 'Mobile Banking',
    check: 'Check',
    other: 'Other',
  };
  return labels[method] || method || '-';
}

function buildLoanDisbursementReceivedHtml(loan = {}) {
  if (loan.status !== 'disbursed') {
    if (loan.status === 'approved') {
      return `
        <div class="loan-disbursement-banner loan-disbursement-pending">
          <strong>Loan Approved — Awaiting Transfer</strong>
          <p class="table-subtitle">
            Your ${formatLoanTypeLabel(loan.loanType)} loan of $${Number(loan.amount || 0).toFixed(2)} is approved.
            The society admin will transfer the money to you soon${loan.paymentMethod ? ` via ${formatPaymentMethodLabel(loan.paymentMethod)}` : ''}.
          </p>
        </div>
      `;
    }
    return '';
  }

  return `
    <div class="loan-disbursement-banner loan-disbursement-received">
      <strong>Loan Money Received</strong>
      <p class="table-subtitle">
        You received <strong>$${Number(loan.amount || 0).toFixed(2)}</strong>
        via <strong>${formatPaymentMethodLabel(loan.paymentMethod)}</strong>
        ${loan.disbursedAt ? ` on ${new Date(loan.disbursedAt).toLocaleString()}` : ''}.
      </p>
      ${loan.disbursementReference ? `<p class="table-subtitle"><strong>Reference:</strong> ${loan.disbursementReference}</p>` : ''}
      ${loan.disbursementNote ? `<p class="table-subtitle"><strong>Note:</strong> ${loan.disbursementNote}</p>` : ''}
      ${loan.disbursedBy ? `<p class="table-subtitle"><strong>Processed by:</strong> ${loan.disbursedBy}</p>` : ''}
    </div>
  `;
}

function buildLoanDecisionText(loan = {}) {
  if (loan.rejectionReason) {
    return loan.rejectionReason;
  }
  if (loan.adminNote) {
    return loan.adminNote;
  }
  if (loan.autoRejected) {
    return 'Automatically rejected (exceeds 80% savings limit).';
  }
  if (loan.status === 'pending') {
    return 'Awaiting admin review.';
  }
  return '-';
}

function buildLoanContractActions(loan = {}) {
  if (!['approved', 'disbursed'].includes(loan.status) || !loan.contractPath) {
    return '-';
  }

  const downloadLink = `<a href="/api/loans/member/${loan._id}/contract" class="receipt-button" target="_blank" rel="noopener">Download</a>`;
  const signedStatus = loan.signedContractPath
    ? '<span class="status-badge status-completed">Signed copy submitted</span>'
    : `<label class="signed-contract-upload"><input type="file" accept=".pdf,.jpg,.jpeg,.png" data-signed-contract-loan="${loan._id}" hidden /><span class="secondary-btn">Upload Signed</span></label>`;

  return `${downloadLink} ${signedStatus}`;
}

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

function formatAccountStatus(status = 'active') {
  if (status === 'inactive') {
    return 'Inactive';
  }
  return 'Active';
}

function updateMemberStatusDisplay(status = 'active') {
  const label = formatAccountStatus(status);
  if (sidebarMemberStatus) {
    sidebarMemberStatus.textContent = `${label} Member`;
  }
  if (accountStatus) {
    accountStatus.textContent = label;
  }
}

function renderRefundRows(refunds = []) {
  if (!refunds.length) {
    return '<tr><td colspan="6">No refund records yet.</td></tr>';
  }

  return refunds.map((refund) => `
    <tr>
      <td>$${Number(refund.amount || 0).toFixed(2)}</td>
      <td>${refund.reason || '-'}</td>
      <td>${formatRefundStatusBadge(refund.status)}</td>
      <td>${refund.adminNote || '-'}</td>
      <td>${new Date(refund.createdAt).toLocaleString()}</td>
      <td>${refund.updatedAt ? new Date(refund.updatedAt).toLocaleString() : '-'}</td>
    </tr>
  `).join('');
}

async function loadRefunds() {
  try {
    const response = await fetch('/api/member/refunds');
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    memberFinancialData.refunds = data.refunds || [];
    if (refundTableBody) {
      refundTableBody.innerHTML = renderRefundRows(memberFinancialData.refunds);
    }
  } catch (error) {
    console.error('Failed to load refund history:', error);
    if (refundTableBody) {
      refundTableBody.innerHTML = '<tr><td colspan="6">Unable to load refund history.</td></tr>';
    }
  }
}

function formatProfitAmount(amount) {
  const value = Number(amount || 0);
  if (value < 0) {
    return `-$${Math.abs(value).toFixed(2)}`;
  }
  return `$${value.toFixed(2)}`;
}

async function loadFinancialData(userId) {
  try {
    const response = await fetch('/api/member/financial');
    if (response.ok) {
      const data = await response.json();
      memberFinancialData = {
        deposits: data.deposits || [],
        profitHistory: data.profitHistory || [],
        investments: data.investments || [],
        activeInvestments: data.activeInvestments || [],
        soldInvestments: data.soldInvestments || [],
        withdrawalRequests: data.withdrawalRequests || [],
        refunds: data.refunds || [],
      };

      const totalMembersCount = data.totalMembers || 1;
      totalMembers.textContent = totalMembersCount;
      investmentValue.textContent = `$${(data.totalInvestment || 0).toFixed(2)}`;
      totalWithdrawn.textContent = `$${(data.totalWithdrawn || 0).toFixed(2)}`;
      const monthlyProfit = data.monthlyProfit || 0;
      monthlyAllocation.textContent = `$${monthlyProfit.toFixed(2)}`;
      memberProfit.textContent = `$${Number(data.memberProfit || currentUser?.profit || 0).toFixed(2)}`;

      if (distributionRate) {
        distributionRate.textContent = 'Equal Share (Everyone Same)';
      }

      if (refundTableBody) {
        refundTableBody.innerHTML = renderRefundRows(memberFinancialData.refunds);
      }

      if (profitHistoryTableBody) {
        profitHistoryTableBody.innerHTML = memberFinancialData.profitHistory.map((item) => `
          <tr>
            <td>${formatProfitSource(item)}</td>
            <td>${item.investmentCode || '-'}</td>
            <td>${formatProfitAmount(item.amount)}</td>
            <td>$${Number(item.totalProfitAfter || 0).toFixed(2)}</td>
            <td>Equal Share</td>
            <td>${new Date(item.createdAt).toLocaleDateString()}</td>
          </tr>
        `).join('') || '<tr><td colspan="6">No profit distributions yet.</td></tr>';
      }

      if (activeMemberReportType) {
        renderMemberReport(activeMemberReportType);
      }

      if (duesAlert) {
        if (data.duesAlert?.isOverdue) {
          duesAlert.innerHTML = `<div class="status-fail">${data.duesAlert.message}</div>`;
        } else {
          duesAlert.innerHTML = '<div class="status-pass">Your dues are up to date.</div>';
        }
      }

      if (noticeBoard) {
        noticeBoard.innerHTML = (data.notices || []).map((notice) => `
          <div class="member-roster-item">
            <strong>${notice.title}</strong>
            <span>${notice.message}</span>
            <small>${new Date(notice.createdAt).toLocaleDateString()}</small>
          </div>
        `).join('');
      }
      
      if (data.lastDistribution) {
        const lastDate = new Date(data.lastDistribution).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
        lastDistribution.textContent = lastDate;
      } else {
        lastDistribution.textContent = 'Pending';
      }
    }
  } catch (error) {
    console.error('Failed to load financial data:', error);
    monthlyAllocation.textContent = '$0.00';
    lastDistribution.textContent = 'N/A';
  }
}

function setActiveMemberCard(reportType) {
  activeMemberReportType = reportType;
  document.querySelectorAll('.member-metric-card').forEach((card) => {
    const isActive = card.dataset.memberReportType === reportType;
    card.classList.toggle('active', isActive);
    card.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function renderSavingsReport() {
  const deposits = memberFinancialData.deposits || [];
  if (memberDetailTitle) {
    memberDetailTitle.textContent = 'Your Savings Activity';
  }
  if (memberDetailSubtitle) {
    memberDetailSubtitle.textContent = `${deposits.length} deposit record${deposits.length === 1 ? '' : 's'}`;
  }
  if (memberDetailHead) {
    memberDetailHead.innerHTML = `
      <tr>
        <th>Amount</th>
        <th>Date</th>
        <th>Running Total</th>
      </tr>
    `;
  }
  if (!memberDetailBody) {
    return;
  }
  if (!deposits.length) {
    memberDetailBody.innerHTML = '<tr><td colspan="3">No deposits recorded yet.</td></tr>';
    return;
  }

  let runningTotal = 0;
  memberDetailBody.innerHTML = deposits.map((deposit) => {
    runningTotal += Number(deposit.amount || 0);
    return `
      <tr>
        <td>$${Number(deposit.amount || 0).toFixed(2)}</td>
        <td>${new Date(deposit.createdAt).toLocaleString()}</td>
        <td>$${runningTotal.toFixed(2)}</td>
      </tr>
    `;
  }).join('');
}

function renderProfitReport() {
  const profitHistory = memberFinancialData.profitHistory || [];
  if (memberDetailTitle) {
    memberDetailTitle.textContent = 'Your Profit Share History';
  }
  if (memberDetailSubtitle) {
    memberDetailSubtitle.textContent = `${profitHistory.length} profit distribution${profitHistory.length === 1 ? '' : 's'}`;
  }
  if (memberDetailHead) {
    memberDetailHead.innerHTML = `
      <tr>
        <th>Source</th>
        <th>Investment ID</th>
        <th>Share Received</th>
        <th>Total Profit After</th>
        <th>Type</th>
        <th>Date</th>
      </tr>
    `;
  }
  if (!memberDetailBody) {
    return;
  }
  if (!profitHistory.length) {
    memberDetailBody.innerHTML = '<tr><td colspan="6">No profit distributions yet.</td></tr>';
    return;
  }

  memberDetailBody.innerHTML = profitHistory.map((item) => `
    <tr>
      <td>${formatProfitSource(item)}</td>
      <td>${item.investmentCode || '-'}</td>
      <td>${formatProfitAmount(item.amount)}</td>
      <td>$${Number(item.totalProfitAfter || 0).toFixed(2)}</td>
      <td>Equal Share</td>
      <td>${new Date(item.createdAt).toLocaleString()}</td>
    </tr>
  `).join('');
}

function renderInvestmentsReport() {
  const activeInvestments = memberFinancialData.activeInvestments || [];
  const soldInvestments = memberFinancialData.soldInvestments || [];
  const investments = memberFinancialData.investments || [];
  if (memberDetailTitle) {
    memberDetailTitle.textContent = 'Society Investments';
  }
  if (memberDetailSubtitle) {
    memberDetailSubtitle.textContent = `${activeInvestments.length} running · ${soldInvestments.length} sold`;
  }
  if (memberDetailHead) {
    memberDetailHead.innerHTML = `
      <tr>
        <th>Status</th>
        <th>Investment ID</th>
        <th>Name</th>
        <th>Location</th>
        <th>Amount</th>
        <th>Date of Birth</th>
        <th>Profit / Loss</th>
        <th>Date</th>
        <th>Receipt</th>
      </tr>
    `;
  }
  if (!memberDetailBody) {
    return;
  }
  if (!investments.length) {
    memberDetailBody.innerHTML = '<tr><td colspan="9">No society investments yet.</td></tr>';
    return;
  }

  const activeRows = activeInvestments.map((investment) => `
    <tr>
      <td>${formatRunningStatusBadge()}</td>
      <td><strong>${investment.investmentCode || '-'}</strong></td>
      <td>${investment.investorName || investment.partner || '-'}</td>
      <td>${investment.location || investment.sector || '-'}</td>
      <td>$${Number(investment.amount || 0).toFixed(2)}</td>
      <td>${investment.dateOfBirth ? new Date(investment.dateOfBirth).toLocaleDateString() : '-'}</td>
      <td>-</td>
      <td>${new Date(investment.createdAt).toLocaleString()}</td>
      <td><a href="/api/member/investments/${investment._id}/receipt" class="receipt-button" target="_blank" rel="noopener">View Receipt</a></td>
    </tr>
  `).join('');

  const soldRows = soldInvestments.map((investment) => `
    <tr>
      <td><span class="status-badge ${investment.outcomeType === 'loss' ? 'status-loss' : 'status-profit'}">${investment.outcomeType === 'loss' ? 'Loss' : 'Profit'}</span></td>
      <td><strong>${investment.investmentCode || '-'}</strong></td>
      <td>${investment.investorName || investment.partner || '-'}</td>
      <td>${investment.location || investment.sector || '-'}</td>
      <td>$${Number(investment.amount || 0).toFixed(2)}</td>
      <td>${investment.dateOfBirth ? new Date(investment.dateOfBirth).toLocaleDateString() : '-'}</td>
      <td>${formatNetProfitLoss(investment.netProfitLoss)}</td>
      <td>${investment.soldAt ? new Date(investment.soldAt).toLocaleString() : new Date(investment.createdAt).toLocaleString()}</td>
      <td><a href="/api/member/investments/${investment._id}/receipt" class="receipt-button" target="_blank" rel="noopener">View Receipt</a></td>
    </tr>
  `).join('');

  memberDetailBody.innerHTML = `${activeRows}${soldRows}`;
}

function renderWithdrawalsReport() {
  const requests = memberFinancialData.withdrawalRequests || [];
  if (memberDetailTitle) {
    memberDetailTitle.textContent = 'Your Withdrawal Activity';
  }
  if (memberDetailSubtitle) {
    memberDetailSubtitle.textContent = `${requests.length} withdrawal request${requests.length === 1 ? '' : 's'}`;
  }
  if (memberDetailHead) {
    memberDetailHead.innerHTML = `
      <tr>
        <th>Amount</th>
        <th>Reason</th>
        <th>Status</th>
        <th>Date</th>
      </tr>
    `;
  }
  if (!memberDetailBody) {
    return;
  }
  if (!requests.length) {
    memberDetailBody.innerHTML = '<tr><td colspan="4">No withdrawal requests yet.</td></tr>';
    return;
  }

  memberDetailBody.innerHTML = requests.map((request) => `
    <tr>
      <td>$${Number(request.amount || 0).toFixed(2)}</td>
      <td>${request.reason || '-'}</td>
      <td>${request.status}</td>
      <td>${new Date(request.createdAt).toLocaleString()}</td>
    </tr>
  `).join('');
}

function renderMemberReport(reportType) {
  if (reportType === 'savings') {
    renderSavingsReport();
    return;
  }
  if (reportType === 'profit') {
    renderProfitReport();
    return;
  }
  if (reportType === 'investments') {
    renderInvestmentsReport();
    return;
  }
  if (reportType === 'withdrawals') {
    renderWithdrawalsReport();
  }
}

function bindMemberReportCards() {
  document.querySelectorAll('.member-metric-card').forEach((card) => {
    card.addEventListener('click', () => {
      const reportType = card.dataset.memberReportType;
      if (!reportType) {
        return;
      }
      setActiveMemberCard(reportType);
      renderMemberReport(reportType);
    });
  });
}

async function loadSocietyInvestments() {
  try {
    const response = await fetch('/api/member/investments');
    if (!response.ok) {
      return;
    }

    const data = await response.json();
    const activeInvestments = data.activeInvestments || [];
    const soldInvestments = data.soldInvestments || [];
    const summary = data.summary || {};

    memberFinancialData.activeInvestments = activeInvestments;
    memberFinancialData.soldInvestments = soldInvestments;
    memberFinancialData.investments = data.investments || [...activeInvestments, ...soldInvestments];

    if (memberTotalSavings) {
      memberTotalSavings.textContent = `$${Number(summary.totalSavings || 0).toFixed(2)}`;
    }
    if (memberTotalInvested) {
      memberTotalInvested.textContent = `$${Number(summary.totalInvested || 0).toFixed(2)}`;
    }
    if (memberActiveCount) {
      memberActiveCount.textContent = summary.activeCount ?? activeInvestments.length;
    }
    if (memberSoldCount) {
      memberSoldCount.textContent = summary.soldCount ?? soldInvestments.length;
    }

    if (memberActiveInvestmentsBody) {
      const activeRows = renderActiveInvestmentRows(activeInvestments);
      memberActiveInvestmentsBody.innerHTML = activeRows || '<tr><td colspan="8">No running investments yet.</td></tr>';
    }
    if (memberSoldInvestmentsBody) {
      const soldRows = renderSoldInvestmentRows(soldInvestments);
      memberSoldInvestmentsBody.innerHTML = soldRows || '<tr><td colspan="8">No sold investments yet.</td></tr>';
    }

    if (activeMemberReportType === 'investments') {
      renderInvestmentsReport();
    }
  } catch (error) {
    console.error('Failed to load society investments:', error);
  }
}

async function loadMemberInvestmentRequests() {
  const container = document.getElementById('memberInvestmentRequestsList');
  const messageEl = document.getElementById('memberInvestmentRequestMessage');
  if (!container) return;

  try {
    const response = await fetch('/api/member/investment-requests');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load requests.');

    const requests = data.requests || [];
    if (!requests.length) {
      container.innerHTML = '<p class="table-subtitle">No new investment requests waiting for your approval.</p>';
      return;
    }

    container.innerHTML = requests.map((item) => {
      const docs = (item.documents || []).map((doc) => `
        <li><a href="${doc.filePath}" target="_blank" rel="noopener">${doc.originalName || 'Document'}</a></li>
      `).join('') || '<li>No documents attached.</li>';

      return `
        <article class="panel-card" style="margin-bottom: 0.85rem;" data-request-id="${item._id}">
          <h3 style="margin:0 0 0.35rem;">${item.investmentCode || 'Investment'} · ${item.investmentType || ''}</h3>
          <p class="table-subtitle">
            Investor: ${item.investorName || item.investor?.name || '-'} ·
            Amount: $${Number(item.amount || 0).toFixed(2)} ·
            Approvals: ${item.approvalCount || 0}/${item.requiredApprovals || 0}
          </p>
          <p>${item.notes || 'No notes provided.'}</p>
          <h4>Documents</h4>
          <ul>${docs}</ul>
          ${item.alreadyApproved
            ? '<p class="message success">You already approved this request.</p>'
            : `<button type="button" class="primary-btn" data-approve-investment="${item._id}">Approve Investment</button>`}
        </article>
      `;
    }).join('');

    container.querySelectorAll('[data-approve-investment]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (messageEl) messageEl.textContent = '';
        try {
          const approveRes = await fetch(`/api/member/investment-requests/${btn.dataset.approveInvestment}/approve`, {
            method: 'POST',
          });
          const approveData = await approveRes.json();
          if (!approveRes.ok) throw new Error(approveData.error || 'Unable to approve.');
          if (messageEl) {
            messageEl.classList.add('success');
            messageEl.textContent = approveData.message || 'Approved.';
          }
          await loadMemberInvestmentRequests();
        } catch (error) {
          if (messageEl) {
            messageEl.classList.remove('success');
            messageEl.textContent = error.message;
          }
        }
      });
    });
  } catch (error) {
    container.innerHTML = `<p class="message">${error.message}</p>`;
  }
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

function renderActiveInvestmentRows(investments = [], receiptBase = '/api/member/investments') {
  if (!investments.length) {
    return '';
  }

  return investments.map((investment) => `
    <tr>
      <td><strong>${investment.investmentCode || '-'}</strong></td>
      <td>${investment.investorName || investment.partner || '-'}</td>
      <td>${investment.location || investment.sector || '-'}</td>
      <td>$${Number(investment.amount || 0).toFixed(2)}</td>
      <td>${investment.dateOfBirth ? new Date(investment.dateOfBirth).toLocaleDateString() : '-'}</td>
      <td>${new Date(investment.createdAt).toLocaleDateString()}</td>
      <td>${formatRunningStatusBadge()}</td>
      <td><a href="${receiptBase}/${investment._id}/receipt" class="receipt-button" target="_blank" rel="noopener">View Receipt</a></td>
    </tr>
  `).join('');
}

function renderSoldInvestmentRows(investments = [], receiptBase = '/api/member/investments') {
  if (!investments.length) {
    return '';
  }

  return investments.map((investment) => `
    <tr>
      <td><strong>${investment.investmentCode || '-'}</strong></td>
      <td>${investment.investorName || investment.partner || '-'}</td>
      <td>${investment.location || investment.sector || '-'}</td>
      <td>$${Number(investment.amount || 0).toFixed(2)}</td>
      <td>$${Number(investment.saleAmount || 0).toFixed(2)}</td>
      <td>${formatNetProfitLoss(investment.netProfitLoss)}</td>
      <td>${investment.soldAt ? new Date(investment.soldAt).toLocaleDateString() : '-'}</td>
      <td><a href="${receiptBase}/${investment._id}/receipt" class="receipt-button" target="_blank" rel="noopener">View Receipt</a></td>
    </tr>
  `).join('');
}

async function loadWithdrawalRequests() {
  try {
    const response = await fetch('/api/withdrawals/member');
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    memberFinancialData.withdrawalRequests = data.requests || [];
    if (withdrawalTableBody) {
      withdrawalTableBody.innerHTML = memberFinancialData.withdrawalRequests.map((request) => `
        <tr>
          <td>$${Number(request.amount || 0).toFixed(2)}</td>
          <td>${request.reason || '-'}</td>
          <td>${request.status}</td>
          <td>${new Date(request.createdAt).toLocaleDateString()}</td>
        </tr>
      `).join('');
    }
    if (activeMemberReportType === 'withdrawals') {
      renderWithdrawalsReport();
    }
  } catch (error) {
    console.error('Failed to load withdrawal requests:', error);
  }
}

if (withdrawalForm) {
  withdrawalForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    withdrawalMessage.textContent = '';
    withdrawalMessage.classList.remove('success', 'error');
    const formData = new FormData(withdrawalForm);
    try {
      const response = await fetch('/api/withdrawals/member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Number(formData.get('amount')) || 0,
          reason: formData.get('reason'),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        withdrawalMessage.classList.add('error');
        withdrawalMessage.textContent = data.error || 'Unable to submit request.';
        return;
      }
      withdrawalForm.reset();
      await loadWithdrawalRequests();
      await loadFinancialData();
      withdrawalMessage.classList.add('success');
      withdrawalMessage.textContent = 'Withdrawal request submitted.';
    } catch (error) {
      withdrawalMessage.classList.add('error');
      withdrawalMessage.textContent = 'Unable to submit request.';
    }
  });
}

function formatLoanTypeLabel(type = 'general') {
  return type === 'emergency' ? 'Emergency' : 'General';
}

async function loadLoanDashboardSummary() {
  const container = document.getElementById('loanDashboardContent');
  if (!container) return;

  try {
    const response = await fetch('/api/loans/member/summary');
    if (!response.ok) {
      container.innerHTML = '<p class="table-subtitle">Unable to load loan status.</p>';
      return;
    }

    const data = await response.json();
    const loans = data.loans || [];
    const activeLoan = data.activeLoan;
    const latestDecision = data.latestDecision;
    const eligibility = data.eligibility || {};

    const eligibilityBlock = `
      <div class="loan-dashboard-highlight loan-eligibility-strip">
        <div class="member-profile-meta">
          <span class="member-profile-meta-pill">Total Savings: $${Number(eligibility.totalSavings || 0).toFixed(2)}</span>
          <span class="member-profile-meta-pill">Max Loan (80%): $${Number(eligibility.availableMaxLoan ?? eligibility.maxEligibleAmount ?? 0).toFixed(2)}</span>
          <span class="member-profile-meta-pill">Used: $${Number(eligibility.usedGeneralLoanAmount || 0).toFixed(2)}</span>
        </div>
        <p class="table-subtitle">সাধারণ ঋণের অবশিষ্ট সীমা স্বয়ংক্রিয়ভাবে হিসাব হয়। জরুরি ঋণ আনলিমিটেড।</p>
      </div>
    `;

    if (!loans.length) {
      container.innerHTML = `
        ${eligibilityBlock}
        <p class="table-subtitle">You have not applied for a loan yet.</p>
        <p class="table-subtitle">Go to the Loans page to submit a general or emergency loan application.</p>
      `;
      return;
    }

    const disbursedLoan = loans.find((loan) => loan.status === 'disbursed');
    const approvedAwaitingTransfer = loans.find((loan) => loan.status === 'approved');
    const transferBanner = buildLoanDisbursementReceivedHtml(disbursedLoan || approvedAwaitingTransfer || {});

    const activeBlock = activeLoan ? `
      <div class="loan-dashboard-highlight">
        ${transferBanner || ''}
        <div class="member-profile-meta">
          <span class="member-profile-meta-pill">${formatLoanTypeLabel(activeLoan.loanType)} Loan</span>
          <span class="member-profile-meta-pill">$${Number(activeLoan.amount || 0).toFixed(2)}</span>
          ${formatLoanStatusBadge(activeLoan.status)}
        </div>
        <p class="table-subtitle"><strong>Current status:</strong> ${activeLoan.status}</p>
        <p class="table-subtitle"><strong>Decision / note:</strong> ${buildLoanDecisionText(activeLoan)}</p>
        ${activeLoan.paymentMethod ? `<p class="table-subtitle"><strong>Payment method:</strong> ${formatPaymentMethodLabel(activeLoan.paymentMethod)}</p>` : ''}
        ${activeLoan.contractPath ? `<p class="table-subtitle">${buildLoanContractActions(activeLoan)}</p>` : ''}
      </div>
    ` : '';

    const latestBlock = latestDecision && (!activeLoan || String(latestDecision._id) !== String(activeLoan._id)) ? `
      <div class="loan-dashboard-latest">
        <p class="small-label">Latest Decision</p>
        <p class="table-subtitle">${formatLoanTypeLabel(latestDecision.loanType)} loan — ${formatLoanStatusBadge(latestDecision.status)} — ${buildLoanDecisionText(latestDecision)}</p>
      </div>
    ` : '';

    const historyRows = loans.map((loan) => `
      <tr>
        <td>${formatLoanTypeLabel(loan.loanType)}</td>
        <td>$${Number(loan.amount || 0).toFixed(2)}</td>
        <td>${formatLoanStatusBadge(loan.status)}</td>
        <td>${buildLoanDecisionText(loan)}</td>
        <td>${formatPaymentMethodLabel(loan.paymentMethod)}</td>
        <td>${buildLoanContractActions(loan)}</td>
        <td>${new Date(loan.createdAt).toLocaleString()}</td>
      </tr>
    `).join('');

    container.innerHTML = `
      ${eligibilityBlock}
      ${transferBanner && !activeLoan ? transferBanner : ''}
      ${activeBlock}
      ${latestBlock}
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Decision</th>
              <th>Payment</th>
              <th>Contract</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>${historyRows}</tbody>
        </table>
      </div>
    `;

    bindSignedContractUploads(container);
  } catch (error) {
    container.innerHTML = '<p class="table-subtitle">Unable to load loan status.</p>';
  }
}

function bindSignedContractUploads(container = document) {
  container.querySelectorAll('[data-signed-contract-loan]').forEach((input) => {
    input.addEventListener('change', async () => {
      const loanId = input.dataset.signedContractLoan;
      const file = input.files?.[0];
      if (!loanId || !file) return;

      try {
        const data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const response = await fetch(`/api/loans/member/${loanId}/signed-contract`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: [{ name: file.name, data }] }),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          window.alert(payload.error || 'Unable to upload signed contract.');
          return;
        }

        await loadLoanApplications();
        await loadLoanDashboardSummary();
      } catch (error) {
        window.alert('Unable to upload signed contract.');
      } finally {
        input.value = '';
      }
    });
  });
}

function renderLoanEligibilityUi(data = {}) {
  const savingsEl = document.getElementById('loanTotalSavings');
  const maxEl = document.getElementById('loanMaxEligible');
  const maxNoteEl = document.getElementById('loanMaxEligibleNote');
  const dashboardMaxLoan = document.getElementById('dashboardMaxLoan');
  const dashboardLoanUsedNote = document.getElementById('dashboardLoanUsedNote');
  const generalAmountInput = document.querySelector('#generalLoanForm [name="amount"]');
  const generalMaxHint = document.getElementById('generalLoanMaxHint');

  const totalSavings = Number(data.totalSavings || 0);
  const availableMaxLoan = Number(data.availableMaxLoan ?? data.maxEligibleAmount ?? data.generalMaxLoan ?? 0);
  const usedGeneralLoanAmount = Number(data.usedGeneralLoanAmount || 0);
  const theoreticalMaxLoan = Number(data.theoreticalMaxLoan || availableMaxLoan);

  if (savingsEl) savingsEl.textContent = `$${totalSavings.toFixed(2)}`;
  if (maxEl) maxEl.textContent = `$${availableMaxLoan.toFixed(2)}`;
  if (dashboardMaxLoan) dashboardMaxLoan.textContent = `$${availableMaxLoan.toFixed(2)}`;

  const usageNote = usedGeneralLoanAmount > 0
    ? `Used $${usedGeneralLoanAmount.toFixed(2)} of $${theoreticalMaxLoan.toFixed(2)}`
    : 'Available for general loan';

  if (maxNoteEl) maxNoteEl.textContent = usageNote;
  if (dashboardLoanUsedNote) dashboardLoanUsedNote.textContent = usageNote;

  if (generalAmountInput) {
    generalAmountInput.max = availableMaxLoan > 0 ? availableMaxLoan.toFixed(2) : '';
  }
  if (generalMaxHint) {
    generalMaxHint.textContent = availableMaxLoan > 0
      ? `অবশিষ্ট সাধারণ ঋণ সীমা: $${availableMaxLoan.toFixed(2)} (মোট ৮০%: $${theoreticalMaxLoan.toFixed(2)}, ব্যবহৃত: $${usedGeneralLoanAmount.toFixed(2)})`
      : 'কোনো সাধারণ ঋণ সীমা অবশিষ্ট নেই।';
  }
}

async function loadLoanEligibility() {
  try {
    const response = await fetch('/api/loans/member/eligibility');
    if (!response.ok) {
      if (currentUser) {
        const savings = Number(currentUser.savings || 0);
        const maxLoan = Number((savings * 0.8).toFixed(2));
        renderLoanEligibilityUi({
          totalSavings: savings,
          availableMaxLoan: maxLoan,
          theoreticalMaxLoan: maxLoan,
          usedGeneralLoanAmount: 0,
        });
      }
      return null;
    }

    const data = await response.json();
    renderLoanEligibilityUi(data);
    return data;
  } catch (error) {
    console.error('Failed to load loan eligibility:', error);
    if (currentUser) {
      const savings = Number(currentUser.savings || 0);
      const maxLoan = Number((savings * 0.8).toFixed(2));
      renderLoanEligibilityUi({
        totalSavings: savings,
        availableMaxLoan: maxLoan,
        theoreticalMaxLoan: maxLoan,
        usedGeneralLoanAmount: 0,
      });
    }
  }
  return null;
}

function bindLoanTabs() {
  const tabs = document.querySelectorAll('[data-loan-tab]');
  const panels = document.querySelectorAll('[data-loan-panel]');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.loanTab;
      tabs.forEach((item) => item.classList.toggle('active', item === tab));
      panels.forEach((panel) => {
        panel.classList.toggle('hidden', panel.dataset.loanPanel !== target);
      });
    });
  });
}

async function submitLoanApplication(form, loanType) {
  const messageEl = form.querySelector('.loan-form-message');
  if (messageEl) {
    messageEl.textContent = '';
    messageEl.classList.remove('success', 'error');
  }

  const formData = new FormData(form);
  const amount = Number(formData.get('amount'));
  const eligibility = await loadLoanEligibility();

  if (loanType === 'general') {
    const maxEligible = Number(eligibility?.availableMaxLoan ?? eligibility?.maxEligibleAmount ?? eligibility?.generalMaxLoan ?? 0);
    if (amount > maxEligible) {
      if (messageEl) {
        messageEl.classList.add('error');
        messageEl.textContent = `ঋণের পরিমাণ অবশিষ্ট সীমা $${maxEligible.toFixed(2)} এর বেশি হতে পারবে না।`;
      }
      return;
    }
  }

  try {
    const files = await readFilesAsBase64(formData.getAll('documents'));
    const response = await fetch('/api/loans/member', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        loanType,
        amount,
        reason: formData.get('reason'),
        witnessName: formData.get('witnessName'),
        witnessPhone: formData.get('witnessPhone'),
        witnessRelation: formData.get('witnessRelation'),
        files,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      if (messageEl) {
        messageEl.classList.add('error');
        messageEl.textContent = data.error || 'Unable to submit loan application.';
      }
      if (data.autoRejected) {
        await loadLoanApplications();
        await loadLoanDashboardSummary();
      }
      return;
    }
    form.reset();
    if (messageEl) {
      messageEl.classList.add('success');
      messageEl.textContent = 'Loan application submitted. Admin has been notified.';
    }
    await loadLoanApplications();
    await loadLoanDashboardSummary();
  } catch (error) {
    if (messageEl) {
      messageEl.classList.add('error');
      messageEl.textContent = 'Unable to submit loan application.';
    }
  }
}

async function renderLoanDisbursementPanel(loans = []) {
  const panel = document.getElementById('loanDisbursementContent');
  if (!panel) {
    return;
  }

  const disbursedLoan = loans.find((loan) => loan.status === 'disbursed');
  const approvedLoan = loans.find((loan) => loan.status === 'approved');
  const targetLoan = disbursedLoan || approvedLoan;

  if (!targetLoan) {
    panel.innerHTML = '<p class="table-subtitle">No approved or disbursed loan right now. Apply for a loan above if you need one.</p>';
    return;
  }

  panel.innerHTML = buildLoanDisbursementReceivedHtml(targetLoan);
}

async function loadLoanApplications() {
  const body = document.getElementById('loanApplicationsBody');
  if (!body) return;
  try {
    const response = await fetch('/api/loans/member');
    const data = await response.json();
    const loans = data.loans || [];
    await renderLoanDisbursementPanel(loans);
    body.innerHTML = loans.length ? loans.map((loan) => `
      <tr>
        <td>${formatLoanTypeLabel(loan.loanType)}${loan.autoRejected ? ' <span class="status-badge status-fail">Auto-rejected</span>' : ''}</td>
        <td>$${Number(loan.amount || 0).toFixed(2)}</td>
        <td>${loan.reason || '-'}</td>
        <td>${formatLoanStatusBadge(loan.status)}</td>
        <td>${buildLoanDecisionText(loan)}</td>
        <td>${loan.status === 'disbursed'
          ? `$${Number(loan.amount || 0).toFixed(2)} via ${formatPaymentMethodLabel(loan.paymentMethod)}${loan.disbursedAt ? `<br><small>${new Date(loan.disbursedAt).toLocaleString()}</small>` : ''}${loan.disbursementReference ? `<br><small>Ref: ${loan.disbursementReference}</small>` : ''}`
          : loan.status === 'approved'
            ? '<span class="status-badge status-pending">Awaiting Transfer</span>'
            : '-'
        }</td>
        <td>${formatPaymentMethodLabel(loan.paymentMethod)}</td>
        <td>${buildLoanContractActions(loan)}</td>
        <td>${new Date(loan.createdAt).toLocaleString()}</td>
      </tr>
    `).join('') : '<tr><td colspan="8">No loan applications yet.</td></tr>';
    bindSignedContractUploads(document.getElementById('loanApplicationsBody')?.closest('section') || document);
  } catch (error) {
    body.innerHTML = '<tr><td colspan="8">Unable to load loan applications.</td></tr>';
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

function buildOutstandingLoanHtml(summary = {}) {
  if (summary.loanCleared) {
    return `
      <p class="table-subtitle"><strong>Loan Cleared.</strong> Your ${formatLoanTypeLabel(summary.loanType)} loan of $${Number(summary.originalAmount || 0).toFixed(2)} has been fully repaid.</p>
      <p class="table-subtitle">Total repaid: $${Number(summary.totalRepaid || 0).toFixed(2)}${summary.clearedAt ? ` — cleared on ${new Date(summary.clearedAt).toLocaleString()}.` : '.'}</p>
    `;
  }

  if (!summary.hasOutstandingLoan) {
    return '<p class="table-subtitle">You have no outstanding loan balance right now.</p>';
  }

  return `
    <div class="member-profile-meta">
      <span class="member-profile-meta-pill">${formatLoanTypeLabel(summary.loanType)} Loan</span>
      <span class="member-profile-meta-pill">Original: $${Number(summary.originalAmount || 0).toFixed(2)}</span>
      <span class="member-profile-meta-pill">Repaid: $${Number(summary.totalRepaid || 0).toFixed(2)}</span>
    </div>
    <p class="table-subtitle"><strong>Outstanding Loan:</strong> $${Number(summary.outstandingBalance || 0).toFixed(2)}</p>
    <p class="table-subtitle">Pay at the society office — admin will record your payment and update this balance.</p>
  `;
}

let latestOutstandingSummary = null;

async function loadOutstandingLoanSummary() {
  try {
    const response = await fetch('/api/loans/member/repayments/outstanding');
    if (!response.ok) return null;
    const summary = await response.json();
    latestOutstandingSummary = summary;

    const dashboardContent = document.getElementById('dashboardOutstandingLoanContent');
    const loansSummary = document.getElementById('loanOutstandingSummary');
    const html = buildOutstandingLoanHtml(summary);
    if (dashboardContent) dashboardContent.innerHTML = html;
    if (loansSummary) loansSummary.innerHTML = html;

    const repaymentPanel = document.getElementById('loanRepaymentPanel');
    if (repaymentPanel) {
      repaymentPanel.classList.toggle('hidden', !summary.hasOutstandingLoan);
    }
    return summary;
  } catch (error) {
    console.error('Failed to load outstanding loan:', error);
  }
  return null;
}

async function loadLoanRepayments() {
  const body = document.getElementById('loanRepaymentsBody');
  if (!body) return;
  try {
    const response = await fetch('/api/loans/member/repayments');
    const data = await response.json();
    const repayments = data.repayments || [];
    body.innerHTML = repayments.length ? repayments.map((item) => `
      <tr>
        <td>$${Number(item.amount || 0).toFixed(2)}</td>
        <td>${item.repaymentType === 'full' ? 'Full' : 'Installment'}</td>
        <td>${formatPaymentMethodLabel(item.paymentMethod)}</td>
        <td>${formatRepaymentStatusBadge(item.status)}${item.adminManual ? '<br><small>Recorded by admin</small>' : ''}</td>
        <td>${item.status === 'approved' ? `$${Number(item.balanceAfter || 0).toFixed(2)}` : '-'}</td>
        <td>${new Date(item.createdAt).toLocaleString()}</td>
        <td>${item.status === 'approved' && item.receiptPath ? `<a href="/api/loans/member/repayments/${item._id}/receipt" class="receipt-button" target="_blank" rel="noopener">Receipt</a>` : '-'}</td>
      </tr>
    `).join('') : '<tr><td colspan="7">No repayment history yet.</td></tr>';
  } catch (error) {
    body.innerHTML = '<tr><td colspan="7">Unable to load repayment history.</td></tr>';
  }
}

async function submitLoanRepayment(form) {
  const messageEl = document.getElementById('loanRepaymentMessage');
  if (messageEl) {
    messageEl.textContent = '';
    messageEl.classList.remove('success', 'error');
  }

  const summary = await loadOutstandingLoanSummary();
  if (!summary?.hasOutstandingLoan) {
    if (messageEl) {
      messageEl.classList.add('error');
      messageEl.textContent = 'No outstanding loan available for repayment.';
    }
    return;
  }

  const formData = new FormData(form);
  const repaymentType = formData.get('repaymentType') || 'installment';
  const amount = repaymentType === 'full'
    ? Number(summary.availableToPay || 0)
    : Number(formData.get('amount'));

  try {
    const response = await fetch('/api/loans/member/repayments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount,
        repaymentType,
        paymentMethod: formData.get('paymentMethod'),
        memberNote: formData.get('memberNote'),
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      if (messageEl) {
        messageEl.classList.add('error');
        messageEl.textContent = data.error || 'Unable to submit repayment request.';
      }
      return;
    }

    form.reset();
    if (messageEl) {
      messageEl.classList.add('success');
      messageEl.textContent = 'Repayment request submitted. Admin will verify before balance updates.';
    }
    await loadOutstandingLoanSummary();
    await loadLoanRepayments();
    await loadLoanEligibility();
    await loadLoanDashboardSummary();
  } catch (error) {
    if (messageEl) {
      messageEl.classList.add('error');
      messageEl.textContent = 'Unable to submit repayment request.';
    }
  }
}

function bindLoanRepaymentUi() {
  const goToLoansBtn = document.getElementById('goToLoansPageBtn');
  if (goToLoansBtn) {
    goToLoansBtn.addEventListener('click', () => navigateMemberPage('loans'));
  }
}

async function loadKycDocuments() {
  const body = document.getElementById('kycDocumentsBody');
  if (!body) return;
  try {
    const response = await fetch('/api/kyc/member');
    const data = await response.json();
    const documents = data.documents || [];
    body.innerHTML = documents.length ? documents.map((doc) => `
      <tr>
        <td>${doc.documentType}</td>
        <td><a href="${doc.filePath}" target="_blank" rel="noopener">${doc.originalName || 'Document'}</a></td>
        <td>${doc.status}</td>
        <td>${new Date(doc.createdAt).toLocaleString()}</td>
      </tr>
    `).join('') : '<tr><td colspan="4">No documents uploaded yet.</td></tr>';
  } catch (error) {
    body.innerHTML = '<tr><td colspan="4">Unable to load KYC documents.</td></tr>';
  }
}

function bindLoanAndKycForms() {
  bindLoanTabs();
  bindLoanRepaymentUi();
  void loadLoanEligibility();
  void loadOutstandingLoanSummary();

  const generalLoanForm = document.getElementById('generalLoanForm');
  if (generalLoanForm) {
    generalLoanForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      await submitLoanApplication(generalLoanForm, 'general');
    });
  }

  const emergencyLoanForm = document.getElementById('emergencyLoanForm');
  if (emergencyLoanForm) {
    emergencyLoanForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      await submitLoanApplication(emergencyLoanForm, 'emergency');
    });
  }

  const kycProfileForm = document.getElementById('kycProfileForm');
  const kycProfileMessage = document.getElementById('kycProfileMessage');
  if (kycProfileForm) {
    kycProfileForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(kycProfileForm);
      const response = await fetch('/api/kyc/member/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: formData.get('phone'),
          address: formData.get('address'),
          nidNumber: formData.get('nidNumber'),
        }),
      });
      const data = await response.json();
      if (kycProfileMessage) {
        kycProfileMessage.textContent = response.ok ? 'KYC profile saved.' : (data.error || 'Unable to save KYC profile.');
        kycProfileMessage.classList.toggle('success', response.ok);
        kycProfileMessage.classList.toggle('error', !response.ok);
      }
    });
  }

  const kycDocumentForm = document.getElementById('kycDocumentForm');
  const kycDocumentMessage = document.getElementById('kycDocumentMessage');
  if (kycDocumentForm) {
    kycDocumentForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(kycDocumentForm);
      const files = await readFilesAsBase64(formData.getAll('documents'));
      const response = await fetch('/api/kyc/member/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentType: formData.get('documentType'),
          files,
        }),
      });
      const data = await response.json();
      if (kycDocumentMessage) {
        kycDocumentMessage.textContent = response.ok ? 'Documents uploaded successfully.' : (data.error || 'Unable to upload documents.');
        kycDocumentMessage.classList.toggle('success', response.ok);
        kycDocumentMessage.classList.toggle('error', !response.ok);
      }
      if (response.ok) {
        kycDocumentForm.reset();
        await loadKycDocuments();
      }
    });
  }
}

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/';
});

async function loadMemberNotifications({ openPanel = false } = {}) {
  const list = document.getElementById('memberNotificationList');
  const badge = document.getElementById('memberNotificationBadge');
  const panel = document.getElementById('memberNotificationPanel');
  if (!openPanel) {
    return;
  }

  if (list) {
    list.innerHTML = '<p class="table-subtitle">Loading notifications...</p>';
  }

  try {
    const response = await fetch('/api/member/notifications');
    if (!response.ok) return;
    const data = await response.json();
    const notifications = data.notifications || [];
    const unreadCount = data.unreadCount || 0;
    if (badge) {
      badge.textContent = unreadCount;
      badge.classList.toggle('hidden', unreadCount === 0);
    }
    if (list) {
      list.innerHTML = notifications.length ? notifications.map((item) => `
        <button type="button" class="notification-item ${item.read ? '' : 'notification-item-unread'}" data-member-notification-id="${item._id}">
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

function bindMemberNotificationUi() {
  const btn = document.getElementById('memberNotificationBtn');
  const panel = document.getElementById('memberNotificationPanel');
  const markAllBtn = document.getElementById('markAllMemberNotificationsReadBtn');

  const openNotifications = () => {
    void loadMemberNotifications({ openPanel: true });
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

  document.addEventListener('click', (event) => {
    if (!panel || panel.classList.contains('hidden')) {
      return;
    }
    if (!panel.contains(event.target) && event.target !== btn) {
      panel.classList.add('hidden');
      panel.hidden = true;
    }
  });

  if (markAllBtn) {
    markAllBtn.addEventListener('click', async () => {
      await fetch('/api/member/notifications/read-all', { method: 'PATCH' });
      await loadMemberNotifications({ openPanel: true });
    });
  }

  document.addEventListener('click', async (event) => {
    const item = event.target.closest('[data-member-notification-id]');
    if (!item || !panel || panel.classList.contains('hidden')) return;
    await fetch(`/api/member/notifications/${item.dataset.memberNotificationId}/read`, { method: 'PATCH' });
    await loadMemberNotifications({ openPanel: true });
  });
}

let memberChatPollTimer = null;
let memberChatReplyTo = null;

function stopMemberChatPolling() {
  if (memberChatPollTimer) {
    clearInterval(memberChatPollTimer);
    memberChatPollTimer = null;
  }
}

function setMemberReplyTarget(target = null) {
  memberChatReplyTo = target;
  const bar = document.getElementById('memberChatReplyBar');
  const nameEl = document.getElementById('memberChatReplyName');
  const previewEl = document.getElementById('memberChatReplyPreview');
  if (!bar) return;
  if (!target) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');
  if (nameEl) nameEl.textContent = `Reply to ${target.name || 'message'}`;
  if (previewEl) previewEl.textContent = target.preview || '';
}

function escapeMemberChatHtml(value = '') {
  return window.SocietyChat?.escapeChatHtml(value) || String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMemberChatMessages(messages = []) {
  const thread = document.getElementById('memberChatThread');
  if (!thread) return;
  if (window.SocietyChat) {
    window.SocietyChat.renderChatMessages(thread, messages, 'member', {
      emptyText: 'No messages yet. Send your first message to the cashier below.',
      onReplyClick: setMemberReplyTarget,
    });
    return;
  }
  thread.innerHTML = '<p class="table-subtitle chat-empty-state">Chat UI failed to load.</p>';
}

async function loadMemberChat() {
  const thread = document.getElementById('memberChatThread');
  if (!thread) {
    return;
  }

  try {
    const response = await fetch('/api/member/chat');
    const data = await response.json();
    if (!response.ok) {
      thread.innerHTML = `<p class="table-subtitle chat-empty-state">${escapeMemberChatHtml(data.error || 'Unable to load messages.')}</p>`;
      return;
    }
    renderMemberChatMessages(data.messages || []);
  } catch (error) {
    thread.innerHTML = '<p class="table-subtitle chat-empty-state">Unable to load messages.</p>';
  }

  stopMemberChatPolling();
  const pollMs = window.SocietyChat?.POLL_MS || 2500;
  memberChatPollTimer = window.setInterval(() => {
    void loadMemberChat();
  }, pollMs);
}

function bindMemberChatUi() {
  const form = document.getElementById('memberChatComposeForm');
  if (!form) {
    return;
  }

  const filesInput = document.getElementById('memberChatFiles');
  const fileLabel = document.getElementById('memberChatFileLabel');
  document.getElementById('memberChatReplyClear')?.addEventListener('click', () => setMemberReplyTarget(null));

  filesInput?.addEventListener('change', () => {
    const count = filesInput.files?.length || 0;
    if (fileLabel) fileLabel.textContent = count ? `${count} file(s) selected` : '';
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const messageEl = form.querySelector('.chat-compose-message');
    const body = form.body?.value?.trim() || '';

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

      const response = await fetch('/api/member/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body,
          replyTo: memberChatReplyTo?.id || null,
          files,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (messageEl) {
          messageEl.classList.add('error');
          messageEl.textContent = data.error || 'Unable to send message.';
        }
        return;
      }

      form.reset();
      if (fileLabel) fileLabel.textContent = '';
      setMemberReplyTarget(null);
      await loadMemberChat();
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

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  bindSidebarControls();
  bindMemberReportCards();
  bindLoanAndKycForms();
  bindMemberNotificationUi();
  bindMemberChatUi();
  loadProfile();
  loadWithdrawalRequests();
  loadRefunds();
  loadLoanApplications();
  loadLoanRepayments();
  loadLoanDashboardSummary();
  loadOutstandingLoanSummary();
  loadKycDocuments();
  loadSocietyInvestments();
  void loadMemberInvestmentRequests();
  void loadLoanEligibility();

  document.getElementById('memberSelfPasswordForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const msg = document.getElementById('memberSelfPasswordMessage');
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
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to update password.');
      msg.textContent = data.message || 'Password updated.';
      event.target.reset();
    } catch (error) {
      msg.textContent = error.message;
    }
  });

  setInterval(async () => {
    if (!currentUser) {
      return;
    }
    await loadProfile();
  }, 10000);

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && currentUser) {
      await loadProfile();
    }
  });
});
