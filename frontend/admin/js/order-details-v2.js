/** Admin — Order Details JS */

let currentOrder = null;
let originalOrder = null;
let allProducts = [];
let collectionsMap = {};
let shippingMap = {};

function getCarrierInternalValue(name) {
  if (!name) return 'default';
  if (name.includes('بوسطة') || name.toLowerCase().includes('bosta')) return 'bosta';
  return name;
}

function resolveShippingDetails(cityName, forcedCarrier) {
  const isCityEqual = (a, b) => {
    if (!a || !b) return false;
    const norm = (s) => s.replace(/[أإآا]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, '').toLowerCase().trim();
    return norm(a) === norm(b);
  };

  let carrier = forcedCarrier || (window._shippingOptions && window._shippingOptions[0] ? window._shippingOptions[0].name : 'default');
  let govData = (window._fullShippingData || []).find(s =>
    isCityEqual(s.city, cityName) || isCityEqual(s.cityOtherName, cityName)
  );

  let fee = 0;
  if (!window._shippingOptions || window._shippingOptions.length === 0) {
    fee = govData ? (govData.fee || 0) : 0;
  } else {
    const selectedOption = window._shippingOptions.find(o => getCarrierInternalValue(o.name) === carrier) || window._shippingOptions[0];
    if (!forcedCarrier && selectedOption) {
      carrier = getCarrierInternalValue(selectedOption.name);
    }
    const cityObj = selectedOption ? (selectedOption.cities || []).find(c =>
      isCityEqual(c.city, cityName)
    ) : null;
    fee = cityObj ? cityObj.fee : (selectedOption ? selectedOption.cost : 0);
  }

  return { fee, carrier };
}

function getShippingFeeForCity(cityName) {
  const details = resolveShippingDetails(cityName);
  return details.fee;
}

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


function getProductCombinations(options) {
  if (!options || options.length === 0) return [];
  let results = [[]];
  for (const group of options) {
    const currentResults = [];
    const values = group.values;
    for (const res of results) {
      for (const val of values) {
        currentResults.push([...res, { groupName: group.name, label: val.label, price: val.price }]);
      }
    }
    results = currentResults;
  }
  return results;
}

window.toggleProductVariants = function (pid) {
  const el = document.getElementById(`variants-${pid}`);
  const icon = document.getElementById(`icon-${pid}`);
  if (!el) return;
  if (el.style.display === 'none') {
    el.style.display = 'block';
    icon.style.transform = 'rotate(180deg)';
  } else {
    el.style.display = 'none';
    icon.style.transform = 'rotate(0deg)';
  }
};

document.addEventListener('DOMContentLoaded', async () => {
  if (!requireAdmin()) return;

  const urlParams = new URLSearchParams(window.location.search);
  const orderId = urlParams.get('id');
  if (!orderId) {
    window.location.href = 'orders';
    return;
  }

  document.body.classList.add('is-loading');

  try {
    const [order, settings, shippingOptions] = await Promise.all([
      api.getOrder(orderId),
      api.getSetting('loli_global_settings').catch(() => ({})),
      api.getSetting('shipping_options').catch(() => [])
    ]);

    currentOrder = order;
    originalOrder = JSON.parse(JSON.stringify(order));
    window._globalSettings = settings || {};
    window._shippingOptions = shippingOptions || [];

    // Background fetch heavy payloads
    Promise.all([
      api.getShippingList().catch(() => []),
      api.getProducts(1, 1000, true).catch(() => [])
    ]).then(([shipping, productsRes]) => {
      window._fullShippingData = shipping;
      allProducts = Array.isArray(productsRes) ? productsRes : (productsRes.products || []);
      // Re-render items in case stock indicators or variant images need to be updated
      renderItems();
    });

    if (currentOrder.appliedPromotionName || currentOrder.appliedPromotionId) {
      try {
        const promoInfo = await api.getOrderPromotion(orderId);
        if (promoInfo) {
          currentOrder.appliedPromotionId = promoInfo.appliedPromotionId || currentOrder.appliedPromotionId;
          currentOrder.appliedPromotionName = promoInfo.appliedPromotionName || currentOrder.appliedPromotionName;
          currentOrder.appliedPromotionRewardText = promoInfo.rewardText || currentOrder.appliedPromotionRewardText;
          currentOrder.appliedPromotionRewards = promoInfo.appliedPromotionRewards || currentOrder.appliedPromotionRewards;
          currentOrder.appliedPromotion = promoInfo.promotion || currentOrder.appliedPromotion;
          if (typeof renderPromoCard === 'function') renderPromoCard();
        }
      } catch (err) {
        console.warn('Failed to load promotion info:', err);
      }
    }

    const searchInput = document.getElementById('modal-c-gov-search');
    const dropdown = document.getElementById('modal-c-gov-dropdown');
    const hiddenInput = document.getElementById('modal-c-gov');

    if (searchInput && dropdown) {
      searchInput.addEventListener('focus', () => renderModalGovDropdown());
      searchInput.addEventListener('input', () => renderModalGovDropdown());

      document.addEventListener('click', (e) => {
        if (!document.getElementById('modal-c-gov-search-container').contains(e.target)) {
          dropdown.style.display = 'none';
        }
      });

      window.renderModalGovDropdown = function () {
        const query = searchInput.value.toLowerCase().trim();
        const filtered = (window._fullShippingData || []).filter(s =>
          s.city.toLowerCase().includes(query) || (s.cityOtherName && s.cityOtherName.toLowerCase().includes(query))
        );

        if (filtered.length === 0) {
          dropdown.innerHTML = '<div style="padding: 10px; color: #94a3b8; text-align: center;">لا توجد نتائج</div>';
        } else {
          dropdown.innerHTML = filtered.map(s => `
            <div class="dropdown-item" style="padding: 12px 16px; cursor: pointer; border-bottom: 1px solid #f1f5f9; text-align:right;" 
                 onclick="selectModalGov('${s._id}', '${s.cityOtherName || s.city}')">
              ${s.cityOtherName || s.city}
            </div>
          `).join('');
        }
        dropdown.style.display = 'block';
      }

      window.selectModalGov = (id, name) => {
        hiddenInput.value = id;
        searchInput.value = name;
        dropdown.style.display = 'none';
        handleModalCityChange();
      };
    }

    // Populate Payment Methods select
    const paymentSelect = document.getElementById('modal-payment-method');
    if (paymentSelect && settings.paymentMethods) {
      paymentSelect.innerHTML = settings.paymentMethods.map(m => `
        <option value="${m.label}">${m.label} (${m.number})</option>
      `).join('');
    }


    renderOrder();
    document.body.classList.remove('is-loading');
  } catch (err) {
    showToast('فشل تحميل بيانات الطلب', 'error');
    document.body.classList.remove('is-loading');
  }

  // Action: Ship Current Order via Bosta API
  window.shipCurrentOrder = async function shipCurrentOrder(btn) {
    if (!currentOrder) return;
    const orderId = currentOrder.orderId;

    // Check if the order is already shipped
    if (currentOrder.bostaDeliveryId) {
      showToast(`الطلب مشحون بالفعل برقم تتبع: ${currentOrder.bostaTrackingNumber || ''}`, 'info');
      return;
    }

    // Egypt Post orders cannot be shipped via Bosta
    if (currentOrder.carrier !== 'bosta') {
      showToast('لا يمكن شحن هذا الطلب عبر Bosta لأن شركة الشحن المحددة ليست بوسطة', 'error');
      return;
    }

    // Check if order is cancelled
    if (currentOrder.status === 'cancelled') {
      showToast('لا يمكن شحن طلب ملغي', 'error');
      return;
    }

    // Show beautiful confirmation modal
    const confirmed = await window.showConfirmModal(
      'تأكيد شحن الطلب',
      `هل تريد شحن الطلب #${orderId} عبر Bosta؟`
    );
    if (!confirmed) return;

    const originalHtml = btn ? btn.innerHTML : 'Shipment شحن الاوردر';
    if (btn) {
      btn.innerHTML = '<div class="spinner" style="width:16px;height:16px;border-color:#475569;border-top-color:transparent;margin:0;display:inline-block;vertical-align:middle;margin-left:8px;"></div><span>جاري الشحن...</span>';
      btn.disabled = true;
    }

    // Automatically save unsaved changes before shipping
    if (originalOrder && JSON.stringify(currentOrder) !== JSON.stringify(originalOrder)) {
      const saved = await saveOrderChanges(true);
      if (!saved) {
        showToast('فشل حفظ التعديلات قبل الشحن، يرجى التحقق من صحة البيانات', 'error');
        if (btn) {
          btn.innerHTML = originalHtml;
          btn.disabled = false;
        }
        return;
      }
    }

    try {
      const result = await api.shipOrdersBulk([orderId]);
      if (result && result.count > 0) {
        showToast('تم شحن الاوردر بنجاح', 'success');

        // Reload order data after a brief delay to show new status and tracking number
        setTimeout(() => window.location.reload(), 1000);
      } else {
        showToast(result.message || 'فشل شحن الطلب، تأكد من حالة الدفع والبيانات', 'error');
      }
    } catch (err) {
      console.error('Shipping Error:', err);
      showToast(err.message || 'حدث خطأ أثناء شحن الطلب عبر Bosta', 'error');
    } finally {
      if (btn) {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
      }
    }
  }

  // Global Discard Handler
  window.handleGlobalDiscard = () => {
    if (!originalOrder) return;
    currentOrder = JSON.parse(JSON.stringify(originalOrder));
    renderOrder();
    if (window.hideBar) window.hideBar();
  };

  // Global Save Handler
  window.handleGlobalSave = async () => {
    const success = await saveOrderChanges();
    if (success !== false) {
      originalOrder = JSON.parse(JSON.stringify(currentOrder));
      // Give time for toast, then reload for a clean state
      setTimeout(() => window.location.reload(), 800);
    }
    return success;
  };
});


// ── Rendering ──────────────────────────────────────────
function renderOrder() {
  if (!currentOrder) return;

  const o = currentOrder;
  const displayId = (o.orderId || '').replace(/^Order-|^Scoop-/i, '');
  const pageOrderEl = document.getElementById('page-order-id');
  if (pageOrderEl) {
    pageOrderEl.innerHTML = `<span dir="ltr" style="font-weight:700; color:#0ea5e9; font-size:1.15rem;">#${displayId}</span>`;
  }

  if (o.status === 'cancelled') {
    document.getElementById('cancel-order-btn')?.style.display === 'none';
    if (pageOrderEl) pageOrderEl.innerHTML += ' <span class="badge badge-danger" style="margin-right:6px; font-size:0.75rem;">ملغي</span>';
  }

  // Ready button visibility and action toggle
  const readyBtnContainer = document.getElementById('ready-btn-container');
  if (readyBtnContainer) {
    if (o.status === 'pending') {
      readyBtnContainer.style.display = 'block';
      readyBtnContainer.innerHTML = `<button class="btn" id="btn-make-ready" onclick="markAsReady()" style="background:#0f766e; color:#fff; border-radius:12px; padding:8px 24px; font-weight:700; font-size:0.9rem; box-shadow: 0 4px 10px rgba(15, 118, 110, 0.15); border:none;">جاهز</button>`;
    } else if (o.status === 'ready') {
      readyBtnContainer.style.display = 'block';
      readyBtnContainer.innerHTML = `<button class="btn" id="btn-cancel-ready" onclick="cancelReady(this)" style="background:#fff; color:#ef4444; border:1px solid #fee2e2; border-radius:12px; padding:8px 24px; font-weight:700; font-size:0.9rem;">إلغاء التجهيز</button>`;
    } else {
      readyBtnContainer.style.display = 'none';
    }
  }
  if (o.status === 'ready') {
    if (pageOrderEl) pageOrderEl.innerHTML += ' <span class="badge badge-success" style="background:#0f766e; color:#fff; padding: 3px 10px; border-radius: 12px; font-size: 0.75rem; margin-right:6px;">جاهز</span>';
  }

  // Customer Info Consolidated
  document.getElementById('view-c-name').textContent = o.customer.name || '—';

  const phoneContainer = document.getElementById('view-c-phone');
  if (o.customer.phone) {
    let cleanPhone = o.customer.phone.replace(/[^0-9]/g, '');
    if (cleanPhone.startsWith('01')) cleanPhone = '2' + cleanPhone;
    const waIconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align: middle; margin-right: 6px;"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>`;
    phoneContainer.innerHTML = `<span dir="ltr">${o.customer.phone}</span> <a href="https://wa.me/${cleanPhone}" target="_blank" onclick="event.stopPropagation()" style="color:#10b981; text-decoration:none;" title="مراسلة العميل عبر واتساب">${waIconSvg}</a>`;
  } else {
    phoneContainer.textContent = '—';
  }

  const phone2El = document.getElementById('view-c-phone2');
  if (o.customer.secondPhone) {
    let cleanPhone2 = o.customer.secondPhone.replace(/[^0-9]/g, '');
    if (cleanPhone2.startsWith('01')) cleanPhone2 = '2' + cleanPhone2;
    const waIconSvg2 = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align: middle; margin-right: 6px;"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>`;
    phone2El.innerHTML = `<span dir="ltr">${o.customer.secondPhone}</span> <a href="https://wa.me/${cleanPhone2}" target="_blank" onclick="event.stopPropagation()" style="color:#10b981; text-decoration:none;" title="مراسلة العميل عبر واتساب">${waIconSvg2}</a>`;
    phone2El.style.display = 'block';
  } else {
    phone2El.style.display = 'none';
  }

  // Shipping Info
  document.getElementById('view-c-address').textContent = o.customer.address || 'لا يوجد عنوان';

  const govEl = document.getElementById('view-c-gov');
  govEl.textContent = o.customer.government || 'لا يوجد محافظة';
  if (o.carrier && o.carrier === 'bosta') {
    if (o.bostaTrackingNumber) {
      govEl.innerHTML += ` <span class="badge badge-success" style="background:#e0f2fe; color:#0369a1; padding: 4px 12px; border-radius: 12px; font-size: 0.75rem; margin-right:8px; font-weight:700; display:inline-flex; align-items:center; gap:4px;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;"><rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>
        بوسطة (#${o.bostaTrackingNumber})
      </span>`;
    } else {
      govEl.innerHTML += ' <span class="badge badge-info" style="background:#f1f5f9; color:#475569; padding: 4px 8px; border-radius: 12px; font-size: 0.75rem; margin-right:8px; font-weight:700;">بوسطة (غير مشحون)</span>';
    }
  } else if (o.carrier) {
    const carrierDisplay = (o.carrier === 'egyptpost') ? 'شحن عادي' : o.carrier;
    govEl.innerHTML += ` <span class="badge" style="background:#f1f5f9; color:#475569; padding: 4px 8px; border-radius: 12px; font-size: 0.75rem; margin-right:8px; font-weight:700;">${carrierDisplay}</span>`;
  }

  document.getElementById('view-payment-method').textContent =
    o.paymentMethod === 'vodafone_cash' ? 'فودافون كاش' :
      o.paymentMethod === 'instapay' ? 'إنستاباي' :
        o.paymentMethod === 'card' ? 'بطاقة ائتمان' : 'دفع عند الاستلام';

  // Transfer info card
  const transferCard = document.getElementById('transfer-info-card');
  
  // Extract transfer notes from legacy customer.notes if present
  let displayNotes = o.customer.notes || '';
  let legacyTransferNotes = '';
  if (displayNotes.includes('[معلومات التحويل]:')) {
    const parts = displayNotes.split('[معلومات التحويل]:');
    displayNotes = parts[0].trim();
    legacyTransferNotes = parts.slice(1).join('[معلومات التحويل]:').trim();
  }
  
  if (transferCard) transferCard.style.display = 'block';
  document.getElementById('admin-transfer-number').value = o.transferNumber || '';
  document.getElementById('admin-transfer-notes').value = o.transferNotes || legacyTransferNotes || '';
    
    const screenLink = document.getElementById('admin-transfer-screenshot-link');
    const screenImg = document.getElementById('admin-transfer-screenshot-img');
    const removeBtn = document.getElementById('admin-transfer-screenshot-remove');
    
    if (o.transferScreenshot) {
      screenLink.href = o.transferScreenshot;
      screenImg.src = o.transferScreenshot;
      screenLink.style.display = 'block';
      removeBtn.style.display = 'block';
    } else {
      screenLink.href = '#';
      screenImg.src = '';
      screenLink.style.display = 'none';
      removeBtn.style.display = 'none';
    }
  if (transferCard) {
    // If it's a completely different payment method that isn't supposed to have transfer info, we could optionally style it differently,
    // but the user requested it to be visible.
  }
  const notesEl = document.getElementById('view-c-notes');
  const notesContainer = document.getElementById('view-c-notes-container');
  if (displayNotes) {
    notesEl.textContent = displayNotes;
    notesContainer.style.display = 'block';
  } else {
    notesContainer.style.display = 'none';
  }

  // Promotions & Gifts Card
  renderPromoCard();

  // Payment
  const paymentLabels = {
    'vodafone_cash': 'فودافون كاش',
    'instapay': 'إنستاباي'
  };
  document.getElementById('view-payment-method').textContent = paymentLabels[o.paymentMethod] || o.paymentMethod;
  document.getElementById('view-paid-amount').textContent = formatPrice(o.paidAmount || 0);

  renderItems();
  updateTotals();
}

function getAvailableQty(p, selectedOptions = []) {
  if (selectedOptions.length > 0 && p.variants && p.variants.length > 0) {
    const v = p.variants.find(v => {
      return selectedOptions.every(so => v.combination[so.groupName] === so.label);
    });
    return (v && v.quantity !== null && v.quantity !== undefined) ? v.quantity : Infinity;
  }
  return (p.quantity !== null && p.quantity !== undefined) ? p.quantity : Infinity;
}

function renderItems() {
  const container = document.getElementById('order-items-container');
  if (!currentOrder.items || currentOrder.items.length === 0) {
    container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted)">لا توجد منتجات في هذا الطلب</div>';
    return;
  }

  container.innerHTML = currentOrder.items.map((item, idx) => {
    const p = allProducts.find(x => x._id === item.productId) || {};
    const available = getAvailableQty(p, item.selectedOptions);
    const lowStock = available !== Infinity && item.quantity > available;

    let finalImageUrl = item.imageUrl;
    if (!finalImageUrl && p) {
      if (p.variants && item.selectedOptions && item.selectedOptions.length > 0) {
        const matchingVariant = p.variants.find(v => {
          if (!v.combination) return false;
          return item.selectedOptions.every(opt => v.combination[opt.groupName] === opt.label);
        });
        if (matchingVariant && matchingVariant.imageUrl) {
          finalImageUrl = matchingVariant.imageUrl;
        }
      }
      if (!finalImageUrl) {
        finalImageUrl = (p.images && p.images.length > 0) ? p.images[0] : (p.imageUrl || '');
      }
    }

    const imgHtml = finalImageUrl
      ? `<img src="${finalImageUrl}" style="width:52px; height:52px; border-radius:8px; object-fit:contain; border:1px solid #f1f5f9;" alt="${item.name}">`
      : `<div style="width:52px; height:52px; border-radius:8px; background:#f8fafc; display:flex; align-items:center; justify-content:center; color:#94a3b8; border:1px solid #f1f5f9;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg></div>`;

    const optText = (item.selectedOptions || []).map(op => op.label).join(' / ');
    return `
      <div style="padding: 16px 20px; border-bottom: 1px solid #f1f5f9; background: #fff; display: flex; flex-direction: column; gap: 14px;">
        <!-- Top Row -->
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 52px;">
          <!-- Right side: Image + Name -->
          <div style="display: flex; align-items: center; gap: 12px; flex: 1.5;">
            ${imgHtml}
            <div style="text-align: right; display: flex; flex-direction: column; justify-content: center;">
              <div style="font-weight: 700; font-size: 13px; color: #1e293b; line-height: 1.2;">
                ${item.name}
                ${item.isFreeGift ? '<span class="badge" style="background:#dcfce7;color:#166534;font-size:0.7rem;margin-right:6px;padding:2px 6px;border-radius:4px;">هدية مجانية 🎁</span>' : ''}
              </div>
              ${optText ? `<div style="font-size: 0.8rem; color: #64748b; margin-top: 2px;">${optText}</div>` : ''}
              ${item.discount ? (item.discount > 0
        ? `<div style="font-size:0.75rem; color:#dc2626; margin-top:4px; font-weight:600;">خصم: ${formatPrice(item.discount)}</div>`
        : `<div style="font-size:0.75rem; color:#10b981; margin-top:4px; font-weight:600;">زياده ${Math.abs(item.discount)} ج.م</div>`
      ) : ''}
              ${lowStock ? `<div style="font-size:0.75rem; color:#b45309; margin-top:4px; font-weight:600; background:#fef3c7; padding:2px; border-radius:4px; display:inline-block;">الباقي : ${available} قطعة</div>` : ''}
            </div>

          </div>
          
          <!-- Left side: Unit Price Block and Total Price -->
          <div style="display: flex; align-items: center; gap: 16px; flex: 1; justify-content: space-between;">
            <div style="font-size: 0.85rem; color: #64748b; white-space: nowrap; font-weight: 500; text-align: center; flex: 1;" dir="ltr">
              ${item.isFreeGift ? '' : `${formatPrice(item.basePrice)}x${item.quantity}`}
            </div>
            <div style="font-weight: 700; font-size: 1rem; color: #1e293b; min-width: 80px; text-align: left; flex: 1;">
              ${item.isFreeGift ? '<span style="color:#10b981;">مجانًا</span>' : formatPrice(item.finalPrice)}
            </div>
          </div>
        </div>

        <!-- Bottom Row -->
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <button class="btn btn-sm" onclick="openItemDiscountModal(${idx})" style="background: #fff; border: 1px solid #e2e8f0; color: #475569; display: flex; align-items: center; gap: 6px; font-size: 0.8rem; padding: 6px 14px; border-radius: 8px; height: 36px; font-weight: 600;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="3"/><circle cx="16" cy="16" r="3"/><line x1="16" y1="8" x2="8" y2="16"/></svg>
              تعديل السعر
            </button>
            
            <div style="display: flex; align-items: center; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; background: #fff; height: 36px; min-width: 110px;">
              <button onclick="updateItemQty(${idx}, ${item.quantity + 1})" style="flex: 1; height: 100%; border: none; background: transparent; cursor: pointer; font-size: 1.1rem; display: flex; align-items: center; justify-content: center;">+</button>
              <div style="width: 40px; text-align: center; font-weight: 700; font-size: 0.95rem; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; height: 100%; line-height: 36px;">${item.quantity}</div>
              <button onclick="${item.quantity > 1 ? `updateItemQty(${idx}, ${item.quantity - 1})` : ''}" style="flex: 1; height: 100%; border: none; background: ${item.quantity > 1 ? 'transparent' : '#f8fafc'}; cursor: ${item.quantity > 1 ? 'pointer' : 'not-allowed'}; font-size: 1.1rem; display: flex; align-items: center; justify-content: center; color: ${item.quantity > 1 ? 'inherit' : '#cbd5e1'};" ${item.quantity <= 1 ? 'disabled' : ''}>-</button>
            </div>
          </div>

          <button onclick="removeItem(${idx})" style="background: #fff; border: 1px solid #f1f5f9; color: #ef4444; display: flex; align-items: center; gap: 8px; font-size: 0.85rem; padding: 6px 14px; border-radius: 8px; height: 36px; cursor: pointer; font-weight: 500;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            إزالة
          </button>
        </div>
      </div>
    `;
  }).join('');
}

window.renderPromoCard = function () {
  const o = currentOrder;
  if (!o) return;

  const promoCard = document.getElementById('promo-info-card');
  const promoRow = document.getElementById('applied-promo-row');
  const giftsContainer = document.getElementById('free-gifts-container');
  const giftsList = document.getElementById('free-gifts-list');

  let hasPromo = false;

  if (o.appliedPromotionName) {
    if (promoRow) {
      promoRow.style.display = 'flex';

      const rewards = Array.isArray(o.appliedPromotionRewards) ? o.appliedPromotionRewards.filter(Boolean) : [];
      let badgesHtml = '';
      if (rewards.length > 0) {
        badgesHtml = rewards.map(r => `<span style="background: #e0e7ff; color: #4338ca; padding: 4px 10px; border-radius: 6px; font-size: 0.8rem; font-weight: 600; white-space:nowrap;">${r}</span>`).join('');
      }

      promoRow.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          ${badgesHtml}
        </div>
        <span style="font-weight:700; color:var(--primary); white-space:nowrap;">${o.appliedPromotionName}</span>
      `;
    }
    hasPromo = true;
  } else {
    if (promoRow) promoRow.style.display = 'none';
  }

  const freeGifts = (o.items || []).filter(item => item.isFreeGift);
  if (giftsContainer && giftsList) {
    if (freeGifts.length > 0) {
      giftsContainer.style.display = 'block';
      giftsList.innerHTML = freeGifts.map(g => `<li style="margin-bottom:4px; display:flex; align-items:center; gap:6px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> ${g.name} (${g.quantity}x)</li>`).join('');
      hasPromo = true;
    } else {
      giftsContainer.style.display = 'none';
    }
  }

  if (promoCard) {
    promoCard.style.display = hasPromo ? 'block' : 'none';
  }
};

let _promoSyncTimeout = null;
window.syncOrderOffersAndTotals = async function (immediate = false) {
  const o = currentOrder;
  if (!o || !o.items) return;

  // 1. Recalculate line items finalPrice and subtotal
  let subtotal = 0;
  o.items.forEach(item => {
    const unitPrice = Number(item.basePrice) || Number(item.unitPrice) || Number(item.price) || 0;
    const itemDiscount = Number(item.discount) || 0;
    item.finalPrice = Math.max(0, (unitPrice * item.quantity) - itemDiscount);
    subtotal += item.finalPrice;
  });
  o.subtotal = subtotal;

  // Immediate UI update for basic subtotal
  updateTotals();

  const runEvaluation = async () => {
    try {
      const promoItems = o.items.map(item => ({
        productId: item.productId,
        unitPrice: Number(item.basePrice) || Number(item.unitPrice) || Number(item.price) || 0,
        quantity: item.quantity,
        isFreeGift: Boolean(item.isFreeGift),
        selectedOptions: item.selectedOptions || []
      }));

      const promoResult = await api.evaluatePromotions(promoItems);

      if (promoResult && promoResult.appliedPromotion) {
        o.appliedPromotionId = promoResult.appliedPromotion._id || null;
        o.appliedPromotionName = promoResult.appliedPromotion.name;
        o.appliedPromotionRewards = Array.isArray(promoResult.rewardTexts) ? promoResult.rewardTexts : [];
        o.appliedPromotionRewardText = promoResult.rewardText || (o.appliedPromotionRewards.join(' و ') || '');

        if (!o.isCustomDiscount) {
          o.discount = promoResult.totalDiscount || 0;
        }

        if (promoResult.freeShipping) {
          if (!o.isCustomShipping) {
            o.shippingFee = 0;
          }
        }
      } else {
        // Promotion no longer applies for current items/amounts
        if (!o.isCustomDiscount) {
          if (o.appliedPromotionName || o.appliedPromotionId) {
            o.discount = 0;
          }
          o.appliedPromotionId = null;
          o.appliedPromotionName = null;
          o.appliedPromotionRewards = [];
          o.appliedPromotionRewardText = '';
        }

        // Restore standard shipping fee if shipping was 0 from a promotion
        if (o.shippingFee === 0 && !o.isCustomShipping && window._fullShippingData && o.customer?.city) {
          const cityObj = window._fullShippingData.find(s => s.city === o.customer.city || s.cityOtherName === o.customer.city);
          if (cityObj) {
            const currentCarrier = o.carrier || 'egyptpost';
            o.shippingFee = (currentCarrier === 'bosta') ? (cityObj.bostaShippingFee || cityObj.shippingFee || 0) : (cityObj.shippingFee || 0);
          }
        }
      }
    } catch (err) {
      console.warn('Promotion sync evaluation warning:', err);
    } finally {
      updateTotals();
      renderPromoCard();
    }
  };

  if (immediate) {
    if (_promoSyncTimeout) clearTimeout(_promoSyncTimeout);
    await runEvaluation();
  } else {
    if (_promoSyncTimeout) clearTimeout(_promoSyncTimeout);
    _promoSyncTimeout = setTimeout(runEvaluation, 100);
  }
};

function updateTotals() {
  const o = currentOrder;
  let subtotal = 0;

  o.items.forEach(item => {
    // Standardized Absolute Pricing Model: basePrice is the unit price
    const unitPrice = Number(item.basePrice) || Number(item.unitPrice) || Number(item.price) || 0;
    const itemDiscount = Number(item.discount) || 0;
    item.finalPrice = Math.max(0, (unitPrice * item.quantity) - itemDiscount);
    subtotal += item.finalPrice;
  });
  o.subtotal = subtotal;

  o.totalPrice = Math.max(0, subtotal + (o.shippingFee || 0) - (o.discount || 0));

  document.getElementById('sum-subtotal').textContent = formatPrice(subtotal);
  document.getElementById('sum-items-count').textContent = o.items.reduce((s, i) => s + i.quantity, 0);
  document.getElementById('sum-shipping').textContent = formatPrice(o.shippingFee);

  const discRow = document.getElementById('sum-discount-row');
  if (o.discount !== undefined && o.discount !== null && o.discount !== 0) {
    discRow.style.display = 'flex';
    document.getElementById('sum-discount').textContent = formatPrice(Math.abs(o.discount));
    const label = document.getElementById('sum-discount-label');
    if (label) {
      if (o.discount > 0) {
        label.textContent = (o.appliedPromotionName && !o.isCustomDiscount) 
          ? `خصم العرض (${o.appliedPromotionName})` 
          : (o.isCustomDiscount ? 'خصم يدوي' : 'خصم الطلب');
      } else {
        label.textContent = 'زيادة في الطلب';
      }
      label.style.color = o.discount > 0 ? 'var(--danger)' : '#10b981';
    }
  } else {
    discRow.style.display = 'none';
  }

  document.getElementById('sum-total').textContent = formatPrice(o.totalPrice);
  updatePaymentStatusUI();
}

function updatePaymentStatusUI() {
  const o = currentOrder;
  const remaining = Math.max(0, o.totalPrice - (o.paidAmount || 0));

  const codFeeRow = document.getElementById('sum-collection-fee-row');
  if (codFeeRow) {
    codFeeRow.style.display = 'none';
  }

  document.getElementById('sum-remaining').textContent = formatPrice(remaining);

  const btn = document.getElementById('btn-mark-paid');
  const badge = document.getElementById('view-payment-status');

  if (remaining === 0 && o.totalPrice > 0) {
    btn.style.display = 'none';
    badge.textContent = 'مدفوع';
    badge.style.background = '#dcfce7';
    badge.style.color = '#166534';
  } else if (o.paidAmount > 0) {
    btn.style.display = 'inline-block';
    badge.textContent = 'مدفوع جزئياً';
    badge.style.background = '#fef3c7';
    badge.style.color = '#92400e';
  } else {
    btn.style.display = 'inline-block';
    badge.textContent = 'غير مدفوع';
    badge.style.background = '#fee2e2';
    badge.style.color = '#991b1b';
  }
}

// ── Modals & Editing ───────────────────────────────────

window.openModal = function (modalId) {
  document.getElementById(modalId).style.display = 'flex';
  document.body.style.overflow = 'hidden';
};

window.closeModal = function (modalId) {
  document.getElementById(modalId).style.display = 'none';
  // Only restore scroll if no other modals are open
  const openModals = document.querySelectorAll('.modal-overlay[style*="display: flex"]');
  if (openModals.length === 0) {
    document.body.style.overflow = '';
  }
};

window.openCustomerModal = function () {
  document.getElementById('modal-c-name').value = currentOrder.customer.name || '';
  document.getElementById('modal-c-phone').value = currentOrder.customer.phone || '';
  document.getElementById('modal-c-phone2').value = currentOrder.customer.secondPhone || '';

  const govName = currentOrder.customer.government || '';
  const govData = (window._fullShippingData || []).find(s => s.city === govName || s.cityOtherName === govName);

  const hiddenGov = document.getElementById('modal-c-gov');
  const searchGov = document.getElementById('modal-c-gov-search');

  if (govData) {
    hiddenGov.value = govData._id;
    searchGov.value = govData.cityOtherName || govData.city;
  } else {
    hiddenGov.value = '';
    searchGov.value = govName;
  }

  const carrierSelect = document.getElementById('modal-c-carrier');
  if (carrierSelect) {
    if (window._shippingOptions && window._shippingOptions.length > 0) {
      carrierSelect.innerHTML = window._shippingOptions.map(o => {
        const val = getCarrierInternalValue(o.name);
        return `<option value="${val}">${o.name}</option>`;
      }).join('');
    }

    // Set current value
    const currentVal = currentOrder.carrier || 'egyptpost';
    const matchingOpt = Array.from(carrierSelect.options).find(opt => opt.value === currentVal);
    if (matchingOpt) {
      carrierSelect.value = matchingOpt.value;
    } else if (carrierSelect.options.length > 0) {
      carrierSelect.value = carrierSelect.options[0].value;
    }
  }

  const addressInput = document.getElementById('modal-c-address');
  if (addressInput) {
    addressInput.value = currentOrder.customer.address || '';
  }
  const notesInput = document.getElementById('modal-c-notes');
  if (notesInput) {
    notesInput.value = currentOrder.customer.notes || '';
  }

  openModal('customer-modal');
};

window.handleModalCityChange = async function () {
  // City change handler
};

window.handleModalCarrierChange = function () {
};

document.addEventListener('click', (e) => {
  const govContainer = document.getElementById('modal-c-gov-search-container');
  const govDropdown = document.getElementById('modal-c-gov-dropdown');
  if (govContainer && !govContainer.contains(e.target)) {
    govDropdown.style.display = 'none';
  }
});

window.applyCustomerChanges = async function (btn) {
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:8px;display:inline-block;vertical-align:middle;"></span> جارٍ الحفظ...';
  }

  const name = document.getElementById('modal-c-name').value.trim();
  const phone = document.getElementById('modal-c-phone').value.trim();
  const cityId = document.getElementById('modal-c-gov').value;
  const cityNameFromSearch = document.getElementById('modal-c-gov-search').value.trim();

  const carrier = document.getElementById('modal-c-carrier')?.value || 'egyptpost';
  let govData = (window._fullShippingData || []).find(s => s._id === cityId);
  const cityName = govData ? (govData.cityOtherName || govData.city) : cityNameFromSearch;

  if (!name || !phone || !cityName) {
    showToast('الاسم ورقم الهاتف والمدينة مطلوبة', 'error');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'حفظ التغييرات';
    }
    return;
  }

  // Arabic-only name validation
  if (!/^[\u0600-\u06FF\s]+$/.test(name)) {
    showToast('يرجى إدخال اسم العميل باللغة العربية فقط', 'error');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'حفظ التغييرات';
    }
    return;
  }

  // English-only phone validation (digits)
  const phone2 = document.getElementById('modal-c-phone2').value.trim();
  if (!/^[0-9+]+$/.test(phone) || (phone2 && !/^[0-9+]+$/.test(phone2))) {
    showToast('يرجى إدخال رقم الهاتف بالأرقام الإنجليزية فقط', 'error');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'حفظ التغييرات';
    }
    return;
  }

  if (!/^01[0-9]{9}$/.test(phone)) {
    showToast('رقم الهاتف يجب أن يكون 11 رقم ويبدأ بـ 01', 'error');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'حفظ التغييرات';
    }
    return;
  }

  currentOrder.customer.name = name;
  currentOrder.customer.phone = phone;
  currentOrder.customer.secondPhone = document.getElementById('modal-c-phone2').value.trim();
  currentOrder.customer.government = cityName;

  // Determine carrier and override shipping fee using resolveShippingDetails
  const shipDetails = resolveShippingDetails(cityName, carrier);
  currentOrder.carrier = shipDetails.carrier;
  currentOrder.shippingFee = shipDetails.fee;

  currentOrder.customer.address = document.getElementById('modal-c-address').value.trim();
  currentOrder.customer.notes = document.getElementById('modal-c-notes').value.trim();

  renderOrder();
  updateTotals();
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'حفظ التغييرات';
  }
  closeModal('customer-modal');

  // Trigger unsaved changes bar
  if (window.markAsModified) window.markAsModified();
};

window.openPaymentModal = function () {
  document.getElementById('modal-payment-method').value = currentOrder.paymentMethod || 'vodafone_cash';
  document.getElementById('modal-paid-amount').value = currentOrder.paidAmount || '';

  openModal('payment-modal');
};

window.applyPaymentChanges = async function (btn) {
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:8px;display:inline-block;vertical-align:middle;"></span> جارٍ الحفظ...';
  }
  currentOrder.paymentMethod = document.getElementById('modal-payment-method').value;
  currentOrder.paidAmount = parseFloat(document.getElementById('modal-paid-amount').value) || 0;

  renderOrder();
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'حفظ التغييرات';
  }
  closeModal('payment-modal');

  // Save immediately as requested
  await saveOrderChanges(true);

  if (window.hideBar) window.hideBar();
};

window.resendPaymentConfirmationDirect = async function (btn) {
  if (!currentOrder) return;

  const confirmed = await window.showConfirmModal('ارسال تأكيد واتساب', 'هل تريد إرسال تأكيد الطلب/الدفع للعميل الآن؟', true);
  if (!confirmed) return;

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:8px;display:inline-block;vertical-align:middle;"></span> جاري الإرسال...';
  }

  try {
    // This will trigger order.created if paidAmount=0, or order.paid if paidAmount>0
    const success = await api.triggerOrderPaid(currentOrder.orderId, currentOrder);
    if (success) {
      showToast('تم إرسال التأكيد بنجاح');
    } else {
      showToast('فشل إرسال التأكيد', 'error');
    }
  } catch (err) {
    console.error('Resend Error:', err);
    showToast('حدث خطأ أثناء الإرسال', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="display:inline-block; vertical-align:middle;"><path d="M12.012 2c-5.506 0-9.989 4.478-9.99 9.984a9.96 9.96 0 0 0 1.333 4.99L2 22l5.13-1.347a9.92 9.92 0 0 0 4.882 1.28c5.505 0 9.988-4.478 9.99-9.988 0-2.667-1.04-5.176-2.93-7.062C17.182 3.002 14.675 2 12.012 2zm5.733 14.153c-.25.706-1.463 1.298-2.013 1.378-.49.071-.856.326-3.003-.522-2.748-1.085-4.48-3.906-4.617-4.09-.136-.18-.992-1.314-.992-2.51 0-1.196.626-1.782.846-2.023.22-.24.48-.3.64-.3.16 0 .32.003.46.01.144.006.336-.054.528.406.196.47.672 1.637.732 1.758.06.12.1.26.02.42-.08.16-.12.26-.24.4-.12.14-.252.312-.36.42-.12.12-.245.251-.106.49.139.238.618 1.018 1.326 1.649.91.81 1.675 1.06 1.915 1.18.24.12.38.1.52-.06.14-.16.6-1.002.76-1.222.16-.22.32-.18.54-.1.22.08 1.4.66 1.64.78.24.12.4.18.46.28.06.1.06.58-.19 1.286z"/></svg> ارسال';
    }
  }
};

// ── Actions ────────────────────────────────────────────

// ── Drag-and-Drop Reorder ──────────────────────────────
let dragIdx = null;

window.onDragStart = function (e) {
  dragIdx = parseInt(e.currentTarget.dataset.idx);
  e.currentTarget.style.opacity = '0.4';
  e.dataTransfer.effectAllowed = 'move';
};

window.onDragOver = function (e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const card = e.currentTarget;
  card.style.borderTop = '3px solid var(--primary)';
};

window.onDrop = function (e) {
  e.preventDefault();
  const dropIdx = parseInt(e.currentTarget.dataset.idx);
  e.currentTarget.style.borderTop = '';
  if (dragIdx !== null && dragIdx !== dropIdx) {
    const items = currentOrder.items;
    const [moved] = items.splice(dragIdx, 1);
    items.splice(dropIdx, 0, moved);
    renderItems();
    updateTotals();
    if (window.markAsModified) window.markAsModified();
  }
};

window.onDragEnd = function (e) {
  e.currentTarget.style.opacity = '1';
  // Clean up all border highlights
  document.querySelectorAll('.product-card-item').forEach(el => {
    el.style.borderTop = '';
  });
  dragIdx = null;
};

window.moveItem = function (idx, direction) {
  const items = currentOrder.items;
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= items.length) return;
  [items[idx], items[newIdx]] = [items[newIdx], items[idx]];
  renderItems();
  updateTotals();
  if (window.markAsModified) window.markAsModified();
};

window.updateItemQty = function (idx, val) {
  const qty = parseInt(val, 10);
  if (qty >= 1 && currentOrder.items[idx]) {
    currentOrder.items[idx].quantity = qty;
    renderItems();
    syncOrderOffersAndTotals();
    if (window.markAsModified) window.markAsModified();
  }
};

window.promptItemQty = function (idx) {
  const item = currentOrder.items[idx];
  document.getElementById('modal-qty-idx').value = idx;
  document.getElementById('modal-item-qty').value = item.quantity;
  openModal('item-qty-modal');
};

window.applyItemQty = function (btn) {
  const idx = parseInt(document.getElementById('modal-qty-idx').value, 10);
  const qty = parseInt(document.getElementById('modal-item-qty').value, 10);
  if (qty >= 1 && currentOrder.items[idx]) {
    currentOrder.items[idx].quantity = qty;
    renderItems();
    syncOrderOffersAndTotals();
    if (window.markAsModified) window.markAsModified();
  }
  closeModal('item-qty-modal');

  // Refresh ready modal if open
  if (document.getElementById('ready-confirm-modal').style.display === 'flex') {
    markAsReady();
  }
};

window.openItemDiscountModal = function (idx) {
  const item = currentOrder.items[idx];
  document.getElementById('modal-item-idx').value = idx;
  document.getElementById('modal-item-discount').value = item.discount || '';
  if (typeof previewItemDiscount === 'function') previewItemDiscount();
  openModal('item-discount-modal');
};

window.previewItemDiscount = function () {
  const val = parseFloat(document.getElementById('modal-item-discount').value) || 0;
  const preview = document.getElementById('discount-preview');
  
  if (!preview) return;

  if (val === 0 || isNaN(val)) {
    preview.style.display = 'none';
    return;
  }
  
  preview.style.display = 'block';
  if (val > 0) {
    preview.textContent = `خصم: ${val.toLocaleString('ar-EG')} ج.م`;
    preview.style.color = '#dc2626';
  } else {
    preview.textContent = `زياده: ${Math.abs(val).toLocaleString('ar-EG')} ج.م`;
    preview.style.color = '#10b981';
  }
};

window.applyItemDiscount = function (type) {
  const idx = parseInt(document.getElementById('modal-item-idx').value, 10);
  const val = parseFloat(document.getElementById('modal-item-discount').value) || 0;
  const item = currentOrder.items[idx];
  if (item) {
    if (type === 'discount') {
      item.discount = val;
    } else if (type === 'increase') {
      item.discount = -val;
    }
    closeModal('item-discount-modal');
    renderItems();
    syncOrderOffersAndTotals();
    if (window.markAsModified) window.markAsModified();
  }
};

window.removeItem = function (idx) {
  const item = currentOrder.items[idx];
  if (!item) return;

  currentOrder.items.splice(idx, 1);
  renderItems();
  syncOrderOffersAndTotals();
  if (window.markAsModified) window.markAsModified();
};

window.promptOrderDiscount = function () {
  openOrderDiscountModal();
};

window.openOrderDiscountModal = function () {
  openModal('order-discount-modal');
  const input = document.getElementById('modal-order-discount');
  const hint = document.getElementById('modal-order-promo-hint');
  const resetBtn = document.getElementById('modal-btn-reset-promo');

  if (input) {
    input.value = currentOrder.discount ? Math.abs(currentOrder.discount) : '';
  }

  if (hint) {
    if (currentOrder.appliedPromotionName) {
      hint.style.display = 'block';
      hint.innerHTML = `🏷️ العرض المطبق: <strong>${currentOrder.appliedPromotionName}</strong> ${currentOrder.appliedPromotionRewardText ? `(${currentOrder.appliedPromotionRewardText})` : ''} ${currentOrder.isCustomDiscount ? '<br><span style="color:#dc2626;font-size:0.8rem;font-weight:600;">(ملاحظة: تم تطبيق خصم يدوي يتجاوز العرض)</span>' : ''}`;
    } else {
      hint.style.display = 'none';
    }
  }

  if (resetBtn) {
    resetBtn.style.display = currentOrder.isCustomDiscount ? 'block' : 'none';
  }
};

window.applyOrderDiscount = async function (type) {
  if (type === 'reset') {
    currentOrder.isCustomDiscount = false;
    currentOrder.discount = 0;
    closeModal('order-discount-modal');
    await syncOrderOffersAndTotals(true);
    renderOrder();
    if (window.markAsModified) window.markAsModified();
    return;
  }

  const val = document.getElementById('modal-order-discount').value;
  const num = Math.abs(parseFloat(val) || 0);

  if (type === 'increase') {
    currentOrder.discount = -num;
    currentOrder.isCustomDiscount = true;
  } else {
    currentOrder.discount = num;
    currentOrder.isCustomDiscount = (num > 0);
  }

  closeModal('order-discount-modal');
  if (!currentOrder.isCustomDiscount) {
    await syncOrderOffersAndTotals(true);
  } else {
    updateTotals();
  }
  renderOrder();

  if (window.markAsModified) window.markAsModified();

  if (document.getElementById('ready-confirm-modal')?.style.display === 'flex') {
    markAsReady();
  }
};

window.openShippingEditModal = function () {
  openModal('edit-shipping-modal');
  document.getElementById('modal-shipping-fee').value = currentOrder.shippingFee || 0;
};

window.applyShippingFeeChanges = async function (btn) {
  const val = document.getElementById('modal-shipping-fee').value;
  currentOrder.shippingFee = parseFloat(val) || 0;
  currentOrder.isCustomShipping = true;
  updateTotals();
  renderOrder();
  closeModal('edit-shipping-modal');
  if (window.markAsModified) window.markAsModified();
};




window.markFullyPaid = async function (btn) {
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:8px;display:inline-block;vertical-align:middle;"></span> جاري الحفظ...';
  }

  currentOrder.paidAmount = currentOrder.totalPrice;
  currentOrder.paid = true;
  currentOrder.forcePaymentWebhook = true;

  // Instant UI update
  renderOrder();

  try {
    const success = await saveOrderChanges(true);
    if (success) {
      showToast('تم تحديث حالة الدفع إلى مدفوع بالكامل');
    } else {
      if (typeof originalOrder !== 'undefined' && originalOrder) {
        currentOrder = JSON.parse(JSON.stringify(originalOrder));
      }
    }
  } catch (err) {
    console.error('Error marking order fully paid:', err);
    if (typeof originalOrder !== 'undefined' && originalOrder) {
      currentOrder = JSON.parse(JSON.stringify(originalOrder));
    }
    showToast('حدث خطأ أثناء حفظ حالة الدفع', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = 'مدفوع بالكامل';
    }
    renderOrder();
  }
};

// ── Save ───────────────────────────────────────────────

window.saveOrderChanges = async function (silent = false) {
  const btn = document.getElementById('save-all-btn');
  const originalText = btn ? btn.textContent : '';

  if (!silent && btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:8px;display:inline-block;vertical-align:middle;"></span> جارٍ الحفظ...';
  }

  try {
    const updates = {
      items: currentOrder.items.map(item => ({
        ...item,
        selectedOptions: (item.selectedOptions || []).map(opt => ({
          groupName: opt.groupName,
          label: opt.label
        }))
      })),
      subtotal: currentOrder.subtotal,
      discount: currentOrder.discount,
      isCustomDiscount: Boolean(currentOrder.isCustomDiscount),
      isCustomShipping: Boolean(currentOrder.isCustomShipping),
      appliedPromotionName: currentOrder.appliedPromotionName,
      appliedPromotionId: currentOrder.appliedPromotionId,
      appliedPromotionRewards: currentOrder.appliedPromotionRewards || [],
      appliedPromotionRewardText: currentOrder.appliedPromotionRewardText || '',
      shippingFee: currentOrder.shippingFee,
      totalPrice: currentOrder.totalPrice,
      paymentMethod: currentOrder.paymentMethod,
      paidAmount: currentOrder.paidAmount,
      paid: currentOrder.paidAmount >= currentOrder.totalPrice,
      customer: currentOrder.customer,
      forcePaymentWebhook: currentOrder.forcePaymentWebhook,
      updatedAt: currentOrder.updatedAt
    };

    const updatedOrderResponse = await api.updateOrder(currentOrder.orderId, updates);
    currentOrder.forcePaymentWebhook = false; // Reset the flag
    if (updatedOrderResponse && typeof updatedOrderResponse === 'object') {
      Object.assign(currentOrder, updatedOrderResponse);
    }

    if (!silent) {
      showToast('تم حفظ التغييرات بنجاح <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align: middle;"><polyline points="20 6 9 17 4 12"/></svg>');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'حفظ التغييرات';
      }
    } else {
      // For silent saves (like immediate payment updates), we can show a brief success if not handled by caller
      // showToast('تم تحديث البيانات', 'success');
    }

    // Update baseline for discard
    originalOrder = JSON.parse(JSON.stringify(currentOrder));
    renderOrder();
    return true;
  } catch (err) {
    if (err.message === 'conflict' || err.message.includes('conflict') || err.message.includes('تعارض')) {
      await window.showConfirmModal(
        'تنبيه تعارض البيانات',
        'تم تعديل هذا الطلب بالفعل بواسطة مستخدم آخر أو في نافذة أخرى. يجب إعادة تحميل الصفحة للحصول على البيانات الأحدث وتجنب الكتابة فوق التعديلات الأخرى.',
        false
      );
      window.location.reload();
      return false;
    }
    showToast(err.message || 'فشل الحفظ', 'error');
    return false;
  } finally {
    if (!silent && btn) {
      btn.disabled = false;
      btn.textContent = originalText || 'حفظ التغييرات';
    }
  }
};

window.cancelOrder = async function (btn) {
  const confirmed = await window.showConfirmModal('تأكيد الإلغاء', 'هل أنت متأكد من إلغاء هذا الطلب؟ سيتم إرسال إشعار بذلك وتصفير القيم.');
  if (!confirmed) return;

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:8px;display:inline-block;vertical-align:middle;"></span> جارٍ الإلغاء...';
  }

  try {
    await api.cancelOrder(currentOrder.orderId);
    showToast('تم إلغاء الطلب بنجاح');
    setTimeout(() => window.location.reload(), 1000);
  } catch (err) {
    showToast(err.message || 'فشل الإلغاء', 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg> <span>إلغاء الطلب</span>';
    }
  }
};

// ── Modal Products (Persistent Selection) ───────────────
let modalSelectedProducts = new Set(); // Stores product IDs
let modalSelectedVariants = new Map(); // Key: pid-comboStr, Value: {pid, combo, price}

window.openProductsModal = async function () {
  modalSelectedProducts.clear();
  modalSelectedVariants.clear();

  const addBtn = document.getElementById('btn-add-modal-products');
  if (addBtn) {
    addBtn.disabled = false;
    addBtn.innerHTML = 'أضف منتج';
  }

  openModal('products-modal');
  if (Object.keys(collectionsMap).length === 0) {
    try {
      const cols = await api.getCollections();
      const sel = document.getElementById('modal-col-filter');
      cols.forEach(c => {
        collectionsMap[c._id] = c.name;
        sel.add(new Option(c.name, c._id));
      });
    } catch (e) { }
  }

  if (allProducts.length === 0) {
    const listEl = document.getElementById('modal-products-list');
    listEl.innerHTML = '<div style="padding:20px; text-align:center;">جاري تحميل المنتجات...</div>';
    try {
      // Use caching for modal products to load faster
      const res = await api.getProducts(1, 1000, true, '', '', '', '', true);
      if (res) {
        allProducts = Array.isArray(res) ? res : (res.products || []);
      } else {
        allProducts = [];
      }
    } catch (err) {
      console.error('Failed to load products for modal', err);
    }
  }
  renderModalProducts();
};

window.closeProductsModal = function () {
  const addBtn = document.getElementById('btn-add-modal-products');
  if (addBtn) {
    addBtn.disabled = false;
    addBtn.innerHTML = 'أضف منتج';
  }
  closeModal('products-modal');
};

window.handleModalSelect = function (pid, checked) {
  if (checked) modalSelectedProducts.add(pid);
  else modalSelectedProducts.delete(pid);
};

window.handleModalVariantSelect = function (pid, comboStr, price, checked) {
  const key = `${pid}-${comboStr}`;
  if (checked) {
    modalSelectedVariants.set(key, { pid, combo: JSON.parse(decodeURIComponent(comboStr)), price });
  } else {
    modalSelectedVariants.delete(key);
  }
};

window.renderModalProducts = function () {
  const q = document.getElementById('modal-search').value.trim();
  const col = document.getElementById('modal-col-filter').value;
  const listEl = document.getElementById('modal-products-list');

  let filtered = [];
  if (Array.isArray(allProducts)) {
    filtered = allProducts;
  } else if (allProducts && Array.isArray(allProducts.products)) {
    filtered = allProducts.products;
  }

  filtered = filtered.filter(p => p && p.status !== 'draft');

  // Filter by stock
  filtered = filtered.filter(p => {
    if (p.variants && p.variants.length > 0) {
      return p.variants.some(v => v.quantity === null || v.quantity > 0);
    }
    return p.quantity === null || p.quantity > 0;
  });

  if (q) filtered = filtered.filter(p => p && smartMatch(p.name, q));
  if (col) filtered = filtered.filter(p => p && (p.collectionId === col || (p.collectionIds && p.collectionIds.includes(col))));

  if (!Array.isArray(filtered) || !filtered.length) {
    listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)">لا توجد منتجات</div>';
    return;
  }

  listEl.innerHTML = filtered.map(p => {
    const isChecked = modalSelectedProducts.has(p._id);
    const imgUrl = (p.images && p.images.length > 0) ? p.images[0] : (p.imageUrl || '');
    const imgHtml = imgUrl ? `<img src="${imgUrl}" class="pli-img">` : `<div class="pli-img"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle;"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg></div>`;
    const hasOptions = p.options && p.options.length > 0;
    const effectiveBase = (p.salePrice && p.salePrice < p.basePrice) ? p.salePrice : p.basePrice;

    if (!hasOptions) {
      return `
        <div style="width: 100%; display: block;">
          <label class="product-list-item" style="cursor:pointer; display:flex; align-items:center; justify-content:space-between; padding:12px; border-bottom:1px solid var(--border-color); width: 100%; box-sizing: border-box;">
            <div class="pli-info" style="display:flex; align-items:center; gap:20px;">
              ${imgHtml}
              <div>
                <div style="font-weight:600;font-size:0.875rem">${p.name}</div>
                <div style="font-size:0.85rem;color:var(--primary)">${formatPrice(effectiveBase)}</div>
              </div>
            </div>
            <input type="checkbox" class="pli-checkbox product-select-cb" value="${p._id}" 
              ${isChecked ? 'checked' : ''}
              onchange="handleModalSelect('${p._id}', this.checked)"
              style="width:18px;height:18px;accent-color:var(--primary);cursor:pointer;">
          </label>
        </div>
      `;
    }

    let variantsHtml = '';
    const combinations = p.variants && p.variants.length > 0 ? [] : getProductCombinations(p.options);

    if (p.variants && p.variants.length > 0) {
      variantsHtml = p.variants
        .filter(v => v.quantity === null || v.quantity > 0)
        .map((v, idx) => {
          const comboList = Object.entries(v.combination).map(([g, l]) => ({ groupName: g, label: l }));
          const title = comboList.map(c => c.label).join(' / ');
          const finalPrice = (v.salePrice !== null && v.salePrice !== undefined) ? v.salePrice : v.price;
          const comboStr = encodeURIComponent(JSON.stringify(comboList));
          const vKey = `${p._id}-${comboStr}`;
          return `
            <label class="product-variant-item" style="display:flex; align-items:center; justify-content:space-between; padding:12px; border-bottom:1px solid var(--border-color); background:#fafafa; cursor:pointer; padding-right:48px;">
              <div style="display:flex; align-items:center; gap:12px;">
                <div style="font-size:0.9rem;font-weight:500;">${title}</div>
                <div style="font-size:0.85rem;color:var(--primary)">${formatPrice(finalPrice)}</div>
              </div>
              <input type="checkbox" class="pli-checkbox product-variant-cb" 
                data-pid="${p._id}" data-combo="${comboStr}" data-price="${finalPrice}"
                ${modalSelectedVariants.has(vKey) ? 'checked' : ''}
                onchange="handleModalVariantSelect('${p._id}', '${comboStr}', ${finalPrice}, this.checked)">
            </label>
          `;
        }).join('');
    } else {
      variantsHtml = combinations.map((combo, idx) => {
        const title = combo.map(c => c.label).join(' / ');
        const optionsPriceTotal = combo.reduce((sum, c) => sum + (c.price || 0), 0);
        // Matching storefront logic: options prices REPLACE base price if no variants
        const finalPrice = optionsPriceTotal > 0 ? optionsPriceTotal : effectiveBase;
        const comboStr = encodeURIComponent(JSON.stringify(combo));
        const vKey = `${p._id}-${comboStr}`;
        return `
          <label class="product-variant-item" style="display:flex; align-items:center; justify-content:space-between; padding:12px; border-bottom:1px solid var(--border-color); background:#fafafa; cursor:pointer; padding-right:48px;">
            <div style="display:flex; align-items:center; gap:12px;">
              <div style="font-size:0.9rem;font-weight:500;">${title}</div>
              <div style="font-size:0.85rem;color:var(--primary)">${formatPrice(finalPrice)}</div>
            </div>
            <input type="checkbox" class="pli-checkbox product-variant-cb" 
              data-pid="${p._id}" data-combo="${comboStr}" data-price="${finalPrice}"
              ${modalSelectedVariants.has(vKey) ? 'checked' : ''}
              onchange="handleModalVariantSelect('${p._id}', '${comboStr}', ${finalPrice}, this.checked)">
          </label>
        `;
      }).join('');
    }

    return `
      <div>
        <div class="product-list-item" style="display:flex; align-items:center; justify-content:space-between; padding:12px; border-bottom:1px solid var(--border-color); cursor:pointer;" onclick="toggleProductVariants('${p._id}')">
          <div class="pli-info" style="display:flex; align-items:center; gap:12px;">
            ${imgHtml}
            <div style="font-weight:600;font-size:0.95rem">${p.name}</div>
          </div>
          <div id="icon-${p._id}" style="transition:transform 0.2s; color:var(--text-muted); display:flex; align-items:center; justify-content:center; width:32px; height:32px;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
        <div id="variants-${p._id}" style="display:none;">
          ${variantsHtml}
        </div>
      </div>
    `;
  }).join('');
};

window.addSelectedProducts = function (btn) {
  if (modalSelectedProducts.size === 0 && modalSelectedVariants.size === 0) {
    return showToast('اختر منتجاً واحداً على الأقل', 'error');
  }

  const targetBtn = btn || document.getElementById('btn-add-modal-products');
  if (targetBtn) {
    targetBtn.disabled = true;
    targetBtn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:8px;display:inline-block;vertical-align:middle;"></span> جاري الإضافة...';
  }

  try {
    // 1. Add simple products from persistent set
    modalSelectedProducts.forEach(pid => {
      const p = allProducts.find(x => x._id === pid);
      if (p) {
        const effectiveBase = (p.salePrice && p.salePrice < p.basePrice) ? p.salePrice : p.basePrice;
        const existing = currentOrder.items.find(i => i.productId === p._id && (!i.selectedOptions || i.selectedOptions.length === 0));
        if (existing) {
          existing.quantity++;
        } else {
          currentOrder.items.push({
            productId: p._id,
            name: p.name,
            imageUrl: (p.images && p.images.length > 0) ? p.images[0] : (p.imageUrl || ''),
            basePrice: effectiveBase,
            selectedOptions: [],
            quantity: 1,
            discount: 0,
            finalPrice: effectiveBase
          });
        }
      }
    });

    // 2. Add variants from persistent map
    modalSelectedVariants.forEach(v => {
      const p = allProducts.find(x => x._id === v.pid);
      if (p) {
        const variantPrice = v.price;
        const combo = v.combo;
        const existing = currentOrder.items.find(i => {
          if (i.productId !== p._id) return false;
          if (!i.selectedOptions || i.selectedOptions.length !== combo.length) return false;
          return combo.every(c => i.selectedOptions.some(so => so.groupName === c.groupName && so.label === c.label));
        });

        if (existing) {
          existing.quantity++;
        } else {
          let variantImageUrl = '';
          if (p.variants && p.variants.length > 0 && combo && combo.length > 0) {
            const matchingVariant = p.variants.find(varObj => {
              if (!varObj.combination) return false;
              return combo.every(opt => varObj.combination[opt.groupName] === opt.label);
            });
            if (matchingVariant && matchingVariant.imageUrl) {
              variantImageUrl = matchingVariant.imageUrl;
            }
          }

          currentOrder.items.push({
            productId: p._id,
            name: p.name,
            imageUrl: variantImageUrl || ((p.images && p.images.length > 0) ? p.images[0] : (p.imageUrl || '')),
            basePrice: variantPrice,
            selectedOptions: combo,
            quantity: 1,
            discount: 0,
            finalPrice: variantPrice
          });
        }
      }
    });

    renderItems();
    syncOrderOffersAndTotals();
    if (window.markAsModified) window.markAsModified();
    closeProductsModal();
  } catch (err) {
    console.error('Error adding products:', err);
    showToast('حدث خطأ أثناء إضافة المنتجات', 'error');
  } finally {
    if (targetBtn) {
      targetBtn.disabled = false;
      targetBtn.innerHTML = 'أضف منتج';
    }
  }
};

window.toggleDetailsMenu = function (e) {
  e.stopPropagation();
  const menu = document.getElementById('details-menu');
  const isVisible = menu.style.display === 'block';
  menu.style.display = isVisible ? 'none' : 'block';

  if (!isVisible) {
    const hideMenu = () => {
      menu.style.display = 'none';
      document.removeEventListener('click', hideMenu);
    };
    document.addEventListener('click', hideMenu);
  }
};

window.archiveCurrentOrder = async function (btn) {
  const confirmed = await window.showConfirmModal('تأكيد الأرشفة', 'هل أنت متأكد من أرشفة هذا الطلب؟');
  if (!confirmed) return;

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:8px;display:inline-block;vertical-align:middle;"></span> جاري الأرشفة...';
  }

  try {
    document.body.classList.add('is-loading');
    await api.archiveOrders([currentOrder.orderId]);
    showToast('تم أرشفة الطلب بنجاح');
    window.location.href = 'orders';
  } catch (err) {
    showToast(err.message || 'فشل الأرشفة', 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></svg> <span>أرشفة</span>';
    }
  } finally {
    document.body.classList.remove('is-loading');
  }
};

window.deleteCurrentOrder = async function (btn) {
  const confirmed = await window.showConfirmModal('تأكيد الحذف', 'سيتم حذف هذا الطلب نهائياً. هل أنت متأكد؟');
  if (!confirmed) return;

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:8px;display:inline-block;vertical-align:middle;"></span> جاري الحذف...';
  }

  try {
    document.body.classList.add('is-loading');
    await api.deleteOrder(currentOrder.orderId);
    showToast('تم حذف الطلب بنجاح');
    window.location.href = 'orders';
  } catch (err) {
    showToast(err.message || 'فشل الحذف', 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg> <span style="font-weight:600;">حذف نهائي</span>';
    }
  } finally {
    document.body.classList.remove('is-loading');
  }
};

window.markAsReady = function () {
  if (!currentOrder) return;

  const modalItems = document.getElementById('ready-modal-items');
  const orderIdEl = document.getElementById('ready-modal-order-id');
  if (orderIdEl) orderIdEl.textContent = `#${currentOrder.orderId}`;

  // Track fulfillment locally in the modal
  if (!window.fulfillmentState || window.fulfillmentOrderRef !== currentOrder.orderId) {
    window.fulfillmentOrderRef = currentOrder.orderId;
    window.fulfillmentState = currentOrder.items.map(item => ({
      ...item,
      current: 0
    }));
  }

  const renderFulfillmentList = () => {
    modalItems.innerHTML = window.fulfillmentState.map((item, idx) => {
      const imgHtml = item.imageUrl
        ? `<div style="position:relative; width:64px; height:64px;">
             <img src="${item.imageUrl}" style="width:64px; height:64px; border-radius:16px; object-fit:contain; border:1px solid #f1f5f9;" alt="${item.name}">
             <div style="position:absolute; bottom:-4px; right:-4px; background:#fef3c7; color:#d97706; font-size:0.75rem; font-weight:800; padding:2px 8px; border-radius:10px; border:2px solid #fff; box-shadow:0 2px 4px rgba(0,0,0,0.05);">
               ${item.current}/${item.quantity}
             </div>
           </div>`
        : `<div style="position:relative; width:64px; height:64px; border-radius:16px; background:#f8fafc; display:flex; align-items:center; justify-content:center; color:#94a3b8; border:1px solid #f1f5f9;">
             <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
             <div style="position:absolute; bottom:-4px; right:-4px; background:#fef3c7; color:#d97706; font-size:0.75rem; font-weight:800; padding:2px 8px; border-radius:10px; border:2px solid #fff; box-shadow:0 2px 4px rgba(0,0,0,0.05);">
               ${item.current}/${item.quantity}
             </div>
           </div>`;

      const optText = (item.selectedOptions || []).map(op => op.label).join(' / ');

      return `
        <div style="padding: 20px; border-bottom: 1px solid #f1f5f9; display: flex; align-items: center; justify-content: space-between; gap: 16px;">
          <div style="display: flex; gap: 16px; align-items: center; flex: 1;">
            ${imgHtml}
            <div style="text-align: right;">
              <div style="font-weight: 800; color: #1e293b; font-size: 13px;">${item.name}</div>
              ${optText ? `<div style="color: #64748b; font-size: 0.85rem; margin-top: 2px;">${optText}</div>` : ''}
            </div>
          </div>
          
          <div style="display: flex; align-items: center; gap: 8px; background: #f8fafc; padding: 4px; border-radius: 12px; border: 1px solid #f1f5f9;">
            <button onclick="updateFulfillment(${idx}, 1)" style="width: 30px; height: 30px; border-radius: 8px; border: 1px solid #e2e8f0; background: #fff; color: #1e293b; font-size: 1.1rem; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s;">+</button>
            <div style="display: flex; align-items: center; gap: 4px; padding: 0 4px; min-width: 65px; justify-content: center;">
               <span style="font-weight: 800; color: #1e293b; font-size: 0.95rem;">${item.current}</span>
               <span style="color: #94a3b8; font-size: 0.75rem; font-weight: 600;">من ${item.quantity}</span>
            </div>
            <button onclick="updateFulfillment(${idx}, -1)" style="width: 30px; height: 30px; border-radius: 8px; border: 1px solid #e2e8f0; background: #fff; color: #1e293b; font-size: 1.1rem; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s;" ${item.current === 0 ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}>-</button>
          </div>
        </div>
      `;
    }).join('');

    // Check if all items are fulfilled
    const allDone = window.fulfillmentState.every(i => i.current >= i.quantity);
    const updateBtn = document.getElementById('ready-update-btn');
    if (updateBtn) {
      updateBtn.disabled = !allDone;
      updateBtn.style.background = allDone ? '#0f766e' : '#f1f5f9';
      updateBtn.style.color = allDone ? '#fff' : '#94a3b8';
      updateBtn.style.cursor = allDone ? 'pointer' : 'not-allowed';
      updateBtn.onclick = allDone ? confirmMarkAsReady : null;
    }
  };

  window.updateFulfillment = (idx, delta) => {
    const item = window.fulfillmentState[idx];
    const newVal = item.current + delta;
    if (newVal >= 0 && newVal <= item.quantity) {
      item.current = newVal;
      renderFulfillmentList();
    }
  };

  renderFulfillmentList();
  openModal('ready-confirm-modal');
};

window.confirmMarkAsReady = async function (btn) {
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:8px;display:inline-block;vertical-align:middle;"></span> جاري التحديث...';
  }
  try {
    closeModal('ready-confirm-modal');
    document.body.classList.add('is-loading');
    const updated = await api.updateOrder(currentOrder.orderId, { status: 'ready', updatedAt: currentOrder.updatedAt, skipWebhook: true });
    currentOrder = updated;
    if (typeof originalOrder !== 'undefined') originalOrder = JSON.parse(JSON.stringify(updated));
    renderOrder();
    showToast('تم تجهيز الطلب بنجاح', 'success');
    if (window.hideBar) window.hideBar();
  } catch (err) {
    if (err.message === 'conflict' || err.message.includes('conflict') || err.message.includes('تعارض')) {
      await window.showConfirmModal(
        'تنبيه تعارض البيانات',
        'تم تعديل هذا الطلب بالفعل بواسطة مستخدم آخر أو في نافذة أخرى. يجب إعادة تحميل الصفحة للحصول على البيانات الأحدث وتجنب الكتابة فوق التعديلات الأخرى.',
        false
      );
      window.location.reload();
      return;
    }
    showToast('فشل تحديث حالة الطلب', 'error');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'تأكيد التجهيز';
    }
  } finally {
    document.body.classList.remove('is-loading');
  }
};
// printOrderInvoice consolidated at top

let pendingTransferScreenshotFile = null;
let pendingTransferScreenshotRemoved = false;

window.previewAdminTransferScreenshot = function(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  pendingTransferScreenshotFile = file;
  pendingTransferScreenshotRemoved = false;
  
  const reader = new FileReader();
  reader.onload = function(e) {
    document.getElementById('admin-transfer-screenshot-img').src = e.target.result;
    document.getElementById('admin-transfer-screenshot-link').style.display = 'block';
    document.getElementById('admin-transfer-screenshot-remove').style.display = 'block';
  };
  reader.readAsDataURL(file);
};

window.removeAdminTransferScreenshot = function() {
  pendingTransferScreenshotFile = null;
  pendingTransferScreenshotRemoved = true;
  document.getElementById('admin-transfer-screenshot-input').value = '';
  document.getElementById('admin-transfer-screenshot-img').src = '';
  document.getElementById('admin-transfer-screenshot-link').style.display = 'none';
  document.getElementById('admin-transfer-screenshot-remove').style.display = 'none';
};

window.autoSaveTransferInfo = async function() {
  try {
    let screenshotUrl = currentOrder.transferScreenshot;
    
    if (pendingTransferScreenshotRemoved) {
      screenshotUrl = null;
    } else if (pendingTransferScreenshotFile) {
      const formData = new FormData();
      formData.append('image', pendingTransferScreenshotFile);
      if (typeof currentOrder !== 'undefined' && currentOrder && currentOrder.orderId) {
        formData.append('prefix', currentOrder.orderId);
      }
      const uploadRes = await fetch(`${typeof API_BASE !== 'undefined' ? API_BASE : ''}/upload/public`, {
        method: 'POST',
        body: formData
      });
      if (!uploadRes.ok) throw new Error('فشل رفع الصورة');
      const uploadData = await uploadRes.json();
      screenshotUrl = uploadData.url;
    }
    
    const updateRes = await fetch(`${typeof API_BASE !== 'undefined' ? API_BASE : ''}/orders/public/${currentOrder.orderId}/transfer-info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transferNumber: document.getElementById('admin-transfer-number').value,
        transferNotes: document.getElementById('admin-transfer-notes').value,
        transferScreenshot: screenshotUrl
      })
    });
    
    if (!updateRes.ok) throw new Error('فشل حفظ بيانات التحويل');
    
    // Update local state
    currentOrder.transferNumber = document.getElementById('admin-transfer-number').value;
    currentOrder.transferNotes = document.getElementById('admin-transfer-notes').value;
    currentOrder.transferScreenshot = screenshotUrl;
    
    pendingTransferScreenshotFile = null;
    pendingTransferScreenshotRemoved = false;
    
    showToast('تم الحفظ بنجاح', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.saveTransferInfo = async function(btn) {
  return autoSaveTransferInfo();
};

window.cancelReady = async function (btn) {
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:8px;display:inline-block;vertical-align:middle;"></span> جاري التحديث...';
  }
  try {
    document.body.classList.add('is-loading');
    const updated = await api.updateOrder(currentOrder.orderId, { status: 'pending', updatedAt: currentOrder.updatedAt, skipWebhook: true });
    currentOrder = updated;
    if (typeof originalOrder !== 'undefined') originalOrder = JSON.parse(JSON.stringify(updated));
    renderOrder();
    showToast('تم إلغاء تجهيز الطلب بنجاح', 'success');
    if (window.hideBar) window.hideBar();
  } catch (err) {
    showToast('فشل تحديث حالة الطلب', 'error');
  } finally {
    document.body.classList.remove('is-loading');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'إلغاء التجهيز';
    }
  }
};
