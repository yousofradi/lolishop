function getAdminUser() {
  try {
    return JSON.parse(localStorage.getItem('adminUser') || '{}');
  } catch {
    return {};
  }
}

function getAdminPermissions() {
  try {
    return JSON.parse(localStorage.getItem('adminPermissions') || '{}');
  } catch {
    return {};
  }
}

function isSuperAdmin() {
  const user = getAdminUser();
  return user.role === 'superadmin' || user.isSuperAdmin === true;
}

function getPermissionForSection(section) {
  if (isSuperAdmin()) return 'full';
  const perms = getAdminPermissions();
  return perms[section] || 'none';
}

function getFirstPermittedPage() {
  const perms = getAdminPermissions();
  if (isSuperAdmin() || perms.dashboard === 'full' || perms.dashboard === 'read') return 'index';
  const sectionPages = {
    orders: 'orders',
    abandoned_carts: 'abandoned-carts',
    customers: 'customers',
    products: 'products',
    collections: 'collections',
    homepage: 'homepage',
    promotions: 'promotions',
    expenses: 'expenses',
    settings: 'settings',
    shipment: 'shipment',
    webhooks: 'webhooks',
    whatsapp: 'whatsapp',
    employees: 'employees'
  };
  for (const [sec, page] of Object.entries(sectionPages)) {
    if (perms[sec] === 'full' || perms[sec] === 'read') return page;
  }
  return 'index';
}

function getCurrentPageSection() {
  const path = window.location.pathname.toLowerCase();
  if (path.includes('order-details') || path.includes('order-form') || path.includes('orders')) return 'orders';
  if (path.includes('abandoned-cart')) return 'abandoned_carts';
  if (path.includes('customer-details') || path.includes('customers')) return 'customers';
  if (path.includes('product-form') || path.includes('products')) return 'products';
  if (path.includes('collection-form') || path.includes('collections')) return 'collections';
  if (path.includes('homepage')) return 'homepage';
  if (path.includes('promotions')) return 'promotions';
  if (path.includes('expenses')) return 'expenses';
  if (path.includes('shipment')) return 'shipment';
  if (path.includes('webhooks')) return 'webhooks';
  if (path.includes('whatsapp')) return 'whatsapp';
  if (path.includes('settings')) return 'settings';
  if (path.includes('employees')) return 'employees';
  if (path.endsWith('/') || path.includes('/index') || path === '' || path === '/admin') return 'dashboard';
  return 'dashboard';
}

function filterSidebarNavigation() {
  const nav = document.querySelector('.admin-nav');
  if (!nav) return;

  const linkToSection = {
    '/': 'dashboard',
    'index': 'dashboard',
    'index.html': 'dashboard',
    'orders': 'orders',
    'abandoned-carts': 'abandoned_carts',
    'customers': 'customers',
    'products': 'products',
    'collections': 'collections',
    'homepage': 'homepage',
    'promotions': 'promotions',
    'expenses': 'expenses',
    'settings': 'settings',
    'shipment': 'shipment',
    'webhooks': 'webhooks',
    'whatsapp': 'whatsapp',
    'employees': 'employees'
  };

  // Inject Employees link into sidebar if not already present
  if (!nav.querySelector('a[href="employees"]')) {
    const empLink = document.createElement('a');
    empLink.href = 'employees';
    if (window.location.pathname.includes('employees')) empLink.className = 'active';
    empLink.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
        <circle cx="9" cy="7" r="4"></circle>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
      </svg>
      الموظفون والصلاحيات
    `;
    const dropdown = nav.querySelector('.admin-nav-dropdown-container');
    const logoutBtn = nav.querySelector('.logout');
    if (dropdown) {
      nav.insertBefore(empLink, dropdown);
    } else if (logoutBtn) {
      nav.insertBefore(empLink, logoutBtn);
    } else {
      nav.appendChild(empLink);
    }
  }

  // Check all sidebar links
  nav.querySelectorAll('a').forEach(link => {
    if (link.classList.contains('logout')) return;
    const rawHref = link.getAttribute('href') || '';
    const cleanHref = rawHref.replace(/^(\.\/|\/)/, '').replace(/\.html$/, '');
    const section = linkToSection[cleanHref] || linkToSection[rawHref];
    if (section) {
      const perm = getPermissionForSection(section);
      if (perm === 'none') {
        link.style.display = 'none';
      }
    }
  });

  // Check dropdown container: if all child links are hidden, hide dropdown container
  const dropdown = nav.querySelector('.admin-nav-dropdown-container');
  if (dropdown) {
    const dropdownLinks = dropdown.querySelectorAll('.admin-nav-dropdown-content a');
    let hasVisibleChild = false;
    dropdownLinks.forEach(link => {
      if (link.style.display !== 'none') hasVisibleChild = true;
    });
    if (!hasVisibleChild) {
      dropdown.style.display = 'none';
    }
  }
}

function enforcePermissionsUI() {
  const currentSection = getCurrentPageSection();
  const currentPerm = getPermissionForSection(currentSection);

  // 1. If user has NO permission for this section, block page or redirect to permitted page!
  if (currentPerm === 'none') {
    const firstAllowed = getFirstPermittedPage();
    if (currentSection === 'dashboard' && firstAllowed !== 'index') {
      window.location.replace(firstAllowed);
      return;
    }

    document.body.classList.remove('is-loading');
    const layout = document.querySelector('.admin-layout') || document.body;
    const main = document.querySelector('.admin-main') || layout;
    if (main) {
      main.innerHTML = `
        <div style="min-height:70vh;display:flex;align-items:center;justify-content:center;padding:40px 20px;text-align:center;">
          <div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:40px;max-width:500px;box-shadow:0 10px 25px -5px rgba(0,0,0,0.05);margin:auto;">
            <div style="width:64px;height:64px;background:#fef2f2;color:#ef4444;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px auto;">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
            </div>
            <h2 style="font-size:1.4rem;font-weight:700;color:#1e293b;margin-bottom:10px;">عفواً، ليس لديك صلاحية للوصول</h2>
            <p style="color:#64748b;font-size:0.95rem;line-height:1.6;margin-bottom:24px;">تم حجب هذا القسم عن حسابك بناءً على الصلاحيات المحددة لك من قبل إدارة المتجر.</p>
            <a href="${firstAllowed}" class="btn btn-primary" style="display:inline-flex;align-items:center;gap:8px;padding:12px 24px;text-decoration:none;border-radius:10px;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg>
              الانتقال إلى الأقسام المتاحة
            </a>
          </div>
        </div>
      `;
    }
    return;
  } else if (currentPerm === 'read') {
    // 2. Read-only mode restrictions
    document.body.classList.add('is-readonly-mode');

    if (!document.getElementById('readonly-css')) {
      const style = document.createElement('style');
      style.id = 'readonly-css';
      style.textContent = `
        /* Permanent CSS hiding for all action and mutating elements in read-only mode */
        body.is-readonly-mode .admin-readonly-hidden,
        body.is-readonly-mode button[type="submit"],
        body.is-readonly-mode .btn-create-emp,
        body.is-readonly-mode .btn-create,
        body.is-readonly-mode .btn-save,
        body.is-readonly-mode .btn-add,
        body.is-readonly-mode .btn-delete,
        body.is-readonly-mode .btn-del,
        body.is-readonly-mode .btn-edit,
        body.is-readonly-mode .preset-btn,
        body.is-readonly-mode .btn-primary:not(a[href^="http"]):not(a[href*=".html"]):not(a[href="/"]),
        body.is-readonly-mode .action-btn:not(.btn-view):not(.btn-preview),
        body.is-readonly-mode [onclick*="delete"],
        body.is-readonly-mode [onclick*="Delete"],
        body.is-readonly-mode [onclick*="remove"],
        body.is-readonly-mode [onclick*="Remove"],
        body.is-readonly-mode [onclick*="edit"],
        body.is-readonly-mode [onclick*="Edit"],
        body.is-readonly-mode [onclick*="save"],
        body.is-readonly-mode [onclick*="Save"],
        body.is-readonly-mode [onclick*="toggle"],
        body.is-readonly-mode [onclick*="Toggle"],
        body.is-readonly-mode [onclick*="openAdd"],
        body.is-readonly-mode [onclick*="openEdit"],
        body.is-readonly-mode [onclick*="create"],
        body.is-readonly-mode [onclick*="Create"],
        body.is-readonly-mode #save-btn,
        body.is-readonly-mode #btn-save,
        body.is-readonly-mode #btn-save-emp,
        body.is-readonly-mode #btn-global-save,
        body.is-readonly-mode #btn-create-order,
        body.is-readonly-mode #add-product-btn,
        body.is-readonly-mode #add-collection-btn,
        body.is-readonly-mode #save-settings-btn {
          display: none !important;
          visibility: hidden !important;
          pointer-events: none !important;
        }

        body.is-readonly-mode input:not([type="search"]):not(#emp-search):not(.search-input):not(#order-search):not(#product-search),
        body.is-readonly-mode select:not(.filter-select):not(.table-filter):not(#status-filter):not(#channel-filter),
        body.is-readonly-mode textarea {
          pointer-events: none !important;
          opacity: 0.75 !important;
          cursor: not-allowed !important;
          background-color: #f8fafc !important;
        }
      `;
      document.head.appendChild(style);
    }

    if (!document.querySelector('.admin-readonly-banner')) {
      const banner = document.createElement('div');
      banner.className = 'admin-readonly-banner';
      banner.style.cssText = 'background:#fffbeb;border:1px solid #fef3c7;color:#92400e;padding:12px 18px;border-radius:10px;margin-bottom:20px;font-size:0.9rem;font-weight:600;display:flex;align-items:center;gap:10px;box-shadow:0 1px 3px rgba(0,0,0,0.05);';
      banner.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg> وضع القراءة فقط — يمكنك استعراض هذا القسم فقط دون إجراء أي تعديلات أو حذف أو حفظ بيانات.`;

      const container = document.querySelector('.admin-main > div') || document.querySelector('.admin-main');
      if (container) {
        container.insertBefore(banner, container.firstChild);
      }
    }

// ── Admin Popup Notification (Replaces native browser alert) ─────────────
function showAdminNotification(message, type = 'warning', title = '') {
  let container = document.getElementById('admin-popup-notice-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'admin-popup-notice-container';
    container.style.cssText = `
      position: fixed;
      top: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 999999;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      pointer-events: none;
      width: 92%;
      max-width: 480px;
      direction: rtl;
    `;
    document.body.appendChild(container);
  }

  // Prevent duplicate spam
  const existing = container.querySelector(`[data-msg="${CSS.escape(message)}"]`);
  if (existing) {
    existing.style.transform = 'scale(1.03)';
    setTimeout(() => { existing.style.transform = 'scale(1)'; }, 200);
    return;
  }

  const el = document.createElement('div');
  el.setAttribute('data-msg', message);
  el.className = 'admin-popup-notice';

  let iconSvg = '';
  let borderColor = '#f59e0b';
  let iconBg = 'rgba(245, 158, 11, 0.15)';

  if (type === 'error') {
    borderColor = '#ef4444';
    iconBg = 'rgba(239, 68, 68, 0.15)';
    iconSvg = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
  } else if (type === 'success') {
    borderColor = '#10b981';
    iconBg = 'rgba(16, 185, 129, 0.15)';
    iconSvg = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
  } else {
    // warning / default
    iconSvg = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
  }

  el.style.cssText = `
    pointer-events: auto;
    background: #0f172a;
    color: #f8fafc;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-right: 5px solid ${borderColor};
    border-radius: 14px;
    padding: 14px 18px;
    display: flex;
    align-items: center;
    gap: 14px;
    box-shadow: 0 18px 45px -8px rgba(0,0,0,0.45), 0 6px 16px rgba(0,0,0,0.25);
    font-size: 0.94rem;
    font-weight: 600;
    line-height: 1.55;
    animation: popupNoticeSlideDown 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    transition: all 0.25s ease;
    width: 100%;
    position: relative;
    box-sizing: border-box;
  `;

  el.innerHTML = `
    <div style="width:38px;height:38px;border-radius:10px;background:${iconBg};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
      ${iconSvg}
    </div>
    <div style="flex:1;text-align:right;">
      ${title ? `<div style="font-size:0.8rem;color:#94a3b8;margin-bottom:2px;font-weight:600;">${title}</div>` : ''}
      <div>${message}</div>
    </div>
    <button type="button" aria-label="إغلاق" style="background:none;border:none;color:#94a3b8;cursor:pointer;padding:6px;display:flex;align-items:center;justify-content:center;border-radius:8px;transition:all 0.2s;" onmouseover="this.style.color='#fff';this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.color='#94a3b8';this.style.background='none'" onclick="this.closest('.admin-popup-notice').remove()">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
    </button>
  `;

  if (!document.getElementById('popup-notice-style')) {
    const s = document.createElement('style');
    s.id = 'popup-notice-style';
    s.textContent = `
      @keyframes popupNoticeSlideDown {
        from { opacity: 0; transform: translateY(-30px) scale(0.95); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes popupNoticeSlideUp {
        from { opacity: 1; transform: translateY(0) scale(1); }
        to { opacity: 0; transform: translateY(-25px) scale(0.95); }
      }
    `;
    document.head.appendChild(s);
  }

  container.appendChild(el);

  const autoDismiss = setTimeout(() => {
    el.style.animation = 'popupNoticeSlideUp 0.25s ease forwards';
    setTimeout(() => el.remove(), 250);
  }, 4500);

  el.addEventListener('mouseenter', () => clearTimeout(autoDismiss));
}
window.showAdminNotification = showAdminNotification;

    // Intercept DOM clicks & submits in capturing phase
    if (!window._readonlyEventsBound) {
      window._readonlyEventsBound = true;

      document.addEventListener('click', (e) => {
        if (!document.body.classList.contains('is-readonly-mode')) return;
        const target = e.target.closest('button, .action-btn, a[onclick], [onclick]');
        if (target) {
          const onclickAttr = target.getAttribute('onclick') || '';
          const isMutating = target.type === 'submit' || 
            target.classList.contains('btn-del') || 
            target.classList.contains('btn-delete') || 
            target.classList.contains('btn-edit') || 
            target.classList.contains('btn-create-emp') ||
            target.classList.contains('preset-btn') ||
            /delete|remove|save|edit|toggle|add|create/i.test(onclickAttr);

          if (isMutating) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            showAdminNotification('عفواً، حسابك في وضع القراءة فقط لهذا القسم ولا يملك صلاحية إجراء التعديلات.');
            return false;
          }
        }
      }, true);

      document.addEventListener('submit', (e) => {
        if (!document.body.classList.contains('is-readonly-mode')) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        showAdminNotification('عفواً، حسابك في وضع القراءة فقط لهذا القسم ولا يملك صلاحية حفظ أو تعديل البيانات.');
        return false;
      }, true);
    }

    // Intercept client-side fetch API for mutating requests
    if (!window._readonlyFetchIntercepted) {
      window._readonlyFetchIntercepted = true;
      const originalFetch = window.fetch;
      window.fetch = async function(...args) {
        const options = args[1] || {};
        const method = (options.method || 'GET').toUpperCase();
        const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');

        if (document.body.classList.contains('is-readonly-mode') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
          if (!url.includes('/login') && !url.includes('/logout')) {
            console.warn('Blocked mutating request in read-only mode:', method, url);
            showAdminNotification('عفواً، حسابك في وضع القراءة فقط لهذا القسم ولا يملك صلاحية إجراء التعديلات.');
            return new Response(JSON.stringify({
              error: 'عفواً، حسابك في وضع القراءة فقط ولا يملك صلاحية التعديل أو الحفظ'
            }), {
              status: 403,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
        return originalFetch.apply(this, args);
      };
    }
  }

  // 3. Sidebar Filtering
  filterSidebarNavigation();
}

const AUTH_SESSION_VERSION = 'v2_rbac_2026';

function requireAdmin() {
  // Security: Prevent admin access on storefront domains
  const storefrontDomains = [];
  if (storefrontDomains.includes(window.location.hostname)) {
    window.location.href = '/';
    return false;
  }

  // Force all users to login again if session version does not match
  if (localStorage.getItem('adminSessionVersion') !== AUTH_SESSION_VERSION) {
    logout();
    return false;
  }

  const key = localStorage.getItem('adminKey');
  const timestamp = localStorage.getItem('loginTimestamp');

  if (!key) {
    window.location.href = 'login';
    return false;
  }

  // Check for 30-day timeout (30 * 24 * 60 * 60 * 1000)
  if (timestamp) {
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    if (Date.now() - parseInt(timestamp) > thirtyDays) {
      logout();
      return false;
    }
  }

  // Enforce section permissions for current page
  enforcePermissionsUI();

  return true;
}

function logout() {
  localStorage.removeItem('adminKey');
  localStorage.removeItem('adminUser');
  localStorage.removeItem('adminPermissions');
  localStorage.removeItem('loginTimestamp');
  localStorage.removeItem('adminSessionVersion');
  window.location.href = 'login';
}

// Session liveness check: forces employee to re-login immediately if permissions or status were changed
async function checkEmployeeSessionLiveness() {
  const key = localStorage.getItem('adminKey');
  if (!key || !key.startsWith('emp_')) return;

  try {
    if (typeof api !== 'undefined' && typeof api.getMe === 'function') {
      const res = await api.getMe();
      if (res && res.user) {
        if (res.user.permissions) {
          localStorage.setItem('adminPermissions', JSON.stringify(res.user.permissions));
        }
        localStorage.setItem('adminUser', JSON.stringify(res.user));
      }
    } else {
      const apiBase = (typeof window !== 'undefined' && window.API_BASE && !window.API_BASE.includes('PLACEHOLDER')) 
        ? window.API_BASE 
        : (typeof API_BASE !== 'undefined' && !API_BASE.includes('PLACEHOLDER') ? API_BASE : '/api');
      const res = await fetch(`${apiBase}/employees/me?_t=${Date.now()}`, {
        headers: { 'x-admin-key': key }
      });
      if (res.status === 401) {
        logout();
      }
    }
  } catch (e) {
    if (e && e.message && (e.message.includes('401') || e.message.includes('غير مصرح'))) {
      logout();
    }
  }
}

// Periodic check every 30 seconds
setInterval(checkEmployeeSessionLiveness, 30000);

// Global UI Helpers
document.addEventListener('DOMContentLoaded', () => {
  filterSidebarNavigation();

  // Sidebar Toggle (Delegated)
  document.addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('.sidebar-toggle');
    if (toggleBtn) {
      e.stopPropagation();
      const sidebar = document.querySelector('.admin-sidebar');
      if (sidebar) sidebar.classList.toggle('open');
    } else {
      // Close sidebar when clicking outside
      const sidebar = document.querySelector('.admin-sidebar');
      if (sidebar && sidebar.classList.contains('open') && !sidebar.contains(e.target)) {
        sidebar.classList.remove('open');
      }
    }
  });

  // Unsaved Changes Bar
  initUnsavedChangesBar();

  // Disable browser autocomplete/suggestions on all inputs
  const disableAutocomplete = () => {
    document.querySelectorAll('input, textarea').forEach(el => {
      el.setAttribute('autocomplete', 'off');
    });
  };
  disableAutocomplete();

  // Also watch for dynamically added elements (like modals)
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) { // Element
          if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') {
            node.setAttribute('autocomplete', 'off');
          }
          node.querySelectorAll?.('input, textarea').forEach(el => el.setAttribute('autocomplete', 'off'));
        }
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // ── PWA Initialization ──
  const initPWA = () => {
    // 1. Generate Dynamic Manifest with Store Logo
    let rawLogo = localStorage.getItem('loli_store_logo') || 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png';
    let storeLogo = 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png';
    try {
      storeLogo = new URL(rawLogo, window.location.origin).href;
    } catch (e) {}

    const storeName = localStorage.getItem('loli_store_name') || 'LoliShop Admin';

    const manifest = {
      "id": "loli-admin-v1",
      "name": storeName,
      "short_name": storeName.split(' ')[0],
      "description": "Store Management Dashboard",
      "start_url": window.location.origin + "/",
      "scope": window.location.origin + "/",
      "display": "standalone",
      "background_color": "#ffffff",
      "theme_color": "#64748b",
      "orientation": "portrait",
      "icons": [
        {
          "src": storeLogo,
          "sizes": "192x192",
          "type": "image/png",
          "purpose": "any"
        },
        {
          "src": storeLogo,
          "sizes": "512x512",
          "type": "image/png",
          "purpose": "any maskable"
        }
      ]
    };

    const manifestBlob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
    const manifestUrl = URL.createObjectURL(manifestBlob);

    let link = document.querySelector('link[rel="manifest"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'manifest';
      document.head.appendChild(link);
    }
    link.href = manifestUrl;

    // 2. Inject PWA Meta Tags
    const metaTags = [
      { name: 'mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
      { name: 'theme-color', content: '#64748b' }
    ];
    metaTags.forEach(tag => {
      if (!document.querySelector(`meta[name="${tag.name}"]`)) {
        const m = document.createElement('meta');
        m.name = tag.name;
        m.content = tag.content;
        document.head.appendChild(m);
      }
    });

    // 3. Unregister Service Worker (to prevent caching)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        for (const registration of registrations) {
          registration.unregister();
          console.log('Admin SW Unregistered');
        }
      });
    }

    // 4. Inject Notifications Script
    if (!document.querySelector('script[src*="notifications.js"]')) {
      const script = document.createElement('script');
      script.src = 'js/notifications.js';
      document.body.appendChild(script);
    }
  };
  initPWA();
});

function initUnsavedChangesBar() {
  if (document.body.hasAttribute('data-no-unsaved-bar')) return;

  // Inject CSS
  const style = document.createElement('style');
  style.textContent = `
    .unsaved-bar {
      position: fixed;
      top: -100px;
      left: 50%;
      transform: translateX(-50%);
      width: 90%;
      max-width: 600px;
      background: #1e293b;
      color: #fff;
      padding: 12px 24px;
      border-radius: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 10px 25px -5px rgba(0,0,0,0.3);
      z-index: 2000;
      transition: top 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      direction: rtl;
    }
    .unsaved-bar.visible {
      top: 20px;
    }
    .unsaved-bar span {
      font-weight: 600;
      font-size: 0.95rem;
    }
    .unsaved-actions {
      display: flex;
      gap: 12px;
    }
    .unsaved-btn {
      padding: 10px 28px;
      border-radius: 24px;
      font-weight: 700;
      font-size: 0.95rem;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      min-width: 140px;
    }
    .btn-save-changes {
      background: #10b981;
      color: #fff;
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);
    }
    .btn-save-changes:hover {
      background: #059669;
      transform: translateY(-1px);
      box-shadow: 0 6px 15px rgba(16, 185, 129, 0.3);
    }
    .btn-discard-changes {
      background: #475569;
      color: #fff;
    }
    .btn-discard-changes:hover {
      background: #334155;
    }
    @media (max-width: 600px) {
      .unsaved-bar {
        width: 95%;
        padding: 10px 16px;
        flex-direction: column;
        gap: 12px;
        border-radius: 16px;
        top: -150px;
      }
      .unsaved-bar.visible {
        top: 10px;
      }
      .unsaved-actions {
        width: 100%;
      }
      .unsaved-btn {
        flex: 1;
        padding: 10px;
      }
    }
  `;
  document.head.appendChild(style);

  // Inject HTML
  const bar = document.createElement('div');
  bar.className = 'unsaved-bar';
  bar.id = 'unsaved-changes-bar';
  bar.innerHTML = `
    <div class="unsaved-actions">
      <button class="unsaved-btn btn-discard-changes" id="btn-global-discard">تجاهل</button>
      <button class="unsaved-btn btn-save-changes" id="btn-global-save">احفظ التغييرات</button>
    </div>
  `;
  document.body.appendChild(bar);

  let hasChanges = false;

  window.markAsModified = () => {
    hasChanges = true;
    const b = document.getElementById('unsaved-changes-bar');
    if (b) b.classList.add('visible');
  };

  window.hideBar = () => {
    hasChanges = false;
    bar.classList.remove('visible');
  };

  const isSelectionControl = (el) => {
    if (!el) return false;
    return (el.id && el.id.startsWith('select-all')) ||
      el.classList.contains('row-checkbox') ||
      el.classList.contains('order-checkbox') ||
      el.classList.contains('product-checkbox') ||
      el.classList.contains('collection-checkbox') ||
      el.classList.contains('selection-checkbox') ||
      el.classList.contains('pli-checkbox') ||
      el.classList.contains('product-select-cb') ||
      el.classList.contains('product-variant-cb');
  };

  // Detect changes
  document.addEventListener('input', (e) => {
    // Ignore inputs inside modals (like product selection modal)
    if (e.target.closest('.modal-overlay') || e.target.closest('.modal-box') || e.target.closest('.hp-modal') || e.target.closest('[id*="modal"]')) return;

    // Ignore selection controls
    if (isSelectionControl(e.target)) return;

    // Ignore search inputs
    if (e.target.type === 'search' || e.target.id?.includes('search') || e.target.classList.contains('search-input') || e.target.placeholder?.includes('ابحث')) return;

    // Ignore specific elements like the Live Preview input
    if (e.target.id === 'sim-subtotal' || e.target.classList.contains('ignore-unsaved')) return;

    if (e.target.closest('form') || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
      window.markAsModified();
    }
  });

  document.addEventListener('change', (e) => {
    if (e.target.closest('.modal-overlay') || e.target.closest('.modal-box') || e.target.closest('.hp-modal') || e.target.closest('[id*="modal"]')) return;

    // Ignore selection controls
    if (isSelectionControl(e.target)) return;

    // Ignore search inputs
    if (e.target.type === 'search' || e.target.id?.includes('search') || e.target.classList.contains('search-input') || e.target.placeholder?.includes('ابحث')) return;

    if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox' || e.target.type === 'radio') {
      window.markAsModified();
    }
  });

  // Action: Discard
  document.getElementById('btn-global-discard').addEventListener('click', () => {
    if (window.handleGlobalDiscard) {
      window.handleGlobalDiscard();
    } else {
      location.reload();
    }
  });

  // Action: Save
  document.getElementById('btn-global-save').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (btn.disabled) return;

    const oldText = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2.5px;margin:0;"></span> جاري الحفظ...';

    try {
      if (window.handleGlobalSave) {
        const success = await window.handleGlobalSave();
        if (success !== false) window.hideBar();
      } else {
        // Fallback: try to find a primary save button and click it
        const primaryBtn = document.querySelector('button[type="submit"], .btn-primary, #save-btn');
        if (primaryBtn) {
          primaryBtn.click();
          window.hideBar();
        } else {
          console.warn('Global save handler not implemented for this page.');
        }
      }
    } catch (err) {
      console.error('Global save error:', err);
    } finally {
      btn.disabled = false;
      btn.textContent = oldText;
    }
  });

  // Enforce numbers only on type="number" fields
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type === 'number') {
      // Allow: backspace, delete, tab, escape, enter, . (190, 110), - (189, 109)
      if ([46, 8, 9, 27, 13, 110, 190, 189, 109].indexOf(e.keyCode) !== -1 ||
         (e.keyCode === 65 && (e.ctrlKey === true || e.metaKey === true)) ||
         (e.keyCode >= 35 && e.keyCode <= 40)) {
             return;
      }
      // Stop the keypress if it's not a number
      if ((e.shiftKey || (e.keyCode < 48 || e.keyCode > 57)) && (e.keyCode < 96 || e.keyCode > 105)) {
          e.preventDefault();
      }
    }
  });
}

function toggleSidebarDropdown(btn) {
  const container = btn.closest('.admin-nav-dropdown-container');
  if (container) {
    container.classList.toggle('is-active');
  }
}
