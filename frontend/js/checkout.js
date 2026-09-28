// Smart Search helper for Arabic
function smartMatch(text, query) {
  if (!query) return true; // Show all if no query
  if (!text) return false;
  const normalize = (s) => s.toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/^ال/, '')
    .replace(/\sال/g, ' ')
    .trim();
  
  const nText = normalize(text);
  const nQuery = normalize(query);
  return nText.includes(nQuery) || nQuery.includes(nText);
}

function convertArabicDigitsToEnglish(str) {
  if (str === null || str === undefined) return '';
  return str.toString()
    .replace(/[٠-٩]/g, d => String.fromCharCode(d.charCodeAt(0) - 1632 + 48))
    .replace(/[۰-۹]/g, d => String.fromCharCode(d.charCodeAt(0) - 1776 + 48));
}

/** Checkout page logic */
document.addEventListener('DOMContentLoaded', async () => {
  // Check if we need to recover a checkout from an abandoned cart
  const urlParams = new URLSearchParams(window.location.search);
  const recoverToken = urlParams.get('recover');
  
  if (recoverToken) {
    try {
      const cartData = await api.getPublicAbandonedCart(recoverToken);
      if (cartData) {
        // Restore items to cart
        Cart._save(cartData.items);
        // Save the checkoutToken to localStorage
        localStorage.setItem('loli_checkout_token', recoverToken);
        if (cartData.customer) {
          delete cartData.customer.carrier;
        }
        // Save customer data draft to localStorage
        localStorage.setItem('loli_checkout_draft', JSON.stringify(cartData.customer || {}));
      }
    } catch (err) {
      console.error('Failed to recover abandoned cart:', err);
    }
    // Clean query parameters so the URL looks clean
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  const items = Cart.getItems();
  if (!items.length) { window.location.href = 'cart'; return; }

  // Fetch shipping global settings
  try {
    const settings = await api.getSetting('loli_global_settings');
    window._enableBosta = false;
    window._enableEgyptPost = true;

    // Load active shipping options
    const options = await api.getSetting('shipping_options');
    window._shippingOptions = options || [];
  } catch (err) {
    console.warn('Failed to load global settings, using defaults', err);
    window._enableBosta = false;
    window._enableEgyptPost = true;
    window._shippingOptions = [];
  }

  // Evaluate promotions for checkout
  try {
    const res = await fetch(`${typeof API_BASE !== 'undefined' ? API_BASE : ''}/promotions/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cartItems: items })
    });
    if (res.ok) {
      window._cartPromotionData = await res.json();
    }
  } catch (err) {
    console.error('Failed to evaluate checkout promotions', err);
  }

  renderOrderSummary(items);
  await loadCities();
  await loadPaymentMethods();
  setupForm();

  // Restore draft details after form setup and cities are fully loaded
  await restoreCheckoutDraft();
});

async function loadPaymentMethods() {
  const container = document.getElementById('payment-methods-checkout');
  if (!container) return;
  try {
    const settings = await api.getSetting('loli_global_settings');
    const methods = settings ? (settings.paymentMethods || []) : [];
    
    if (methods.length === 0) {
      container.innerHTML = '<p class="text-muted text-center" style="padding:12px; background:#f8fafc; border-radius:8px; width:100%;">الدفع عند الاستلام</p>';
      return;
    }

    // One column list
    container.style.display = 'grid';
    container.style.gridTemplateColumns = '1fr';
    container.style.gap = '8px';

    const paymentNotes = settings ? (settings.paymentNotes || '') : '';

    container.innerHTML = methods.map((m, idx) => `
      <div class="radio-option">
        <input type="radio" name="payment" id="pay-${m.id}" value="${m.label}" ${idx === 0 ? 'checked' : ''}>
        <label for="pay-${m.id}" style="display:flex; flex-direction:column; padding: 12px 16px; border-radius:12px; border-width:1.5px; width:100%; box-sizing:border-box;">
          <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
            <div style="display:flex; align-items:center; gap:12px;">
              <div style="width:36px; height:36px; display:flex; align-items:center; justify-content:center; overflow:hidden; flex-shrink:0; background:#f8fafc; border-radius:8px;">
                 ${m.logo ? `<img src="${m.logo}" style="max-width:100%; max-height:100%; object-fit:contain;">` : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>'}
              </div>
              <span style="font-weight:700; font-size:0.95rem; color:var(--text-main);">${m.label}</span>
            </div>
            
            <div style="display:flex; align-items:center; gap:8px;">
              <button type="button" class="btn-copy-payment" onclick="event.preventDefault(); copyToClipboard('${m.number}', this)" style="background:var(--primary, #916C4F); color:#fff; border:none; border-radius:6px; padding:4px 10px; font-size:0.75rem; font-weight:bold; cursor:pointer; display:flex; align-items:center; gap:4px; transition:all 0.2s;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  <span>نسخ</span>
              </button>
              <span dir="ltr" style="font-size: 0.85rem; font-weight: 800; color: #111827;">${m.number}</span>
            </div>
          </div>

          ${(m.accountHolder || m.recipientName) ? `
            <div style="width:100%; margin-top:10px; padding:6px 12px; background:#f8fafc; border:1px dashed #e2e8f0; border-radius:8px; display:flex; align-items:center; gap:6px; font-size:0.85rem; box-sizing:border-box;">
              <span style="color:#64748b; font-weight:600;">الرقم ب اسم :</span>
              <strong style="color:var(--primary, #916C4F); font-weight:800;">${m.accountHolder || m.recipientName}</strong>
            </div>
          ` : ''}
        </label>
      </div>
    `).join('');

    // Add global copy function
    window.copyToClipboard = (text, btn) => {
        navigator.clipboard.writeText(text).then(() => {
            const originalHTML = btn.innerHTML;
            btn.innerHTML = 'تم النسخ';
            btn.style.background = '#10b981';
            setTimeout(() => {
                btn.innerHTML = originalHTML;
                btn.style.background = 'var(--primary, #916C4F)';
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy: ', err);
        });
    };

    // Show global notes
    const noteBox = document.getElementById('payment-instructions');
    if (paymentNotes) {
        noteBox.textContent = paymentNotes;
        noteBox.style.display = 'block';
    } else {
        noteBox.style.display = 'none';
    }
  } catch (err) {
    console.error('Failed to load payment methods', err);
    container.innerHTML = '<p class="text-muted">خطأ في تحميل طرق الدفع</p>';
  }
}

function renderOrderSummary() {
  updatePriceSummary();
}

window.toggleSummary = function() {
  const summary = document.getElementById('collapsible-summary');
  if (summary) summary.classList.toggle('open');
};

async function loadCities() {
  try {
    const list = await api.getPublicShipping();
    window._fullShippingData = list;
    
    const searchInput = document.getElementById('government-search');
    const dropdown = document.getElementById('gov-dropdown');
    const hiddenInput = document.getElementById('government');

    if (!searchInput || !dropdown) return;

    searchInput.addEventListener('focus', () => renderGovDropdown());
    searchInput.addEventListener('input', () => {
      hiddenInput.value = '';
      renderGovDropdown();
    });
    
    document.addEventListener('click', (e) => {
      if (!document.getElementById('gov-search-container').contains(e.target)) {
        dropdown.style.display = 'none';
      }
    });

    function renderGovDropdown() {
      const query = searchInput.value.trim();
      const filtered = list.filter(s => 
        smartMatch(s.city, query) || (s.cityOtherName && smartMatch(s.cityOtherName, query))
      );

      if (filtered.length === 0) {
        dropdown.innerHTML = '<div style="padding: 10px; color: #94a3b8; text-align: center;">لا توجد نتائج</div>';
      } else {
        dropdown.innerHTML = filtered.map(s => `
          <div class="dropdown-item" style="padding: 12px 16px; cursor: pointer; border-bottom: 1px solid #f1f5f9;" 
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
      if (window.setErrorOnCheckout) window.setErrorOnCheckout(searchInput, null);
      handleGovChange();
    };

  } catch (err) {
    showToast('فشل في تحميل بيانات الشحن', 'error');
  }
}

async function handleGovChange() {
  updatePriceSummary();
}

function updateShippingMethodNotice(isEgyptPost) {
  // Removed notice alert per user request
}

function updatePriceSummary() {
  const items = Cart.getItems();
  const subtotal = Cart.getTotal();
  const isCityEqual = (c1, c2) => {
    if (!c1 || !c2) return false;
    const norm = (s) => String(s).toLowerCase()
      .replace(/[أإآا]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/^ال/, '')
      .replace(/\sال/g, ' ')
      .replace(/\s+/g, '')
      .trim();
    return norm(c1) === norm(c2);
  };

  const govInputVal = document.getElementById('government') ? document.getElementById('government').value.trim() : '';
  const searchInputVal = document.getElementById('government-search') ? document.getElementById('government-search').value.trim() : '';

  const govData = (window._fullShippingData || []).find(s => 
    s._id === govInputVal || 
    isCityEqual(s.city, govInputVal) || 
    isCityEqual(s.cityOtherName, govInputVal) ||
    isCityEqual(s.city, searchInputVal) ||
    isCityEqual(s.cityOtherName, searchInputVal)
  );
  const cityId = govInputVal;
  const cityName = govData ? (govData.cityOtherName || govData.city) : (searchInputVal || govInputVal);

  let shippingFee = 0;
  let activeShippingOption = null;
  if (Array.isArray(window._shippingOptions) && window._shippingOptions.length > 0) {
    activeShippingOption = window._shippingOptions.find(o => o.active !== false) || window._shippingOptions[0];
  }
  window._selectedCarrier = (activeShippingOption && activeShippingOption.name) ? activeShippingOption.name : '';

  if (cityName) {
    const cityObj = activeShippingOption ? (activeShippingOption.cities || []).find(c => 
      isCityEqual(c.city, cityName) || 
      (govData && (isCityEqual(c.city, govData.city) || isCityEqual(c.city, govData.cityOtherName)))
    ) : null;

    if (cityObj && cityObj.fee !== undefined && !isNaN(Number(cityObj.fee))) {
      shippingFee = Number(cityObj.fee);
    } else if (govData && govData.fee !== undefined && !isNaN(Number(govData.fee))) {
      shippingFee = Number(govData.fee);
    } else if (activeShippingOption && activeShippingOption.cost !== undefined && !isNaN(Number(activeShippingOption.cost))) {
      shippingFee = Number(activeShippingOption.cost);
    }
  } else {
    shippingFee = 0;
  }

  let totalDiscount = 0;
  if (window._cartPromotionData) {
    totalDiscount = window._cartPromotionData.totalDiscount || 0;
    if (window._cartPromotionData.freeShipping) {
      shippingFee = 0;
    }
  }

  const total = Math.max(0, subtotal - totalDiscount) + shippingFee;
  window._currentShippingFee = shippingFee;

  if (window.syncAbandonedCart) window.syncAbandonedCart();

  // Update Header Price
  const headerTotal = document.getElementById('header-total-price');
  if (headerTotal) headerTotal.textContent = formatPrice(total);

  // Update Final Total Above Button
  const btnTotal = document.getElementById('final-total-above-btn');
  if (btnTotal) btnTotal.textContent = formatPrice(total);

  // Update Summary Rows
  const subEl = document.getElementById('summary-subtotal');
  const shipEl = document.getElementById('summary-shipping');
  const totalEl = document.getElementById('summary-total-final');
  const summaryFooter = document.querySelector('.summary-footer');

  if (subEl) subEl.textContent = formatPrice(subtotal);
  
  // Handle Discount Row
  let discountRow = document.getElementById('summary-discount-row');
  if (totalDiscount > 0 && summaryFooter) {
    if (!discountRow) {
      discountRow = document.createElement('div');
      discountRow.id = 'summary-discount-row';
      discountRow.className = 'summary-price-row';
      discountRow.innerHTML = `<span>الخصم</span><span id="summary-discount-value" style="color:#ef4444; font-weight:bold;">0 ج.م</span>`;
      // Insert before shipping row
      summaryFooter.insertBefore(discountRow, shipEl ? shipEl.closest('.summary-price-row') : totalEl.closest('.summary-price-row'));
    }
    document.getElementById('summary-discount-value').textContent = `-${formatPrice(totalDiscount)}`;
  } else if (discountRow) {
    discountRow.remove();
  }

  const shipLabelEl = document.getElementById('summary-shipping-label');
  if (shipEl) {
    if (cityName || cityId) {
      shipEl.textContent = formatPrice(shippingFee);
      if (shipLabelEl) {
        const carrierName = (activeShippingOption && activeShippingOption.name) ? activeShippingOption.name : (window._selectedCarrier || '');
        if (carrierName && carrierName !== 'default' && carrierName !== 'egyptpost') {
          shipLabelEl.innerHTML = `الشحن <span style="color:#b84a20; font-size:0.85rem; font-weight:bold;">(${carrierName})</span>`;
        } else {
          shipLabelEl.textContent = 'الشحن';
        }
      }
    } else {
      shipEl.textContent = '—';
      if (shipLabelEl) {
        shipLabelEl.textContent = 'الشحن';
      }
    }
  }
  if (totalEl) totalEl.textContent = formatPrice(total);

  // Render Items in Summary
  const listEl = document.getElementById('summary-items-list');
  if (listEl) {
    listEl.innerHTML = items.map(item => `
      <div class="summary-item">
        <div class="summary-item-img-wrapper">
          ${item.imageUrl ? `<img src="${api.optimizeImageUrl(item.imageUrl, 150)}" class="summary-item-img">` : `
            <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#f8fafc;color:#94a3b8">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            </div>
          `}
          <div class="summary-item-qty">${item.quantity}</div>
        </div>
        <div class="summary-item-info">
          <div class="summary-item-name">${item.name}</div>
          <div class="summary-item-desc">${item.selectedOptions.map(o => o.label).join(' / ')}</div>
        </div>
        <div class="summary-item-price">${formatPrice(item.unitPrice * item.quantity)}</div>
      </div>
    `).join('');
  }
}

function setupForm() {
  const form = document.getElementById('checkout-form');
  const nameInput = document.getElementById('cust-name');
  const phoneInput = document.getElementById('cust-phone');
  const phone2Input = document.getElementById('cust-phone2');
  const addressCityInput = document.getElementById('cust-address-city');
  const addressVillageInput = document.getElementById('cust-address-village');
  const addressDetailInput = document.getElementById('cust-address-detail');
  const govSearchInput = document.getElementById('government-search');
  const govHiddenInput = document.getElementById('government');

  function getCombinedAddress() {
    const city = addressCityInput ? addressCityInput.value.trim() : '';
    const village = addressVillageInput ? addressVillageInput.value.trim() : '';
    const detail = addressDetailInput ? addressDetailInput.value.trim() : '';
    return [city, village, detail].filter(Boolean).join(' - ');
  }

  // Helper to show/hide errors
  function setError(input, msg) {
    const group = input ? input.closest('.form-group') : null;
    if (!group) return;

    let errEl = group.querySelector('.error-message');
    if (!errEl) {
      errEl = document.createElement('div');
      errEl.className = 'error-message';
      group.appendChild(errEl);
    }
    
    const wrapper = input.closest('.phone-input-wrapper');
    
    if (msg) {
      input.classList.add('invalid');
      if (wrapper) wrapper.classList.add('invalid');
      errEl.textContent = msg;
      errEl.style.display = 'block';
    } else {
      input.classList.remove('invalid');
      if (wrapper) wrapper.classList.remove('invalid');
      errEl.style.display = 'none';
    }
  }
  window.setErrorOnCheckout = setError;

  function validateName() {
    const val = nameInput.value.trim();
    if (!val) { setError(nameInput, 'أدخل اسمك كاملاً'); return false; }
    if (!/^[\u0600-\u06FF\s]+$/.test(val)) { setError(nameInput, 'يرجى إدخال الاسم باللغة العربية فقط'); return false; }
    if (val.split(/\s+/).filter(Boolean).length < 2) { setError(nameInput, 'أدخل اسمك كاملاً'); return false; }
    setError(nameInput, null);
    return true;
  }

  function validatePhone() {
    const val = phoneInput.value.trim();
    if (!val) { setError(phoneInput, 'رقم الهاتف مطلوب'); return false; }
    if (!/^[0-9]+$/.test(val)) { setError(phoneInput, 'يرجى إدخال الأرقام بالإنجليزية فقط'); return false; }
    if (!/^01[0-9]{9}$/.test(val)) { setError(phoneInput, 'يجب أن يكون 11 رقم ويبدأ بـ 01'); return false; }
    setError(phoneInput, null);
    return true;
  }

  function validatePhone2() {
    const val = phone2Input.value.trim();
    if (!val) { setError(phone2Input, null); return true; }
    if (!/^[0-9]+$/.test(val)) { setError(phone2Input, 'يرجى إدخال الأرقام بالإنجليزية فقط'); return false; }
    if (!/^01[0-9]{9}$/.test(val)) { setError(phone2Input, 'يجب أن يكون 11 رقم ويبدأ بـ 01'); return false; }
    setError(phone2Input, null);
    return true;
  }

  function validateAddress() {
    let valid = true;
    if (addressCityInput) {
      if (!addressCityInput.value.trim()) { setError(addressCityInput, 'المدينة / المركز مطلوب'); valid = false; }
      else setError(addressCityInput, null);
    }
    if (addressVillageInput) {
      if (!addressVillageInput.value.trim()) { setError(addressVillageInput, 'القرية / المنطقة مطلوبة'); valid = false; }
      else setError(addressVillageInput, null);
    }
    if (addressDetailInput) {
      if (!addressDetailInput.value.trim()) { setError(addressDetailInput, 'مكان البيت بالتفصيل مطلوب'); valid = false; }
      else setError(addressDetailInput, null);
    }
    return valid;
  }

  function validateGov() {
    if (!govHiddenInput.value || !govSearchInput.value.trim()) {
      setError(govSearchInput, 'من فضلك اختر من القائمه');
      return false;
    }
    setError(govSearchInput, null);
    return true;
  }

  govSearchInput.addEventListener('blur', () => {
    setTimeout(() => {
      validateGov();
    }, 200);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Trigger validation for all fields
    const isNameValid = validateName();
    const isPhoneValid = validatePhone();
    const isPhone2Valid = validatePhone2();
    const isGovValid = validateGov();
    const isAddressValid = validateAddress();
    const isValid = isNameValid && isPhoneValid && isPhone2Valid && isGovValid && isAddressValid;

    if (!isValid) {
      const firstInvalid = form.querySelector('.invalid');
      if (firstInvalid) {
        firstInvalid.focus();
        firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    const itemsForValidation = Cart.getItems();
    const hasInvalidStock = itemsForValidation.some(item => {
      let available = Infinity;
      if (item.selectedOptions && item.selectedOptions.length > 0 && item.variants && item.variants.length > 0) {
        const v = item.variants.find(v => item.selectedOptions.every(so => v.combination[so.groupName] === so.label));
        if (v && v.quantity !== null && v.quantity !== undefined) available = v.quantity;
      } else if (item.availableQuantity !== null && item.availableQuantity !== undefined) {
        available = item.availableQuantity;
      }
      return item.quantity > available;
    });

    if (hasInvalidStock) {
      showToast('بعض المنتجات في السلة غير متوفرة بالكمية المطلوبة. يرجى تعديل السلة.', 'error');
      return;
    }

    const payment = document.querySelector('input[name="payment"]:checked');
    if (!payment) { showToast('اختر طريقة الدفع', 'error'); return; }

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true; btn.textContent = 'جاري تنفيذ طلبك...';

    const cityId = govHiddenInput.value;
    const govData = (window._fullShippingData || []).find(s => s._id === cityId);
    const cityName = govData ? (govData.cityOtherName || govData.city) : '';

    const items = Cart.getItems().map(item => {
      const effectiveBase = (item.salePrice && item.salePrice < item.basePrice) ? item.salePrice : item.basePrice;
      return {
        productId: item.productId,
        name: item.name,
        imageUrl: item.imageUrl || '',
        basePrice: effectiveBase,
        unitPrice: item.unitPrice,
        selectedOptions: item.selectedOptions,
        finalPrice: item.unitPrice * item.quantity,
        quantity: item.quantity,
        isFreeGift: item.isFreeGift || false
      };
    });

    const orderData = {
      customer: {
        name: convertArabicDigitsToEnglish(nameInput.value.trim()),
        phone: convertArabicDigitsToEnglish(phoneInput.value.trim()),
        secondPhone: convertArabicDigitsToEnglish(phone2Input.value.trim()),
        address: convertArabicDigitsToEnglish(getCombinedAddress()),
        government: cityName,
        notes: convertArabicDigitsToEnglish(document.getElementById('cust-notes').value.trim())
      },
      items,
      paymentMethod: payment.value,
      carrier: (activeShippingOption && activeShippingOption.name) ? activeShippingOption.name : (window._selectedCarrier || ''),
      shippingFee: window._currentShippingFee !== undefined ? window._currentShippingFee : 0
    };

    try {
      const order = await api.createOrder(orderData);
      
      // Cleanup abandoned cart token and draft
      const token = localStorage.getItem('loli_checkout_token');
      if (token) {
        api.deleteAbandonedCartByToken(token).catch(err => console.warn(err));
        localStorage.removeItem('loli_checkout_token');
      }
      localStorage.removeItem('loli_checkout_draft');

      Cart.clear();
      window.location.href = `payment?id=${order.orderId}`;
    } catch (err) {
      showToast(err.message || 'فشل في إتمام الطلب', 'error');
      btn.disabled = false; btn.textContent = 'تأكيد الطلب';
    }
  });
}

// ── Restore Checkout Draft ──────────────────────────────────
async function restoreCheckoutDraft() {
  // Sanitize any old draft data in localStorage
  try {
    const rawDraft = localStorage.getItem('loli_checkout_draft');
    if (rawDraft) {
      const parsed = JSON.parse(rawDraft);
      if (parsed.carrier) {
        delete parsed.carrier;
        localStorage.setItem('loli_checkout_draft', JSON.stringify(parsed));
      }
    }
  } catch (e) {}

  const nameInput = document.getElementById('cust-name');
  const phoneInput = document.getElementById('cust-phone');
  const phone2Input = document.getElementById('cust-phone2');
  const addressCityInput = document.getElementById('cust-address-city');
  const addressVillageInput = document.getElementById('cust-address-village');
  const addressDetailInput = document.getElementById('cust-address-detail');
  const govSearchInput = document.getElementById('government-search');
  const govHiddenInput = document.getElementById('government');
  const notesInput = document.getElementById('cust-notes');

  const draftStr = localStorage.getItem('loli_checkout_draft');
  if (draftStr) {
    try {
      const draft = JSON.parse(draftStr);
      if (draft.name && nameInput) nameInput.value = draft.name;
      if (draft.phone && phoneInput) phoneInput.value = draft.phone;
      if (draft.secondPhone && phone2Input) phone2Input.value = draft.secondPhone;
      
      if (draft.addressCity && addressCityInput) addressCityInput.value = draft.addressCity;
      if (draft.addressVillage && addressVillageInput) addressVillageInput.value = draft.addressVillage;
      if (draft.addressDetail && addressDetailInput) addressDetailInput.value = draft.addressDetail;

      // Fallback if older draft format was stored
      if (!draft.addressCity && draft.address) {
        const parts = draft.address.split(' - ');
        if (parts[0] && addressCityInput) addressCityInput.value = parts[0];
        if (parts[1] && addressVillageInput) addressVillageInput.value = parts[1];
        if (parts[2] && addressDetailInput) addressDetailInput.value = parts.slice(2).join(' - ');
      }

      if (draft.notes && notesInput) notesInput.value = draft.notes;
      
      if (draft.government && govHiddenInput && govSearchInput) {
        const list = window._fullShippingData || [];
        const match = list.find(s => (s.cityOtherName || s.city) === draft.government);
        if (match) {
          govHiddenInput.value = match._id;
          govSearchInput.value = match.cityOtherName || match.city;
          await handleGovChange();
        }
      }
    } catch (err) {
      console.error('Failed to parse checkout draft:', err);
    }
  }

  // Set flag to enable sync
  window._checkoutDraftLoaded = true;
  updatePriceSummary();

  // Bind change/input listeners to all checkout form fields to sync on change
  const form = document.getElementById('checkout-form');
  if (form) {
    form.querySelectorAll('input, textarea').forEach(input => {
      input.addEventListener('input', syncAbandonedCart);
      input.addEventListener('change', syncAbandonedCart);
    });
  }
}

// ── Debounced Sync Abandoned Cart ───────────────────────────
let syncTimeout = null;
function syncAbandonedCart() {
  if (window._checkoutDraftLoaded !== true) return;
  
  clearTimeout(syncTimeout);
  syncTimeout = setTimeout(async () => {
    let token = localStorage.getItem('loli_checkout_token');
    if (!token) {
      token = 'chk_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      localStorage.setItem('loli_checkout_token', token);
    }

    const name = document.getElementById('cust-name')?.value.trim() || '';
    const phone = document.getElementById('cust-phone')?.value.trim() || '';
    const phone2 = document.getElementById('cust-phone2')?.value.trim() || '';
    
    const addressCity = document.getElementById('cust-address-city')?.value.trim() || '';
    const addressVillage = document.getElementById('cust-address-village')?.value.trim() || '';
    const addressDetail = document.getElementById('cust-address-detail')?.value.trim() || '';
    const address = [addressCity, addressVillage, addressDetail].filter(Boolean).join(' - ');

    const cityId = document.getElementById('government')?.value || '';
    const govData = (window._fullShippingData || []).find(s => s._id === cityId);
    const cityName = govData ? (govData.cityOtherName || govData.city) : '';
    const notes = document.getElementById('cust-notes')?.value.trim() || '';

    const draft = {
      name,
      phone,
      secondPhone: phone2,
      address,
      addressCity,
      addressVillage,
      addressDetail,
      government: cityName,
      notes
    };

    localStorage.setItem('loli_checkout_draft', JSON.stringify(draft));

    const items = Cart.getItems();
    // Do not sync to DB if cart is empty
    if (items.length === 0) return;

    const payload = {
      checkoutToken: token,
      customer: draft,
      items
    };

    try {
      await api.saveAbandonedCart(payload);
    } catch (err) {
      console.warn('Failed to sync abandoned cart to backend:', err);
    }
  }, 1000);
}

// Export function to global scope
window.syncAbandonedCart = syncAbandonedCart;
