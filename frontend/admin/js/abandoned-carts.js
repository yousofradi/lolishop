let allCarts = [];
let currentPage = 1;
let currentLimit = 25;
let totalPages = 1;
let totalCount = 0;

document.addEventListener('DOMContentLoaded', async () => {
  // Check auth
  if (typeof requireAdmin === 'function') {
    if (!requireAdmin()) return;
  } else {
    const ok = await api.checkAdmin();
    if (!ok) {
      window.location.href = 'login';
      return;
    }
  }

  // Remove is-loading from body and show layout
  document.body.classList.remove('is-loading');
  const layout = document.getElementById('main-content-layout');
  const spinner = document.getElementById('page-content-spinner');
  if (layout) layout.style.display = 'block';
  if (spinner) spinner.style.display = 'none';

  await loadAbandonedCarts(1);
});

async function loadAbandonedCarts(page = 1) {
  currentPage = page;
  const tbody = document.getElementById('carts-tbody');
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="padding:32px;"><div class="spinner"></div></td></tr>`;
  }

  try {
    const res = await api.getAbandonedCarts(currentPage, currentLimit);
    if (res && res.carts) {
      allCarts = res.carts;
      totalPages = res.totalPages || 1;
      totalCount = res.totalCount !== undefined ? res.totalCount : allCarts.length;
    } else {
      allCarts = Array.isArray(res) ? res : [];
      totalPages = Math.ceil(allCarts.length / currentLimit) || 1;
      totalCount = allCarts.length;
    }

    renderCarts(allCarts);
    updatePaginationUI();
  } catch (err) {
    console.error('Failed to load abandoned carts:', err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="padding:24px; color:#ef4444; font-weight:bold;">فشل في تحميل السلات المتروكة</td></tr>`;
    }
  }
}

function updatePaginationUI() {
  const paginationInfo = document.getElementById('pagination-info');
  const countAll = document.getElementById('count-all');
  const curPageDisp = document.getElementById('current-page-display');
  const totalPagesDisp = document.getElementById('total-pages-display');
  const prevBtn = document.getElementById('prev-page');
  const nextBtn = document.getElementById('next-page');
  const dropdown = document.getElementById('page-dropdown');

  if (paginationInfo) paginationInfo.textContent = totalCount;
  if (countAll) countAll.textContent = totalCount;
  if (curPageDisp) curPageDisp.textContent = currentPage;
  if (totalPagesDisp) totalPagesDisp.textContent = totalPages;

  if (prevBtn) {
    const isFirstPage = currentPage <= 1;
    prevBtn.disabled = isFirstPage;
    prevBtn.style.opacity = isFirstPage ? '0.4' : '1';
    prevBtn.style.cursor = isFirstPage ? 'not-allowed' : 'pointer';
    prevBtn.style.pointerEvents = isFirstPage ? 'none' : 'auto';
  }

  if (nextBtn) {
    const isLastPage = currentPage >= totalPages;
    nextBtn.disabled = isLastPage;
    nextBtn.style.opacity = isLastPage ? '0.4' : '1';
    nextBtn.style.cursor = isLastPage ? 'not-allowed' : 'pointer';
    nextBtn.style.pointerEvents = isLastPage ? 'none' : 'auto';
  }

  if (dropdown) {
    dropdown.innerHTML = '';
    for (let i = 1; i <= totalPages; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = i;
      if (i === currentPage) opt.selected = true;
      dropdown.appendChild(opt);
    }
  }
}

function changePage(delta) {
  const targetPage = currentPage + delta;
  goToPage(targetPage);
}

function goToPage(page) {
  const targetPage = parseInt(page, 10);
  if (isNaN(targetPage) || targetPage < 1 || targetPage > totalPages || targetPage === currentPage) {
    return;
  }
  loadAbandonedCarts(targetPage);
  const tableWrap = document.querySelector('.carts-table-wrap');
  if (tableWrap) {
    tableWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function renderCarts(list) {
  const tbody = document.getElementById('carts-tbody');
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="padding:48px 24px; color:#64748b;">لا توجد سلات متروكة حالياً</td></tr>`;
    return;
  }

  let storeUrl = localStorage.getItem('admin_store_url') || window.location.origin;
  if (storeUrl.endsWith('/')) {
    storeUrl = storeUrl.slice(0, -1);
  }

  tbody.innerHTML = list.map(cart => {
    // Total value
    const total = cart.items.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);
    
    // Items listing
    const itemsListHtml = cart.items.map(item => {
      const optionsStr = item.selectedOptions && item.selectedOptions.length > 0
        ? ` (${item.selectedOptions.map(o => o.label).join(' / ')})`
        : '';
      return `<div style="margin-bottom: 4px;">
        <span class="badge-qty">${item.quantity}x</span> 
        <strong style="color:#1e293b;">${item.name}</strong>${optionsStr}
      </div>`;
    }).join('');

    // Customer display
    const custName = cart.customer?.name || '<span style="color:#a1a1aa; font-style:italic;">بدون اسم</span>';
    const custPhone = cart.customer?.phone || '<span style="color:#a1a1aa; font-style:italic;">بدون هاتف</span>';
    
    // WhatsApp direct link if phone exists
    let waLinkHtml = custPhone;
    if (cart.customer?.phone) {
      let cleanPhone = cart.customer.phone.replace(/[^0-9]/g, '');
      if (cleanPhone.startsWith('01')) cleanPhone = '2' + cleanPhone;
      waLinkHtml = `<a href="https://wa.me/${cleanPhone}" target="_blank" style="color:#10b981; font-weight:700; text-decoration:none; display:inline-flex; align-items:center; gap:4px;">
        <span>${cart.customer.phone}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
      </a>`;
    }

    // Secondary phone if present
    const phone2Str = cart.customer?.secondPhone ? `<div style="font-size:0.8rem; color:#64748b; margin-top:2px;">هاتف إضافي: ${cart.customer.secondPhone}</div>` : '';

    // Governorate
    const gov = cart.customer?.government || '';
    const address = cart.customer?.address || '';
    let addressDisplay = `<div style="font-weight:600; color:#334155;">${gov}</div>`;
    if (address) {
      addressDisplay += `<div class="hide-mobile" style="font-size:0.8rem; color:#64748b; margin-top:4px; max-width:250px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${address}">${address}</div>`;
    }

    // Time ago or formatted
    const date = new Date(cart.updatedAt);
    const dateFormatted = date.toLocaleDateString('ar-EG', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const recoverUrl = `${storeUrl}/checkout?recover=${cart.checkoutToken}`;

    return `
      <tr id="cart-row-${cart._id}" onclick="handleRowClick(event, '${cart._id}')" style="position: relative;">
        <!-- Mobile Delete Button (renders on the far left) -->
        <td class="mobile-delete-btn-cell" style="display: none; padding: 0; width: auto; border: none; align-items: center; justify-content: center;">
          <button class="mobile-delete-btn" onclick="deleteCart('${cart._id}', event)">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </td>
        
        <td>
          <div style="font-weight:700; color:#0f172a;">${custName}</div>
          <div style="margin-top:4px;">${waLinkHtml}</div>
          ${phone2Str}
        </td>
        <td>${addressDisplay}</td>
        <td>
          <div style="max-height:80px; overflow-y:auto; padding-left:8px;">
            ${itemsListHtml}
          </div>
        </td>
        <td style="font-weight:800; color:#0f766e;">${formatPrice(total)}</td>
        <td style="font-size:0.8rem; color:#64748b;">${dateFormatted}</td>
        <td style="text-align: center;">
          <div style="display:flex; gap:8px; justify-content:center;">
            <button class="btn-action btn-confirm" onclick="confirmCart('${cart._id}', event)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
              <span>تأكيد السلة</span>
            </button>
            <button class="btn-action btn-delete" onclick="deleteCart('${cart._id}', event)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
              <span>حذف</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function filterCarts() {
  const query = document.getElementById('cart-search').value.toLowerCase().trim();
  if (!query) {
    renderCarts(allCarts);
    return;
  }

  const filtered = allCarts.filter(cart => {
    const name = (cart.customer?.name || '').toLowerCase();
    const phone = (cart.customer?.phone || '').toLowerCase();
    const gov = (cart.customer?.government || '').toLowerCase();
    return name.includes(query) || phone.includes(query) || gov.includes(query);
  });

  renderCarts(filtered);
}

function confirmCart(cartId, event) {
  if (event) event.stopPropagation();
  window.location.href = `order-form.html?recoverCartId=${cartId}`;
}

async function deleteCart(id, event) {
  if (event) event.stopPropagation();
  const ok = typeof showConfirmModal === 'function'
    ? await showConfirmModal('حذف السلة المتروكة', 'هل أنت متأكد من رغبتك في حذف هذه السلة المتروكة؟ لا يمكن استعادتها بعد الحذف.')
    : confirm('هل أنت متأكد من رغبتك في حذف هذه السلة المتروكة؟');
  if (!ok) return;

  try {
    await api.deleteAbandonedCart(id);
    if (typeof showToast === 'function') {
      showToast('تم حذف السلة المتروكة بنجاح');
    }
    
    // Refresh page
    if (allCarts.length === 1 && currentPage > 1) {
      await loadAbandonedCarts(currentPage - 1);
    } else {
      await loadAbandonedCarts(currentPage);
    }
  } catch (err) {
    console.error('Failed to delete cart:', err);
    if (typeof showToast === 'function') {
      showToast(err.message || 'فشل في حذف السلة المتروكة', 'error');
    }
  }
}

function handleRowClick(event, cartId) {
  if (event.target.closest('button') || event.target.closest('a') || event.target.closest('input')) {
    return;
  }
  window.location.href = `order-form.html?recoverCartId=${cartId}`;
}

async function deleteAllCarts() {
  const ok = typeof showConfirmModal === 'function'
    ? await showConfirmModal('حذف جميع السلات المتروكة', 'هل أنت متأكد من رغبتك في حذف جميع السلات المتروكة؟ لا يمكن التراجع عن هذا الإجراء.')
    : confirm('هل أنت متأكد من رغبتك في حذف جميع السلات المتروكة؟');
  if (!ok) return;

  try {
    await api.deleteAllAbandonedCarts();
    if (typeof showToast === 'function') {
      showToast('تم حذف جميع السلات المتروكة بنجاح');
    }
    
    await loadAbandonedCarts(1);
  } catch (err) {
    console.error('Failed to delete all carts:', err);
    if (typeof showToast === 'function') {
      showToast(err.message || 'فشل في حذف السلات المتروكة', 'error');
    }
  }
}
