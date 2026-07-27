/**
 * Transforms flat sidebar nav into grouped, collapsible mobile menu sections.
 * Desktop layout is preserved via mobile-app-menu.css.
 */
(function initMobileMenu() {
  const MOBILE_QUERY = '(max-width: 768px)';

  function isMobile() {
    return window.matchMedia(MOBILE_QUERY).matches;
  }

  function ensureToolbar(sidebar) {
    if (sidebar.querySelector('.mobile-menu-toolbar')) return;

    const toolbar = document.createElement('div');
    toolbar.className = 'mobile-menu-toolbar';
    toolbar.innerHTML = `
      <button type="button" class="mobile-menu-back" id="mobileMenuClose" aria-label="Close menu">←</button>
      <h2 class="mobile-menu-title">Menu</h2>
    `;
    sidebar.insertBefore(toolbar, sidebar.firstChild);

    toolbar.querySelector('#mobileMenuClose')?.addEventListener('click', () => {
      window.SocietyHubSidebar?.close?.();
    });
  }

  function groupNavItems(nav) {
    if (!nav || nav.dataset.mobileMenuEnhanced === 'true') return;

    const nodes = Array.from(nav.childNodes).filter((node) => node.nodeType === 1);
    const sections = [];
    let current = null;

    nodes.forEach((node) => {
      if (node.matches('.nav-section-label')) {
        current = { title: node.textContent.trim(), items: [] };
        sections.push(current);
        return;
      }

      if (node.matches('.nav-item, [data-staff-nav], [data-page], [data-dev-tab], [data-section]')) {
        if (!current) {
          current = { title: 'Menu', items: [] };
          sections.push(current);
        }
        current.items.push(node);
      }
    });

    if (!sections.length) return;

    const fragment = document.createDocumentFragment();

    sections.forEach((section, index) => {
      const visibleItems = section.items.filter((item) => !item.classList.contains('hidden'));
      if (!visibleItems.length) return;

      const sectionEl = document.createElement('div');
      sectionEl.className = 'mobile-menu-section';
      sectionEl.dataset.expanded = index === 0 ? 'true' : 'true';

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'mobile-menu-section-toggle';
      toggle.setAttribute('aria-expanded', 'true');
      toggle.innerHTML = `
        <span class="mobile-menu-section-title">${section.title}</span>
        <span class="mobile-menu-chevron" aria-hidden="true"></span>
      `;

      const panel = document.createElement('div');
      panel.className = 'mobile-menu-section-panel';

      const grid = document.createElement('div');
      grid.className = 'mobile-menu-grid';
      visibleItems.forEach((item) => grid.appendChild(item));

      panel.appendChild(grid);
      sectionEl.appendChild(toggle);
      sectionEl.appendChild(panel);
      fragment.appendChild(sectionEl);

      toggle.addEventListener('click', () => {
        if (!isMobile()) return;
        const expanded = sectionEl.dataset.expanded === 'true';
        sectionEl.dataset.expanded = expanded ? 'false' : 'true';
        toggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        syncPanelHeight(panel, sectionEl);
      });

      requestAnimationFrame(() => syncPanelHeight(panel, sectionEl));
    });

    nav.textContent = '';
    nav.appendChild(fragment);
    nav.dataset.mobileMenuEnhanced = 'true';
    nav.classList.add('mobile-menu-enhanced');
  }

  function syncPanelHeight(panel, sectionEl) {
    if (!isMobile()) {
      panel.style.maxHeight = '';
      return;
    }
    if (sectionEl.dataset.expanded === 'false') {
      panel.style.maxHeight = '0px';
      return;
    }
    panel.style.maxHeight = `${panel.scrollHeight}px`;
  }

  function refreshPanelHeights(nav) {
    nav?.querySelectorAll('.mobile-menu-section').forEach((section) => {
      const panel = section.querySelector('.mobile-menu-section-panel');
      if (panel) syncPanelHeight(panel, section);
    });
  }

  function refreshSections(nav) {
    if (!nav) return;
    nav.querySelectorAll('.mobile-menu-section').forEach((section) => {
      const items = section.querySelectorAll('.nav-item, [data-staff-nav], [data-page]');
      const hasVisible = Array.from(items).some((item) => !item.classList.contains('hidden'));
      section.classList.toggle('hidden', !hasVisible);
      section.style.display = hasVisible ? '' : 'none';
    });
    refreshPanelHeights(nav);
  }

  function enhanceSidebar(sidebar) {
    if (!sidebar) return;
    ensureToolbar(sidebar);
    const nav = sidebar.querySelector('.sidebar-nav');
    groupNavItems(nav);
    refreshSections(nav);
  }

  function enhanceAll() {
    document.querySelectorAll('#appSidebar, .sidebar').forEach(enhanceSidebar);
  }

  document.addEventListener('DOMContentLoaded', () => {
    enhanceAll();

    window.addEventListener('resize', () => {
      document.querySelectorAll('.mobile-menu-enhanced').forEach((nav) => {
        refreshPanelHeights(nav);
      });
    });
  });

  window.SocietyHubMobileMenu = {
    enhance: enhanceAll,
    refreshSections: (navEl) => {
      const nav = navEl || document.querySelector('.sidebar-nav.mobile-menu-enhanced');
      refreshSections(nav);
    },
    enhanceNav: (navEl) => {
      const sidebar = navEl?.closest('.sidebar') || document.getElementById('appSidebar');
      if (!navEl) return;
      if (sidebar) ensureToolbar(sidebar);
      delete navEl.dataset.mobileMenuEnhanced;
      navEl.classList.remove('mobile-menu-enhanced');
      groupNavItems(navEl);
      refreshSections(navEl);
    },
  };
})();
