// ── Immediate Branding Removed (Static Branding applied) ──────────
const RAW_API_BASE = 'API_URL_PLACEHOLDER';
const getNormalizedApiBase = () => {
  let raw = (typeof window !== 'undefined' && window.API_BASE && window.API_BASE !== 'API_URL_PLACEHOLDER')
    ? window.API_BASE
    : RAW_API_BASE;
  if (!raw || raw.includes('API_URL_PLACEHOLDER')) {
    raw = 'https://onlinestore-api-hju3.onrender.com/api';
  }
  const clean = raw.trim().replace(/\/+$/, '');
  return clean.endsWith('/api') ? clean : `${clean}/api`;
};
const API_BASE = getNormalizedApiBase();

const api = {
  _adminKey() { return localStorage.getItem('adminKey') || ''; },

  _pendingRequests: {}, // Deduplicate in-flight requests
  _memoryCache: {}, // In-memory cache

  async _request(path, opts = {}) {
    const cacheKey = `api_cache_${path}`;
    if (opts.useCache) {
      const cached = this._memoryCache[cacheKey];
      if (cached) {
        if (Date.now() - cached.time < 60000) return cached.data; // 1 min cache
      }
    }

    const method = (opts.method || 'GET').toUpperCase();
    const reqKey = `${method}_${path}`;

    if (method === 'GET' && this._pendingRequests[reqKey]) {
      return this._pendingRequests[reqKey];
    }

    const promise = (async () => {
      const headers = { ...(opts.headers || {}) };
      if (method !== 'GET') {
        headers['Content-Type'] = 'application/json';
      }
      if (opts.admin) headers['x-admin-key'] = this._adminKey();

      if (opts.useCache !== true && method === 'GET') {
        opts.cache = 'no-store';
        path += (path.includes('?') ? '&' : '?') + '_t=' + Date.now();
      }

      const base = getNormalizedApiBase();
      const fullUrl = `${base}${path}`.replace('/api/api/', '/api/');
      const res = await fetch(fullUrl, { ...opts, headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      if (opts.useCache) {
        this._memoryCache[cacheKey] = { data, time: Date.now() };
      }
      return data;
    })();

    if (method === 'GET') {
      this._pendingRequests[reqKey] = promise;
      promise.finally(() => {
        if (this._pendingRequests[reqKey] === promise) {
          delete this._pendingRequests[reqKey];
        }
      });
    }

    return promise;
  },

  // Products
  getProducts(page, limit, admin = true, collectionId = '', search = '', hasOptions = '', status = '') {
    let url = `/products?admin=${admin}`;
    if (page) url += `&page=${page}`;
    if (limit) url += `&limit=${limit}`;
    if (collectionId) url += `&collectionId=${collectionId}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (hasOptions) url += `&hasOptions=${hasOptions}`;
    if (status) url += `&status=${status}`;
    return this._request(url, { useCache: !admin });
  },
  searchProducts(query) {
    return this._request(`/products?admin=false&search=${encodeURIComponent(query)}`);
  },
  getProductsByCollection(collectionId, limit = 0) {
    let url = `/products?collectionId=${collectionId}`;
    if (limit > 0) url += `&limit=${limit}`;
    return this._request(url);
  },
  getProduct(id) { return this._request(`/products/${id}`); },
  getProductByHandle(handle) { return this._request(`/products/handle/${handle}`); },
  createProduct(d) { return this._request('/products', { method: 'POST', body: JSON.stringify(d), admin: true }); },
  updateProduct(id, d) { return this._request(`/products/${id}`, { method: 'PUT', body: JSON.stringify(d), admin: true }); },
  deleteProduct(id) { return this._request(`/products/${id}`, { method: 'DELETE', admin: true }); },
  deleteProductsBatch(productIds) { return this._request('/products/delete/batch', { method: 'POST', body: JSON.stringify({ productIds }), admin: true }); },
  deactivateProductsBatch(productIds) { return this._request('/products/deactivate/batch', { method: 'POST', body: JSON.stringify({ productIds }), admin: true }); },
  reorderProducts(order) { return this._request('/products/reorder/batch', { method: 'PUT', body: JSON.stringify({ order }), admin: true }); },

  // Collections
  getCollections() { return this._request('/collections', { useCache: true }); },
  getCollection(id) {
    return this._request(`/collections/${id}`);
  },
  createCollection(d) { return this._request('/collections', { method: 'POST', body: JSON.stringify(d), admin: true }); },
  updateCollection(id, d) { return this._request(`/collections/${id}`, { method: 'PUT', body: JSON.stringify(d), admin: true }); },
  deleteCollection(id) { return this._request(`/collections/${id}`, { method: 'DELETE', admin: true }); },
  deleteCollectionsBatch(collectionIds) { return this._request('/collections/delete/batch', { method: 'POST', body: JSON.stringify({ collectionIds }), admin: true }); },

  // Orders
  createOrder(d) { return this._request('/orders', { method: 'POST', body: JSON.stringify(d) }); },
  getOrders(archived = false, page = 1, limit = 50, status = 'all', search = '') {
    let url = `/orders?archived=${archived}`;
    if (page) url += `&page=${page}`;
    if (limit) url += `&limit=${limit}`;
    if (status && status !== 'all') url += `&status=${status}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    return this._request(url, { admin: true });
  },
  getOrder(id) { return this._request(`/orders/${id}`, { admin: true }); },
  getPublicOrder(id) { return this._request(`/orders/public/${id}`); },
  updateOrder(id, d) { return this._request(`/orders/${id}`, { method: 'PUT', body: JSON.stringify(d), admin: true }); },
  deleteOrder(id) { return this._request(`/orders/${id}`, { method: 'DELETE', admin: true }); },
  archiveOrders(orderIds) { return this._request('/orders/archive/batch', { method: 'POST', body: JSON.stringify({ orderIds }), admin: true }); },
  unarchiveOrders(orderIds) { return this._request('/orders/unarchive/batch', { method: 'POST', body: JSON.stringify({ orderIds }), admin: true }); },
  cancelOrder(id) { return this._request(`/orders/${id}/cancel`, { method: 'POST', admin: true }); },
  cancelOrdersBatch(orderIds) { return this._request('/orders/cancel/batch', { method: 'POST', body: JSON.stringify({ orderIds }), admin: true }); },
  deleteOrdersBatch(orderIds) { return this._request('/orders/delete/batch', { method: 'POST', body: JSON.stringify({ orderIds }), admin: true }); },

  // Abandoned Carts
  saveAbandonedCart(d) { return this._request('/abandoned-carts', { method: 'POST', body: JSON.stringify(d) }); },
  getAbandonedCarts(page = 1, limit = 50) { return this._request(`/abandoned-carts?page=${page}&limit=${limit}`, { admin: true }); },
  getDashboardStats() { return this._request('/stats/dashboard', { admin: true }); },
  deleteAbandonedCart(id) { return this._request(`/abandoned-carts/${id}`, { method: 'DELETE', admin: true }); },
  deleteAbandonedCartByToken(token) { return this._request(`/abandoned-carts/token/${token}`, { method: 'DELETE' }); },
  getPublicAbandonedCart(token) { return this._request(`/abandoned-carts/public/${token}`); },

  // Customers
  getCustomers() { return this._request('/customers', { admin: true }); },
  getCustomer(phone) { return this._request(`/customers/${phone}`, { admin: true }); },

  // Shipping
  getShipping() { return this._request('/shipping', { useCache: true }); },
  getPublicShipping() { return this.getShipping(); },
  getZones(cityId) { return this._request(`/shipping/zones/${cityId}`, { useCache: true }); },
  getShippingList() { return this._request('/shipping/list', { admin: true }); },
  createShipping(d) { return this._request('/shipping', { method: 'POST', body: JSON.stringify(d), admin: true }); },
  updateShipping(id, d) { return this._request(`/shipping/${id}`, { method: 'PUT', body: JSON.stringify(d), admin: true }); },
  deleteShipping(id) { return this._request(`/shipping/${id}`, { method: 'DELETE', admin: true }); },

  // Webhooks
  getWebhooks() { return this._request('/webhooks', { admin: true }); },
  createWebhook(d) { return this._request('/webhooks', { method: 'POST', body: JSON.stringify(d), admin: true }); },
  updateWebhook(id, d) { return this._request(`/webhooks/${id}`, { method: 'PUT', body: JSON.stringify(d), admin: true }); },
  deleteWebhook(id) { return this._request(`/webhooks/${id}`, { method: 'DELETE', admin: true }); },

  // Settings
  getSetting(key) { return this._request(`/settings/${key}`, { useCache: true }); },
  updateSetting(key, value) { return this._request(`/settings/${key}`, { method: 'POST', body: JSON.stringify({ value }), admin: true }); },
  clearCache() { return this._request('/settings/clear-cache', { method: 'POST', admin: true }); },

  // Auth check
  async checkAdmin() {
    try { await this._request('/orders', { admin: true }); return true; }
    catch { return false; }
  },

  // Visitors
  trackVisitor() { return this._request('/visitors/track', { method: 'POST' }); },

  // File Upload
  uploadFile(file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/upload`, true);
      xhr.setRequestHeader('x-admin-key', this._adminKey());

      if (onProgress && xhr.upload) {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percentComplete = Math.round((e.loaded / e.total) * 100);
            onProgress(percentComplete);
          }
        });
      }

      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch (e) { resolve({}); }
        } else {
          try {
            reject(new Error(JSON.parse(xhr.responseText).error));
          } catch (e) { reject(new Error('Upload failed')); }
        }
      };

      xhr.onerror = () => reject(new Error('Network Error'));

      const formData = new FormData();
      formData.append('image', file);
      xhr.send(formData);
    });
  },

  uploadImage(file, prefix) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/upload`, true);

      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch (e) { resolve({}); }
        } else {
          try {
            reject(new Error(JSON.parse(xhr.responseText).error));
          } catch (e) { reject(new Error('Upload failed')); }
        }
      };

      xhr.onerror = () => reject(new Error('Network Error'));

      const formData = new FormData();
      formData.append('image', file);
      if (prefix) formData.append('prefix', prefix);
      xhr.send(formData);
    });
  },

  importProducts(file, deleteAll, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/products/import`, true);
      xhr.setRequestHeader('x-admin-key', this._adminKey());

      if (onProgress && xhr.upload) {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percentComplete = Math.round((e.loaded / e.total) * 100);
            onProgress(percentComplete);
          }
        });
      }

      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch (e) { resolve({}); }
        } else {
          try {
            reject(new Error(JSON.parse(xhr.responseText).error));
          } catch (e) { reject(new Error('Import failed')); }
        }
      };

      xhr.onerror = () => reject(new Error('Network Error'));

      const formData = new FormData();
      formData.append('file', file);
      formData.append('deleteAll', deleteAll);
      xhr.send(formData);
    });
  },

  formatZoneName(z) {
    if (!z) return '';
    const main = (z.zoneOtherName || z.otherName || z.name || '').trim();
    const dist = (z.districtOtherName || z.districtName || '').trim();
    
    const normalize = (s) => s.toLowerCase()
      .replace(/[أإآا]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/\s+/g, '')
      .trim();

    if (dist && normalize(dist) !== normalize(main)) {
      return `${main} - ${dist}`;
    }
    return main;
  }
};

// ── Toast notification ─────────────────────────────────
function showToast(msg, type = 'success') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast${type === 'error' ? ' error' : type === 'success' ? ' success' : ''}`;
  toast.innerHTML = `
    <span style="flex:1">${msg}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove?.(), 4500);
}

// ── Global Confirm Modal ────────────────────────────────
window.showConfirmModal = function (title, message) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
    modal.innerHTML = `
      <div style="background:#fff; border-radius:16px; max-width:450px; width:90%; padding:0; box-shadow:0 20px 60px rgba(0,0,0,0.15); overflow:hidden;">
        <div style="padding:24px 24px 8px; text-align:center;">
          <div style="width:48px;height:48px;background:#fef2f2;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
          </div>
          <h3 style="margin:0 0 8px; font-size:1.15rem; color:#1e293b; font-weight:700;">${title}</h3>
          ${message ? `<p style="margin:0; color:#64748b; font-size:0.95rem; line-height:1.5;">${message}</p>` : ''}
        </div>
        <div style="padding:16px 24px 24px; display:flex; gap:12px; justify-content:center;">
          <button type="button" id="confirm-yes" style="background:#ef4444; color:#fff; border:none; border-radius:12px; padding:10px 36px; font-weight:600; font-size:0.95rem; cursor:pointer; transition:background 0.2s;">تأكيد</button>
          <button type="button" id="confirm-no" style="background:#f8fafc; color:#1e293b; border:1px solid #e2e8f0; border-radius:12px; padding:10px 36px; font-weight:600; font-size:0.95rem; cursor:pointer; transition:background 0.2s;">إلغاء</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#confirm-yes').onclick = () => {
      modal.remove();
      resolve(true);
    };
    modal.querySelector('#confirm-no').onclick = () => {
      modal.remove();
      resolve(false);
    };
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.remove();
        resolve(false);
      }
    };
  });
};

// ── Currency formatter ─────────────────────────────────
function formatPrice(p) {
  return `${Math.round(Number(p || 0)).toLocaleString('ar-EG', { useGrouping: false })} ج.م`;
}

// ── Optimize image URL utility ────────────────────────
api.optimizeImageUrl = function(url, width) {
  if (!url || typeof url !== 'string') {
    return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0iI2Y1ZjVmNSIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSIxOCIgZmlsbD0iI2FhYSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPk5vIEltYWdlPC90ZXh0Pjwvc3ZnPg==';
  }

  // Bypass if it's already an R2 URL (pre-optimized by backend sharp)
  if (url.includes('r2.dev') || url.includes('r2.cloudflarestorage.com') || url.includes('pub-')) {
    return url;
  }

  if (url.includes('res.cloudinary.com')) {
    let cleanUrl = url.replace(/\.(png|jpe?g|gif)$/i, '.webp');
    const parts = cleanUrl.split('/upload/');
    if (parts.length === 2) {
      const prefix = parts[0] + '/upload';
      const rest = parts[1].replace(/^(?:[a-z]+_[^/,]+(?:,[a-z]+_[^/,]+)*)\//i, '');
      
      // OPTIMIZATION: If width is requested (thumbnail), use quantized widths and eco quality to save massive bandwidth.
      if (width) {
        const w = width <= 150 ? 150 : 400; // Snap to 150 or 400 to limit transformations
        return `${prefix}/f_auto,q_auto:eco,w_${w}/${rest}`;
      }
      // If no width requested (main image), serve raw pre-optimized WebP (0 transformations)
      return `${prefix}/${rest}`;
    }
  }
  return url;
};

// ── Mobile sidebar toggle (auto-init) ─────────────────
document.addEventListener('DOMContentLoaded', () => {
  const sidebar = document.querySelector('.admin-sidebar');
  const toggle = document.querySelector('.sidebar-toggle');
  if (sidebar && toggle) {
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      sidebar.classList.toggle('open');
    });

    sidebar.querySelectorAll('.admin-nav a').forEach(a => {
      a.addEventListener('click', () => {
        if (window.innerWidth < 960) sidebar.classList.remove('open');
      });
    });

    document.addEventListener('click', (e) => {
      if (window.innerWidth < 960 && sidebar.classList.contains('open')) {
        const nav = sidebar.querySelector('.admin-nav');
        if (nav && !nav.contains(e.target) && !toggle.contains(e.target)) {
          sidebar.classList.remove('open');
        }
      }
    });
  }
});

// ── Dynamic Settings Loader Removed ──────────────────────────────
function applyColorPalette(hex) {
  if (!hex || hex.length < 7) return;
  try {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);

    const root = document.documentElement;
    root.style.setProperty('--primary', hex);

    // Hover: 15% darker
    const hr = Math.max(0, Math.floor(r * 0.85));
    const hg = Math.max(0, Math.floor(g * 0.85));
    const hb = Math.max(0, Math.floor(b * 0.85));
    const hover = `rgb(${hr}, ${hg}, ${hb})`;
    root.style.setProperty('--primary-hover', hover);

    // Light: very transparent
    const light = `rgba(${r}, ${g}, ${b}, 0.08)`;
    root.style.setProperty('--primary-light', light);

    // Legacy support for older css var names
    root.style.setProperty('--primary', hex);
    root.style.setProperty('--primary-dark', hover);
  } catch (e) {
    console.error('Failed to apply color palette', e);
  }
}

// --- Global Slide Menu Logic ---
api.openMenu = function () {
  if (!document.getElementById('slide-menu-overlay')) {
    const menuHTML = `
      <div class="slide-cart-overlay" id="slide-menu-overlay" onclick="api.closeMenu()"></div>
      <div class="slide-menu" id="slide-menu-container">
        <div class="slide-menu-header">
          <h3 style="margin:0; font-size:1.15rem; font-weight:700">التصنيفات</h3>
          <button class="slide-cart-back" onclick="api.closeMenu()" style="transform:scaleX(-1)">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        <div class="slide-menu-body" id="slide-menu-body">
          <div style="padding:15px; display:flex; flex-direction:column; gap:12px;">
            <div style="height:45px; background:#f1f5f9; border-radius:8px; animation: pulse 1.5s infinite;"></div>
            <div style="height:45px; background:#f1f5f9; border-radius:8px; animation: pulse 1.5s infinite;"></div>
            <div style="height:45px; background:#f1f5f9; border-radius:8px; animation: pulse 1.5s infinite;"></div>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', menuHTML);

    api.getCollections().then(cols => {
      const body = document.getElementById('slide-menu-body');
      if (!cols || cols.length === 0) {
        body.innerHTML = '<div style="padding:20px;text-align:center;color:#999">لا توجد تصنيفات</div>';
        return;
      }
      body.innerHTML = `
        <a href="/products" class="slide-menu-item" onclick="api.closeMenu()" style="font-weight:700; color:var(--primary); border-bottom: 2px solid #f1f5f9; background: #f8fafc;">كل المنتجات</a>
      ` + cols.map(c => `<a href="/collection/${c.urlName || c._id}" class="slide-menu-item" onclick="api.closeMenu()">${c.name}</a>`).join('');
    }).catch(err => {
      document.getElementById('slide-menu-body').innerHTML = '<div style="padding:20px;text-align:center;color:red">حدث خطأ</div>';
    });
  }

  document.getElementById('slide-menu-overlay').classList.add('open');
  document.getElementById('slide-menu-container').classList.add('open');
};

api.closeMenu = function () {
  const overlay = document.getElementById('slide-menu-overlay');
  const container = document.getElementById('slide-menu-container');
  if (overlay) overlay.classList.remove('open');
  if (container) container.classList.remove('open');
};

// --- Global Search Logic ---
api.openSearch = function () {
  if (!document.getElementById('search-overlay')) {
    const searchHTML = `
      <div class="search-overlay" id="search-overlay">
        <div class="search-box">
          <div class="search-input-row">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" id="global-search-input" placeholder="ابحث عن منتجات..." autocomplete="off">
            <button class="search-close-btn" onclick="api.closeSearch()">✕</button>
          </div>
          <div class="search-results" id="global-search-results"></div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', searchHTML);

    const input = document.getElementById('global-search-input');
    const results = document.getElementById('global-search-results');

    let debounce;
    input.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      clearTimeout(debounce);
      if (q.length < 2) {
        results.innerHTML = '';
        return;
      }
      debounce = setTimeout(async () => {
        results.innerHTML = '<div class="search-loading">جاري البحث...</div>';
        try {
          const filtered = await api.searchProducts(q);
          if (!filtered || filtered.length === 0) {
            results.innerHTML = '<div class="search-empty">لا توجد نتائج</div>';
            return;
          }
          results.innerHTML = filtered.map(p => `
            <a href="/product/${p.handle || p._id}" class="search-result-item">
              <img src="${api.optimizeImageUrl(p.imageUrl, 100)}" class="search-result-img" loading="lazy" decoding="async" onerror="this.style.display='none'">
              <div class="search-result-info">
                <div class="search-result-name">${p.name}</div>
                <div class="search-result-price">${p.salePrice || p.basePrice} ج.م</div>
              </div>
            </a>
          `).join('');
        } catch (err) {
          results.innerHTML = '<div class="search-empty">خطأ في التحميل</div>';
        }
      }, 300);
    });

    document.getElementById('search-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'search-overlay') api.closeSearch();
    });
  }

  const overlay = document.getElementById('search-overlay');
  overlay.classList.add('open');
  document.getElementById('global-search-input').focus();
  document.body.style.overflow = 'hidden';
};

api.closeSearch = function () {
  const overlay = document.getElementById('search-overlay');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
};

// ── Global Number Input Wheel Prevention ──────────────
document.addEventListener('wheel', (e) => {
  if (document.activeElement && document.activeElement.type === 'number') {
    document.activeElement.blur();
  }
}, { passive: true });

// ── Track Visitor ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (window.location.pathname.startsWith('/admin') || window.location.pathname.startsWith('/login')) return;
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const visitKey = `visited_${currentMonth}`;
  
  if (!localStorage.getItem(visitKey)) {
    api.trackVisitor().then(() => {
      localStorage.setItem(visitKey, 'true');
    }).catch(err => console.error('Failed to track visitor', err));
  }

  // Populate WhatsApp link globally
  const waLink = document.getElementById('nav-wa-link');
  if (waLink) {
    api.getSetting('loli_global_settings').then(settings => {
      if (settings && settings.socialWa) {
        let waNumber = settings.socialWa.replace(/[^0-9]/g, '');
        if (waNumber.startsWith('01')) waNumber = '2' + waNumber;
        waLink.href = `https://wa.me/${waNumber}`;
      } else {
        waLink.style.display = 'none';
      }
    }).catch(err => console.error('Failed to load WhatsApp link', err));
  }

  // Inject sticky category bar globally
  const excludedPaths = ['/cart', '/checkout', '/order-success'];
  const isExcluded = excludedPaths.some(p => window.location.pathname.includes(p));
  const header = document.querySelector('.store-header');
  if (header && !isExcluded) {
    const catBarWrapper = document.createElement('div');
    catBarWrapper.className = 'sticky-cat-bar-wrapper';
    catBarWrapper.innerHTML = '<div class="container"><div class="sticky-cat-bar"><div class="sticky-cat-track" id="global-cat-track"></div></div></div>';
    header.appendChild(catBarWrapper);

    api.getCollections().then(cols => {
      const track = document.getElementById('global-cat-track');
      const catBar = catBarWrapper.querySelector('.sticky-cat-bar');
      if (cols && cols.length > 0) {
        const renderBlock = (list) => list.map(c => `
          <a href="/collection/${c.urlName || c._id}" class="cat-badge">
            <div class="cat-badge-img-wrapper">
              <img src="${api.optimizeImageUrl(c.imageUrl, 100) || '/assets/logo.webp?v=20260927_v3'}" alt="${c.name}" loading="lazy" decoding="async">
            </div>
            <span class="cat-badge-name">${c.name}</span>
          </a>
        `).join('');

        track.innerHTML = renderBlock(cols);

        // JS Auto-scroll logic (allows manual scrolling + fixes mobile stickiness)
        let isHovered = false;
        let isTouching = false;
        let pauseTimeout = null;

        const autoScroll = () => {
          if (!isHovered && !isTouching) {
            const prevScroll = catBar.scrollLeft;
            catBar.scrollBy({ left: -1 });

            // If it hits the end, start from the beginning
            if (catBar.scrollLeft === prevScroll) {
              catBar.scrollLeft = 0;
            }
          }
          requestAnimationFrame(autoScroll);
        };

        catBar.addEventListener('mouseenter', () => isHovered = true);
        catBar.addEventListener('mouseleave', () => isHovered = false);

        catBar.addEventListener('touchstart', () => {
          isTouching = true;
          if (pauseTimeout) clearTimeout(pauseTimeout);
        }, { passive: true });
        
        catBar.addEventListener('touchend', () => {
          if (pauseTimeout) clearTimeout(pauseTimeout);
          pauseTimeout = setTimeout(() => { isTouching = false; }, 300);
        }, { passive: true });

        requestAnimationFrame(autoScroll);
      } else {
        catBar.style.display = 'none';
      }
    }).catch(err => console.error('Failed to load categories', err));
  }
});
