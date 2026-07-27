/**
 * Shared mobile sidebar open/close for all dashboard layouts.
 */
(function initSidebarNav() {
  function closeSidebar() {
    const sidebar = document.getElementById('appSidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (sidebar) sidebar.classList.remove('open');
    if (backdrop) backdrop.hidden = true;
    document.body.classList.remove('sidebar-open');
  }

  function openSidebar() {
    const sidebar = document.getElementById('appSidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (sidebar) sidebar.classList.add('open');
    if (backdrop) backdrop.hidden = false;
    document.body.classList.add('sidebar-open');
  }

  function toggleSidebar() {
    const sidebar = document.getElementById('appSidebar');
    if (sidebar?.classList.contains('open')) closeSidebar();
    else openSidebar();
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('sidebarToggle')?.addEventListener('click', toggleSidebar);
    document.getElementById('sidebarBackdrop')?.addEventListener('click', closeSidebar);

    document.addEventListener('click', (event) => {
      const nav = event.target.closest('.sidebar .nav-item, .sidebar [data-staff-nav], .sidebar [data-dev-tab], .sidebar [data-section]');
      if (!nav) return;
      if (window.matchMedia('(max-width: 768px)').matches) {
        closeSidebar();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeSidebar();
    });
  });

  window.SocietyHubSidebar = { open: openSidebar, close: closeSidebar, toggle: toggleSidebar };
})();
