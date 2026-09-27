/** Admin — Customer Details JS */

let currentCustomer = null;
let currentOrders = [];
let shippingMap = {};

document.addEventListener('DOMContentLoaded', async () => {
  if (!requireAdmin()) return;

  const urlParams = new URLSearchParams(window.location.search);
  const phone = urlParams.get('phone');
  if (!phone) {
    window.location.href = 'customers';
    return;
  }

  try {
    const [data, shipping, settings] = await Promise.all([
      api.getCustomer(phone),
      api.getShippingList().catch(() => []),
      api.getSetting('loli_global_settings').catch(() => ({}))
    ]);
    currentCustomer = data.customer;
    currentOrders = data.orders;
    window._fullShippingData = shipping;
    window._globalSettings = settings || {};

    renderCustomer();

    // ── Search Listeners ──
    const searchInput = document.getElementById('modal-c-gov-search');
    const dropdown = document.getElementById('modal-c-gov-dropdown');
    const hiddenInput = document.getElementById('modal-c-gov');

    if (searchInput && dropdown) {
      searchInput.addEventListener('focus', () => renderGovDropdown());
      searchInput.addEventListener('input', () => renderGovDropdown());
      
      document.addEventListener('click', (e) => {
        if (!document.getElementById('modal-c-gov-search-container').contains(e.target)) {
          dropdown.style.display = 'none';
        }
      });

      function renderGovDropdown() {
        const query = searchInput.value.toLowerCase().trim();
        const filtered = window._fullShippingData.filter(s => 
          s.city.toLowerCase().includes(query) || (s.cityOtherName && s.cityOtherName.toLowerCase().includes(query))
        );

        if (filtered.length === 0) {
          dropdown.innerHTML = '<div style="padding: 10px; color: #94a3b8; text-align: center;">لا توجد نتائج</div>';
        } else {
          dropdown.innerHTML = filtered.map(s => `
            <div class="dropdown-item" style="padding: 12px 16px; cursor: pointer; border-bottom: 1px solid #f1f5f9; text-align:right;" 
                 onclick="selectGov('${s._id}', '${s.cityOtherName || s.city}')">
              ${s.cityOtherName || s.city}
            </div>
          `).join('');
        }
        dropdown.style.display = 'block';
      }

      window.selectGov = (id, name) => {
        hiddenInput.value = id;
        searchInput.value = name;
        dropdown.style.display = 'none';
        handleModalCityChange();
      };
    }
  } catch (err) {
    showToast('فشل تحميل بيانات العميل', 'error');
  } finally {
    document.body.classList.remove('is-loading');
  }
});

function renderCustomer() {
  const c = currentCustomer;
  document.getElementById('page-customer-name').textContent = c.name;
  document.getElementById('view-c-name').textContent = c.name;
  document.getElementById('view-c-phone').textContent = c.phone;
  document.getElementById('view-c-phone2').textContent = c.secondPhone || 'لا يوجد هاتف آخر';
  document.getElementById('view-c-address').textContent = c.address || 'لا يوجد عنوان';
  document.getElementById('view-c-gov').textContent = c.government || 'لا يوجد محافظة';

  const initials = c.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  const avatar = document.getElementById('view-c-avatar');
  avatar.textContent = initials;

  const registeredDate = new Date(c.firstOrderDate).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
  document.getElementById('view-c-registered').textContent = `عميل منذ ${registeredDate}`;

  // Stats
  document.getElementById('stat-total-spent').textContent = formatPrice(c.totalSpent);
  document.getElementById('stat-order-count').textContent = c.orderCount;
  document.getElementById('stat-last-order').textContent = c.lastOrderDate ? new Date(c.lastOrderDate).toLocaleDateString('ar-EG') : '—';

  renderOrders();
}

function renderOrders() {
  const tbody = document.getElementById('orders-tbody');
  tbody.innerHTML = currentOrders.map(o => `
    <tr onclick="location.href='order-details?id=${o.orderId}'" style="cursor:pointer">
      <td style="padding:16px; border-bottom:1px solid #f1f5f9; font-weight:600;">#${o.orderId}</td>
      <td style="padding:16px; border-bottom:1px solid #f1f5f9; color:#64748b;">${new Date(o.createdAt).toLocaleDateString('ar-EG')}</td>
      <td style="padding:16px; border-bottom:1px solid #f1f5f9; font-weight:600;">${formatPrice(o.totalPrice)}</td>
      <td class="hide-mobile" style="padding:16px; border-bottom:1px solid #f1f5f9;">
        <span class="status-badge ${o.status === 'cancelled' ? 'badge-danger' : 'status-active'}">
          ${o.status === 'cancelled' ? 'ملغي' : 'جاهز'}
        </span>
      </td>
      <td class="hide-mobile" style="padding:16px; border-bottom:1px solid #f1f5f9; text-align:left;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
      </td>
    </tr>
  `).join('');
}

window.openEditModal = async function () {
  const c = currentCustomer;
  document.getElementById('modal-c-name').value = c.name;
  document.getElementById('modal-c-phone').value = c.phone;
  document.getElementById('modal-c-phone2').value = c.secondPhone || '';
  
  const govName = c.government || '';
  const govData = (window._fullShippingData || []).find(s => s.city === govName || s.cityOtherName === govName);
  
  const searchGov = document.getElementById('modal-c-gov-search');
  const hiddenGov = document.getElementById('modal-c-gov');
  if (searchGov && hiddenGov) {
    searchGov.value = govData ? (govData.cityOtherName || govData.city) : '';
    hiddenGov.value = govData ? govData._id : '';
  }
  
  document.getElementById('modal-c-address').value = c.address || '';
  document.getElementById('edit-modal').classList.add('open');
};

window.handleModalCityChange = async function () {
  // City change handler
};

function closeEditModal() {
  document.getElementById('edit-modal').classList.remove('open');
}

async function applyChanges(btn) {
  const name = document.getElementById('modal-c-name').value.trim();
  const phone = document.getElementById('modal-c-phone').value.trim();
  const phone2 = document.getElementById('modal-c-phone2').value.trim();
  const cityId = document.getElementById('modal-c-gov').value;
  const address = document.getElementById('modal-c-address').value.trim();

  const govData = (window._fullShippingData || []).find(s => s._id === cityId);
  const cityName = govData ? (govData.cityOtherName || govData.city) : '';

  if (!name || !phone || !cityName) {
    showToast('الاسم ورقم الهاتف والمحافظة مطلوبة', 'error');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2.5px;margin:0;"></span> جاري الحفظ...';
  }

  try {
    // Call the API to save the updated customer across all past/current orders in the database
    await api.updateCustomer(currentCustomer.phone, {
      name,
      phone,
      secondPhone: phone2,
      government: cityName,
      address
    });

    // Update local state
    currentCustomer.name = name;
    currentCustomer.phone = phone;
    currentCustomer.secondPhone = phone2;
    currentCustomer.government = cityName;
    currentCustomer.address = address;

    renderCustomer();
    closeEditModal();
    showToast('تم تحديث بيانات العميل بنجاح');
  } catch (err) {
    console.error('Failed to update customer:', err);
    showToast('فشل حفظ التعديلات في قاعدة البيانات: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'تطبيق';
    }
  }
}
