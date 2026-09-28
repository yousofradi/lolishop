/** Admin orders management */
let showingArchived = false;

document.addEventListener('DOMContentLoaded', () => {
  if (!requireAdmin()) return;
  syncLimitUI();
  document.body.classList.add('is-loading');
  loadOrders();
});

let allOrdersData = [];
let currentFilter = 'all';
let currentPage = 1;
const savedLimit = parseInt(localStorage.getItem('admin_orders_limit'));
let currentLimit = [50, 150, 250, 350].includes(savedLimit) ? savedLimit : 50;
let totalPages = 1;

let paymentMethodsCache = [];
let paymentNotesCache = '';

async function loadOrders() {
  const tbody = document.getElementById('orders-tbody');
  const selectAllCb = document.getElementById('select-all-orders');
  if (selectAllCb) selectAllCb.checked = false;
  updateArchiveButton();

  tbody.innerHTML = '<tr><td colspan="10" class="text-center" style="padding:32px;"><div class="spinner"></div></td></tr>';
  try {
    const searchInput = document.getElementById('order-search');
    const query = searchInput ? searchInput.value.trim() : '';
    
    const [ordersRes, globalSettings, adminSettings] = await Promise.all([
      api.getOrders(showingArchived, currentPage, currentLimit, currentFilter, query),
      api.getSetting('loli_global_settings').catch(() => null),
      api.getSetting('admin_global_settings').catch(() => null)
    ]);
    
    // Support both paginated format and fallback flat format
    if (ordersRes && ordersRes.orders) {
      allOrdersData = ordersRes.orders;
      totalPages = ordersRes.totalPages || 1;
      updatePaginationInfo(ordersRes.totalCount || allOrdersData.length);
      updateFilterCounts(ordersRes.totalCount || allOrdersData.length);
    } else {
      allOrdersData = ordersRes || [];
      totalPages = Math.ceil(allOrdersData.length / currentLimit) || 1;
      updatePaginationInfo(allOrdersData.length);
      updateFilterCounts(allOrdersData.length);
    }
    
    // Webhook uses loli_global_settings for paymentMethods and paymentNotes
    if (globalSettings) {
      paymentMethodsCache = globalSettings.paymentMethods || [];
      paymentNotesCache = globalSettings.paymentNotes || '';
    } else if (adminSettings) {
      // Fallback
      paymentMethodsCache = adminSettings.paymentMethods || [];
      paymentNotesCache = adminSettings.paymentNotes || '';
    }
    
    renderOrders(allOrdersData);
  } catch (err) {
    console.error(err);
    tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted">فشل تحميل الطلبات</td></tr>';
  } finally {
    document.body.classList.remove('is-loading');
  }
}

async function loadOrdersSilently() {
  try {
    const searchInput = document.getElementById('order-search');
    const query = searchInput ? searchInput.value.trim() : '';
    
    const ordersRes = await api.getOrders(showingArchived, currentPage, currentLimit, currentFilter, query);
    
    if (ordersRes && ordersRes.orders) {
      allOrdersData = ordersRes.orders;
      totalPages = ordersRes.totalPages || 1;
      updatePaginationInfo(ordersRes.totalCount || allOrdersData.length);
      updateFilterCounts(ordersRes.totalCount || allOrdersData.length);
    } else {
      allOrdersData = ordersRes || [];
      totalPages = Math.ceil(allOrdersData.length / currentLimit) || 1;
      updatePaginationInfo(allOrdersData.length);
      updateFilterCounts(allOrdersData.length);
    }
    
    renderOrders(allOrdersData);
  } catch (err) {
    console.warn('Auto-refresh failed silently (network issue or server offline):', err.message || err);
  }
}

// Auto refresh every 30 seconds
setInterval(loadOrdersSilently, 30000);

window.setFilter = function (filter) {
  currentFilter = filter;
  currentPage = 1; // Reset to page 1 on filter change
  document.querySelectorAll('.order-tab').forEach(el => el.classList.remove('active'));
  document.querySelector(`.order-tab[data-filter="${filter}"]`)?.classList.add('active');

  if (filter === 'archived') {
    if (!showingArchived) {
      showingArchived = true;
      loadOrders();
      return;
    }
  } else {
    if (showingArchived) {
      showingArchived = false;
      loadOrders();
      return;
    }
  }
  loadOrders();
};

window.filterOrdersClient = function () {
  // We no longer filter client-side. A search input change should trigger a server load.
  currentPage = 1;
  loadOrders();
};

function updatePaginationInfo(total) {
  const infoEl = document.getElementById('pagination-info');
  const pageDropdown = document.getElementById('page-dropdown');
  const prevBtn = document.getElementById('prev-page');
  const nextBtn = document.getElementById('next-page');

  if (infoEl) infoEl.textContent = total.toString();
  if (prevBtn) prevBtn.disabled = currentPage <= 1;
  if (nextBtn) nextBtn.disabled = currentPage >= totalPages;

  if (pageDropdown) {
    let optionsHtml = '';
    for (let i = 1; i <= totalPages; i++) {
      optionsHtml += `<option value="${i}" ${i === currentPage ? 'selected' : ''}>${i}</option>`;
    }
    pageDropdown.innerHTML = optionsHtml;
  }
}

window.changePage = function(delta) {
  const newPage = currentPage + delta;
  if (newPage < 1 || newPage > totalPages) return;
  currentPage = newPage;
  loadOrders();
};

window.goToPage = function(page) {
  currentPage = parseInt(page) || 1;
  loadOrders();
};

function syncLimitUI() {
  const labelEl = document.getElementById('current-limit-label');
  if (labelEl) labelEl.textContent = currentLimit.toString();

  document.querySelectorAll('.limit-option').forEach(el => {
    if (parseInt(el.getAttribute('data-limit')) === currentLimit) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });
}

window.toggleOrdersLimitMenu = function(event) {
  if (event) event.stopPropagation();
  const menu = document.getElementById('orders-limit-menu');
  const arrow = document.getElementById('orders-limit-arrow');
  if (!menu) return;
  const isShow = menu.classList.contains('show');
  if (isShow) {
    menu.classList.remove('show');
    if (arrow) arrow.style.transform = 'rotate(0deg)';
  } else {
    menu.classList.add('show');
    if (arrow) arrow.style.transform = 'rotate(180deg)';
  }
};

window.setOrdersLimit = function(limit) {
  limit = parseInt(limit) || 50;
  currentLimit = [50, 150, 250, 350].includes(limit) ? limit : 50;
  try {
    localStorage.setItem('admin_orders_limit', limit);
  } catch (e) {}
  syncLimitUI();

  const menu = document.getElementById('orders-limit-menu');
  const arrow = document.getElementById('orders-limit-arrow');
  if (menu) menu.classList.remove('show');
  if (arrow) arrow.style.transform = 'rotate(0deg)';

  currentPage = 1;
  loadOrders();
};

document.addEventListener('click', (e) => {
  const wrapper = document.getElementById('orders-limit-wrapper');
  const menu = document.getElementById('orders-limit-menu');
  const arrow = document.getElementById('orders-limit-arrow');
  if (menu && wrapper && !wrapper.contains(e.target)) {
    menu.classList.remove('show');
    if (arrow) arrow.style.transform = 'rotate(0deg)';
  }
});

window.updateFilterCounts = function (totalCount = 0) {
  // Update the badge of the currently active tab
  const activeTab = document.querySelector('.order-tab.active');
  if (activeTab) {
    const badge = activeTab.querySelector('.tab-badge');
    if (badge) {
      badge.textContent = totalCount;
      badge.style.display = 'inline-block';
    }
  }

  // Hide badges for inactive tabs
  document.querySelectorAll('.order-tab:not(.active)').forEach(tab => {
    const badge = tab.querySelector('.tab-badge');
    if (badge) {
      badge.style.display = 'none';
    }
  });
};

function renderOrders(orders) {
  const tbody = document.getElementById('orders-tbody');

  // Preserve selected checkboxes
  const selectedIds = Array.from(document.querySelectorAll('.order-checkbox:checked')).map(cb => cb.value);

  const table = document.querySelector('.orders-table-wrap table');
  const thead = table ? table.querySelector('thead') : null;

  if (!orders.length) {
    if (table) table.style.minWidth = '0'; // Prevent scrolling for empty state
    if (thead) thead.style.display = 'none'; // Hide headers so it doesn't force width
    tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted" style="padding:40px; text-align:center;">لا توجد طلبات هنا</td></tr>';
    return;
  }
  
  if (table) table.style.minWidth = '900px'; // Restore minimum width for data
  if (thead) thead.style.display = ''; // Show headers


  tbody.innerHTML = orders.map(o => {
    const isChecked = selectedIds.includes(o.orderId) ? 'checked' : '';
    // Format date as "27 أبريل 2026"
    const dateObj = new Date(o.createdAt);
    const dateStr = dateObj.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });

    // Payment badge
    let payBadge = '';
    if (o.paymentMethod === 'vodafone_cash') {
      payBadge = `<span style="display:inline-block; padding:4px 12px; border-radius:16px; background:#fce7f3; color:#9d174d; font-size:0.85rem; font-weight:600;">ف.كاش</span>`;
    } else if (o.paymentMethod === 'instapay') {
      payBadge = `<span style="display:inline-block; padding:4px 12px; border-radius:16px; background:#dcfce7; color:#16a34a; font-size:0.85rem; font-weight:600;">إنستاباي</span>`;
    } else {
      payBadge = o.paymentMethod;
    }

    // WhatsApp Link Generation
    let waLinkFull = '';
    let waLinkEmpty = '';
    if (o.customer && o.customer.phone) {
      let cleanPhone = o.customer.phone.replace(/[^0-9]/g, '');
      if (cleanPhone.startsWith('01')) cleanPhone = '2' + cleanPhone;

      const waIconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align: middle;"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>`;
      
      waLinkEmpty = `<a href="https://wa.me/${cleanPhone}" target="_blank" onclick="event.stopPropagation()" style="display:inline-block; margin-right:8px; color:#10b981; text-decoration:none;" title="مراسلة العميل عبر واتساب">${waIconSvg}</a>`;

      let pmAr = o.paymentMethod === 'vodafone_cash' ? 'فودافون كاش' : (o.paymentMethod === 'instapay' ? 'إنستاباي' : o.paymentMethod);
      let paymentNumberStr = '';
      if (paymentMethodsCache && Array.isArray(paymentMethodsCache)) {
        const matchedPM = paymentMethodsCache.find(m => m.label === o.paymentMethod || m.label === pmAr);
        if (matchedPM && matchedPM.number) {
          paymentNumberStr = `\r\nرقم الدفع: ${matchedPM.number}`;
        }
      }
      let safeNotes = paymentNotesCache ? paymentNotesCache.replace(/\r?\n/g, '\r\n') : '';
      const pnStr = safeNotes ? `\r\n\r\n${safeNotes}` : '';
      const rawMsg = [
        `مرحباً ${o.customer.name || ''}`,
        '',
        `رقم الطلب: ${o.orderId}`,
        `إجمالي المبلغ: ${o.totalPrice} EGP`,
        `طريقة الدفع: ${pmAr}${paymentNumberStr}${pnStr}`,
        '',
        `شكراً لثقتك بنا ♡`
      ].join('\r\n');
      const msg = encodeURIComponent(rawMsg);
      waLinkFull = `<a href="https://wa.me/${cleanPhone}?text=${msg}" target="_blank" onclick="event.stopPropagation()" style="display:inline-block; margin-right:8px; color:#10b981; text-decoration:none;" title="مراسلة العميل عبر واتساب">${waIconSvg}</a>`;
    }

    // Status badge
    let statusBadge = '';
    if (o.status === 'cancelled') {
      statusBadge = `<span style="display:inline-block; padding:4px 12px; border-radius:16px; background:#fee2e2; color:#dc2626; font-size:0.85rem; font-weight:600;">ملغي</span>`;
    } else if (o.status === 'shipped') {
      statusBadge = `<span style="display:inline-block; padding:4px 12px; border-radius:16px; background:#e0e7ff; color:#4338ca; font-size:0.85rem; font-weight:600;">تم الشحن</span>`;
    } else if (o.paid) {
      statusBadge = `<span style="display:inline-block; padding:4px 12px; border-radius:16px; background:#dcfce7; color:#16a34a; font-size:0.85rem; font-weight:600;">مدفوع <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align: middle;"><polyline points="20 6 9 17 4 12"/></svg></span>${waLinkEmpty}`;
    } else if (o.paidAmount > 0) {
      let rem = Math.max(0, o.totalPrice - o.paidAmount);
      let cFee = 0;
      if (rem > 0) {
        cFee = Math.max(10, Math.ceil((rem * 0.01) / 5) * 5);
      }
      statusBadge = `<span style="display:inline-block; padding:4px 8px; border-radius:16px; background:#fef3c7; color:#92400e; font-size:0.8rem; font-weight:600; text-align:center;">مدفوع جزئياً<div style="font-size:0.7rem; font-weight:normal; opacity:0.9; margin-top:2px;">المتبقي: ${(rem + cFee)} ج</div></span>${waLinkEmpty}`;
    } else {
      statusBadge = `<span style="display:inline-block; padding:4px 12px; border-radius:16px; background:#f1f5f9; color:#475569; font-size:0.85rem; font-weight:600; vertical-align: middle;">غير مدفوع</span>${waLinkFull}`;
    }

    const displayId = o.orderId.replace('Order-', '').replace('Scoop-', '');

    return `
      <tr onclick="viewOrder('${o.orderId}')" style="cursor:pointer; transition:background 0.2s; ${isChecked ? 'background-color:#f0fdf4;' : ''}" onmouseover="if(!this.querySelector('.order-checkbox').checked) this.style.backgroundColor='#f8fafc'" onmouseout="if(!this.querySelector('.order-checkbox').checked) this.style.backgroundColor='transparent'">
        <td style="text-align: center;" onclick="event.stopPropagation();">
          <input type="checkbox" class="order-checkbox" value="${o.orderId}" ${isChecked} onchange="updateArchiveButton()" style="width:16px; height:16px; border-radius:4px; accent-color:#0f766e;">
        </td>
        <td style="color:#0ea5e9; font-weight:600; font-size:0.95rem;" dir="ltr">#${displayId}</td>
        <td>
          <div style="font-weight:600; color:#1e293b;">${o.customer?.name || 'بدون اسم'}</div>
          <div style="font-size:0.85rem; color:#64748b; margin-top:2px;">${o.customer?.government || ''}</div>
          <div style="font-size:0.85rem; margin-top:4px;">
            ${(o.transferScreenshot && typeof o.transferScreenshot === 'string' && o.transferScreenshot.trim() !== '')
              ? `<span style="display:inline-block; padding:3px 8px; border-radius:6px; background:#dcfce7; color:#16a34a; font-size:0.75rem; font-weight:700;">مراجعة التحويل</span>`
              : `<span style="display:inline-block; padding:3px 8px; border-radius:6px; background:#fee2e2; color:#dc2626; font-size:0.75rem; font-weight:700;">لا يوجد تحويل</span>`
            }
          </div>
        </td>
        <td style="font-size:0.95rem; color:#475569;">${o.items?.length || 0} منتج</td>
        <td>${statusBadge}</td>
        <td>${payBadge}</td>
        <td>
          <div style="font-weight:700; color:#0ea5e9; white-space:nowrap;">${formatPrice(o.totalPrice)}</div>
          ${o.discount ? (o.discount > 0 
            ? `<div style="font-size:0.8rem; color:#dc2626;">خصم: ${formatPrice(o.discount)}</div>` 
            : `<div style="font-size:0.8rem; color:#10b981;">زياده ${Math.abs(o.discount)} ج.م</div>`
          ) : ''}
        </td>
        <td style="color:#64748b; font-size:0.85rem;">${dateStr}</td>
      </tr>
    `;
  }).join('');
  
  // Sync selection state UI
  updateArchiveButton();
}

// ── Selection & Archiving ────────────────────────────────
window.toggleSelectAll = function () {
  const selectAll = document.getElementById('select-all-orders');
  const checkboxes = document.querySelectorAll('.order-checkbox');
  checkboxes.forEach(cb => cb.checked = selectAll.checked);
  updateArchiveButton();
};

window.updateArchiveButton = function () {
  const allCheckboxes = document.querySelectorAll('.order-checkbox');
  const checkedCheckboxes = document.querySelectorAll('.order-checkbox:checked');
  const filterBar = document.getElementById('filter-bar');
  const bulkBar = document.getElementById('bulk-actions-bar');
  const countBadge = document.getElementById('selected-count-badge');
  const selectAllCb = document.getElementById('select-all-orders');

  // Update "Select All" checkbox state
  if (selectAllCb && allCheckboxes.length > 0) {
    selectAllCb.checked = (allCheckboxes.length === checkedCheckboxes.length);
  }

  // Style rows
  allCheckboxes.forEach(cb => {
    const tr = cb.closest('tr');
    if (cb.checked) {
      tr.style.backgroundColor = '#f0fdf4';
    } else {
      tr.style.backgroundColor = 'transparent';
    }
  });

  if (checkedCheckboxes.length > 0) {
    if (bulkBar) {
      bulkBar.style.display = 'flex';
      if (countBadge) countBadge.textContent = checkedCheckboxes.length;
    }
  } else {
    if (bulkBar) bulkBar.style.display = 'none';
  }

  // Update UI for Bulk Menu based on current state and selection
  const archiveBtn = document.querySelector('.dropdown-item-btn[onclick="bulkAction(\\\'archive\\\')"]');
  if (archiveBtn) {
    if (showingArchived) {
      archiveBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 8v13H3V8" />
          <path d="M1 3h22v5H1z" />
          <path d="m10 12 2-2 2 2" />
          <path d="M12 10v7" />
        </svg>
        <span>إلغاء الأرشفة</span>
      `;
    } else {
      archiveBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
          <path d="m3.3 7 8.7 5 8.7-5" />
          <path d="M12 22V12" />
        </svg>
        <span>أرشفة</span>
      `;
    }
  }

  // Handle Cancel vs Activate
  const cancelBtn = document.querySelector('.dropdown-item-btn[onclick="bulkAction(\\\'cancel\\\')"]') || document.querySelector('.dropdown-item-btn[onclick="bulkAction(\\\'activate\\\')"]');
  if (cancelBtn) {
    const selectedOrderIds = Array.from(checkedCheckboxes).map(cb => cb.value);
    const selectedOrders = allOrdersData.filter(o => selectedOrderIds.includes(o.orderId));
    const allCancelled = selectedOrders.length > 0 && selectedOrders.every(o => o.status === 'cancelled');

    if (allCancelled) {
      cancelBtn.setAttribute('onclick', "bulkAction('activate')");
      cancelBtn.classList.remove('danger');
      cancelBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
          <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>
        <span style="color:#16a34a;">تنشيط</span>
      `;
    } else {
      cancelBtn.setAttribute('onclick', "bulkAction('cancel')");
      cancelBtn.classList.add('danger');
      cancelBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
        <span>إلغاء الطلب</span>
      `;
    }
  }

  // Handle Ship vs Unship
  const shipBtn = document.getElementById('bulk-ship-btn');
  if (shipBtn) {
    const selectedOrderIds = Array.from(checkedCheckboxes).map(cb => cb.value);
    const selectedOrders = allOrdersData.filter(o => selectedOrderIds.includes(o.orderId));
    
    // Only show if ALL selected are (paid or partially paid) and NOT cancelled
    const canShip = selectedOrders.length > 0 && selectedOrders.every(o => (o.paid || o.paidAmount > 0) && o.status !== 'cancelled');
    
    if (!canShip) {
      shipBtn.style.display = 'none';
    } else {
      shipBtn.style.display = 'flex';
      const allShipped = selectedOrders.every(o => o.status === 'shipped');
      if (allShipped) {
        shipBtn.setAttribute('onclick', "bulkAction('unship')");
        shipBtn.classList.add('danger');
        shipBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          <span>إلغاء الشحن</span>
        `;
      } else {
        shipBtn.setAttribute('onclick', "bulkAction('ship')");
        shipBtn.classList.remove('danger');
        shipBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="1" y="3" width="15" height="13" />
            <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
            <circle cx="5.5" cy="18.5" r="2.5" />
            <circle cx="18.5" cy="18.5" r="2.5" />
          </svg>
          <span>تم الشحن</span>
        `;
      }
    }
  }
};

window.toggleBulkMenu = function (event) {
  event.stopPropagation();
  const menu = document.getElementById('bulk-menu');
  if (menu.style.display === 'block') {
    menu.style.display = 'none';
  } else {
    menu.style.display = 'block';
  }
};

// Close bulk menu when clicking outside
document.addEventListener('click', function (e) {
  const menu = document.getElementById('bulk-menu');
  if (menu && menu.style.display === 'block' && !e.target.closest('#bulk-actions-bar')) {
    menu.style.display = 'none';
  }
});

window.bulkAction = async function (action) {
  const menu = document.getElementById('bulk-menu');
  if (menu) menu.style.display = 'none';

  const checkboxes = document.querySelectorAll('.order-checkbox:checked');
  const orderIds = Array.from(checkboxes).map(cb => cb.value);
  if (!orderIds.length) return;

  if (action === 'archive') {
    if (showingArchived) {
      await unarchiveSelected();
    } else {
      await archiveSelected();
    }
  } else if (action === 'cancel') {
    const confirmed = await window.showConfirmModal('إلغاء الطلبات', `هل أنت متأكد من إلغاء ${orderIds.length} طلبات؟`);
    if (!confirmed) return;
    try {
      await api.cancelOrdersBatch(orderIds);
      showToast('تم إلغاء الطلبات بنجاح');
      loadOrders();
    } catch (err) {
      showToast(err.message || 'فشل إلغاء الطلبات', 'error');
    }
  } else if (action === 'ship') {
    const confirmed = await window.showConfirmModal('شحن الطلبات', `هل أنت متأكد من تحديد ${orderIds.length} طلبات كتم الشحن؟`, 'success');
    if (!confirmed) return;
    try {
      await api.markOrdersShippedBatch(orderIds);
      showToast('تم تحديد الطلبات كـ "تم الشحن" بنجاح', 'success');
      loadOrders();
    } catch (err) {
      showToast(err.message || 'فشل تحديد الطلبات كتم الشحن', 'error');
    }
  } else if (action === 'unship') {
    const confirmed = await window.showConfirmModal('إلغاء الشحن', `هل أنت متأكد من إلغاء شحن ${orderIds.length} طلبات؟`, 'info');
    if (!confirmed) return;
    try {
      await api.unmarkOrdersShippedBatch(orderIds);
      showToast('تم إلغاء حالة "تم الشحن" بنجاح', 'success');
      loadOrders();
    } catch (err) {
      showToast(err.message || 'فشل إلغاء الشحن', 'error');
    }
  } else if (action === 'activate') {
    const confirmed = await window.showConfirmModal('تنشيط الطلبات', `هل أنت متأكد من تنشيط ${orderIds.length} طلبات؟`, 'success');
    if (!confirmed) return;
    try {
      await api.activateOrdersBatch(orderIds);
      showToast('تم تنشيط الطلبات بنجاح', 'success');
      loadOrders();
    } catch (err) {
      showToast(err.message || 'فشل تنشيط الطلبات', 'error');
    }
  } else if (action === 'delete') {
    const confirmed = await window.showConfirmModal('تأكيد الحذف', `هل أنت متأكد من حذف ${orderIds.length} طلبات نهائياً؟`);
    if (!confirmed) return;
    try {
      await api.deleteOrdersBatch(orderIds);
      showToast('تم حذف الطلبات بنجاح');
      loadOrders();
    } catch (err) {
      showToast(err.message || 'فشل حذف الطلبات', 'error');
    }
  } else if (action === 'add_tags' || action === 'remove_tags') {
    window.showToast('سيتم إضافة خاصية التصنيفات قريباً.', 'info'); // Placeholder
  }
};

window.unselectAll = function () {
  document.querySelectorAll('.order-checkbox').forEach(cb => cb.checked = false);
  const selectAllCb = document.getElementById('select-all-orders');
  if (selectAllCb) selectAllCb.checked = false;
  updateArchiveButton();
};

window.archiveSelected = async function () {
  const checkboxes = document.querySelectorAll('.order-checkbox:checked');
  const orderIds = Array.from(checkboxes).map(cb => cb.value);
  if (!orderIds.length) return;

  const confirmed = await window.showConfirmModal('تأكيد الأرشفة', `هل أنت متأكد من أرشفة ${orderIds.length} طلبات؟`);
  if (!confirmed) return;

  try {
    await api.archiveOrders(orderIds);
    showToast('تم أرشفة الطلبات بنجاح');
    loadOrders();
  } catch (err) {
    showToast(err.message || 'فشل أرشفة الطلبات', 'error');
  }
};

window.unarchiveSelected = async function () {
  const checkboxes = document.querySelectorAll('.order-checkbox:checked');
  const orderIds = Array.from(checkboxes).map(cb => cb.value);
  if (!orderIds.length) return;

  const confirmed = await window.showConfirmModal('تأكيد إلغاء الأرشفة', `هل أنت متأكد من إلغاء أرشفة ${orderIds.length} طلبات؟`);
  if (!confirmed) return;

  try {
    await api.unarchiveOrders(orderIds);
    showToast('تم إلغاء أرشفة الطلبات بنجاح');
    loadOrders();
  } catch (err) {
    showToast(err.message || 'فشل إلغاء أرشفة الطلبات', 'error');
  }
};

// Removed toggleArchivedView as it's replaced by setFilter('archived')

// ── View Order ───────────────────────────────────────────
window.viewOrder = function (orderId) {
  window.location.href = `order-details?id=${orderId}`;
};

// ── Delete Order ───────────────────────────────────────
window.deleteOrder = async function (orderId) {
  const confirmed = await window.showConfirmModal('تأكيد الحذف', 'هل أنت متأكد من حذف هذا الطلب؟');
  if (!confirmed) return;
  try {
    await api.deleteOrder(orderId);
    showToast('تم حذف الطلب');
    loadOrders();
  } catch (err) {
    showToast(err.message || 'فشل الحذف', 'error');
  }
};

// ── Print Bulk Invoices (Native High Quality) ───────────────────────────
window.printInvoices = async function () {
  const adminKey = localStorage.getItem('adminKey') || '';
  const btn = document.getElementById('print-invoices-btn');
  const originalText = btn ? btn.innerHTML : 'تحميل جميع الفواتير';
  
  if (btn) {
    btn.innerHTML = '<div class="spinner" style="width:16px;height:16px;border-color:#475569;border-top-color:transparent;margin:0"></div>';
    btn.disabled = true;
  }

  showToast('جاري تحميل جميع الفواتير من PDFBolt...', 'info');
  
  try {
    const response = await fetch(`${API_BASE}/orders/bulk/download-pdf`, {
      headers: {
        'x-admin-key': adminKey,
        'Authorization': `Bearer ${adminKey}`
      }
    });
    
    if (!response.ok) {
        const error = await response.text();
        throw new Error(error || 'Failed to generate PDF');
    }

    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    const d = new Date();
    a.download = `ShippmentsOf_${d.getDate()}-${d.getMonth() + 1}.pdf`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(downloadUrl);
    a.remove();
    
    showToast('تم بدء تحميل الفواتير بنجاح ✅');
  } catch (err) {
    console.error('PDF Download Error:', err);
    showToast('فشل تحميل الفواتير: ' + err.message, 'error');
  } finally {
    if (btn) {
      setTimeout(() => {
        btn.innerHTML = originalText;
        btn.disabled = false;
      }, 500);
    }
  }
};

window.shipOrders = async function () {
  const btn = document.getElementById('ship-orders-btn');
  const originalHtml = btn ? btn.innerHTML : 'شحن الطلبات';

  const checkedCheckboxes = document.querySelectorAll('.order-checkbox:checked');
  let ordersToShip = [];
  if (checkedCheckboxes.length > 0) {
    const selectedIds = Array.from(checkedCheckboxes).map(cb => cb.value);
    ordersToShip = allOrdersData.filter(o => selectedIds.includes(o.orderId));
  } else {
    ordersToShip = allOrdersData.filter(o => 
      o.status === 'ready' && 
      (o.paid === true || (o.paidAmount && o.paidAmount > 0)) && 
      !o.bostaDeliveryId
    );
  }

  if (ordersToShip.length === 0) {
    showToast('لا توجد طلبات جاهزة للشحن حالياً', 'info');
    return;
  }

  const confirmed = await window.showConfirmModal('تأكيد التحميل', `هل تريد تحميل ملف الشحنات لعدد ${ordersToShip.length} طلبات؟`, 'info');
  if (!confirmed) return;

  if (btn) {
    btn.innerHTML = '<div class="spinner" style="width:16px;height:16px;border-color:#fff;border-top-color:transparent;margin:0"></div>';
    btn.disabled = true;
  }

  // Yield main thread so the browser can paint the spinner before freezing
  await new Promise(r => setTimeout(r, 50));

  try {
    if (typeof ExcelJS === 'undefined') {
      throw new Error('مكتبة ExcelJS لم يتم تحميلها بشكل صحيح');
    }

    let buffer;
    try {
      const res = await fetch('Template.xlsx');
      if (res.ok) {
        buffer = await res.arrayBuffer();
      } else {
        const res2 = await fetch('order_template.xls');
        if (res2.ok) buffer = await res2.arrayBuffer();
      }
    } catch (e) {
      console.warn('Could not fetch template file:', e);
    }

    const workbook = new ExcelJS.Workbook();
    if (buffer) {
      await workbook.xlsx.load(buffer);
    }

    let sheet = workbook.getWorksheet(1) || workbook.worksheets[0];
    if (!sheet) {
      sheet = workbook.addWorksheet('Sheet1');
      sheet.addRow([
        'الرقم المرجعي',
        'اسم المستلم',
        'موبايل المستلم',
        'Receiver Second Mobile Number',
        'منطقة المستلم',
        'عنوان المستلم',
        'Product Note',
        'ملاحظة',
        'مجموع التحصيل'
      ]);
    }
    
    // Find column mapping from row 1
    const headers = sheet.getRow(1).values;
    const colMap = {};
    for (let i = 1; i < headers.length; i++) {
      if (headers[i]) colMap[headers[i].toString().trim()] = i;
    }

    const getCol = (name, fallbackIdx) => colMap[name] || fallbackIdx;
    const colRef = getCol('الرقم المرجعي', 1);
    const colName = getCol('اسم المستلم', 2);
    const colPhone = getCol('موبايل المستلم', 3);
    const colSecondPhone = getCol('Receiver Second Mobile Number', 4);
    const colGov = getCol('منطقة المستلم', 5);
    const colAddress = colMap['عنوان المستلم'] || colMap['عنوان المستلم '] || 6;
    const colProductNote = getCol('Product Note', 7);
    const colNote = getCol('ملاحظة', 8);
    const colCod = getCol('مجموع التحصيل', 9);

    function convertArabicDigitsToEnglish(str) {
      if (str === null || str === undefined) return '';
      return str.toString()
        .replace(/[٠-٩]/g, d => String.fromCharCode(d.charCodeAt(0) - 1632 + 48))
        .replace(/[۰-۹]/g, d => String.fromCharCode(d.charCodeAt(0) - 1776 + 48));
    }

    let rowIdx = 2;
    for (let i = 0; i < ordersToShip.length; i++) {
      const o = ordersToShip[i];
      const row = sheet.getRow(rowIdx);

      // Cod Without shipping Fee
      let cod = 0;
      if (!o.paid) {
        const remaining = Math.max(0, (o.totalPrice || 0) - (o.paidAmount || 0));
        const unpaidShipping = Math.max(0, (o.shippingFee || 0) - (o.paidAmount || 0));
        cod = Math.max(0, remaining - unpaidShipping);
      }

      const customerName = (o.customer && o.customer.name) ? o.customer.name.trim() : '';
      const phone = (o.customer && o.customer.phone) ? convertArabicDigitsToEnglish(o.customer.phone).trim() : '';
      const secondPhone = (o.customer && o.customer.secondPhone) ? convertArabicDigitsToEnglish(o.customer.secondPhone).trim() : '';
      const gov = (o.customer && o.customer.government) ? o.customer.government.trim() : '';
      const address = (o.customer && o.customer.address) ? o.customer.address.trim() : '';

      // Product Note: Products of order eg : ProductName (count) , .....
      const productNote = (o.items || [])
        .map(item => `${(item.name || '').trim()} (${item.quantity || 1})`)
        .join(' , ');

      const fixedNote = 'برجاء معاملة المنتج برفق قابل للكسر';

      row.getCell(colRef).value = (o.orderId || '').toString();
      row.getCell(colName).value = customerName;
      row.getCell(colPhone).value = phone;
      row.getCell(colSecondPhone).value = secondPhone;
      row.getCell(colGov).value = gov;
      row.getCell(colAddress).value = address;
      row.getCell(colProductNote).value = productNote;
      row.getCell(colNote).value = fixedNote;
      row.getCell(colCod).value = cod;
      
      rowIdx++;
      
      // Yield every 25 rows to keep the browser responsive
      if (i % 25 === 0) {
        await new Promise(r => setTimeout(r, 0));
      }
    }

    const finalBuffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([finalBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    
    const d = new Date();
    const filename = `shipments_${d.getDate()}-${d.getMonth() + 1}.xlsx`;
    saveAs(blob, filename);

    showToast('تم تحميل الملف بنجاح', 'success');
  } catch (err) {
    console.error(`Failed to generate excel:`, err);
    showToast(err.message || 'فشل تحميل الملف', 'error');
  }

  if (btn) {
    btn.innerHTML = originalHtml;
    btn.disabled = false;
  }
};
