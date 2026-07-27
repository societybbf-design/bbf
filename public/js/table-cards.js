/**
 * Convert wide data tables into labeled card stacks on small screens.
 * Auto-applies data-label from thead when rows are rendered dynamically.
 */
(function initTableCards() {
  let timer = null;

  function enhance(root = document) {
    root.querySelectorAll('table.data-table, table.table-cards').forEach((table) => {
      if (!table.classList.contains('table-cards')) {
        table.classList.add('table-cards');
      }
      const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
      if (!headers.length) return;
      table.querySelectorAll('tbody tr').forEach((row) => {
        const cells = [...row.children].filter((el) => el.tagName === 'TD');
        // Skip placeholder colspan rows
        if (cells.length === 1 && cells[0].hasAttribute('colspan')) return;
        cells.forEach((cell, index) => {
          if (!cell.getAttribute('data-label') && headers[index]) {
            cell.setAttribute('data-label', headers[index]);
          }
        });
      });
    });
  }

  function scheduleEnhance() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => enhance(), 40);
  }

  document.addEventListener('DOMContentLoaded', () => {
    enhance();
    if (window.MutationObserver) {
      const observer = new MutationObserver(scheduleEnhance);
      observer.observe(document.body, { childList: true, subtree: true });
    }
  });

  window.SocietyHubTables = { enhance };
})();
