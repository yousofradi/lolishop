const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Order = require('../models/Order');
const Promotion = require('../models/Promotion');
const adminAuth = require('../middleware/adminAuth');
const sendWebhook = require('../utils/webhook');
const { sendPushToAdmins } = require('../utils/push');
const { adjustStock } = require('../utils/inventory');
const { createBostaDelivery } = require('../utils/bosta');
const { orderQueue } = require('../utils/queue');
const { generateInvoiceInnerHtml } = require('../utils/invoice');
const { evaluateCartPromotions } = require('./promotions');

function convertArabicDigitsToEnglish(str) {
  if (str === null || str === undefined) return '';
  return str.toString()
    .replace(/[٠-٩]/g, d => String.fromCharCode(d.charCodeAt(0) - 1632 + 48))
    .replace(/[۰-۹]/g, d => String.fromCharCode(d.charCodeAt(0) - 1776 + 48));
}

function normalizeCustomerDigits(cust) {
  if (!cust) return cust;
  if (cust.name) cust.name = convertArabicDigitsToEnglish(cust.name);
  if (cust.phone) cust.phone = convertArabicDigitsToEnglish(cust.phone);
  if (cust.secondPhone) cust.secondPhone = convertArabicDigitsToEnglish(cust.secondPhone);
  if (cust.address) cust.address = convertArabicDigitsToEnglish(cust.address);
  if (cust.notes) cust.notes = convertArabicDigitsToEnglish(cust.notes);
  return cust;
}

// Helper: recalculate totals from items + shipping + discount
function calcTotals(items, shippingFee, orderDiscount = 0) {
  let subtotal = 0;
  for (const item of items) {
    // Standardized Pricing Model: finalPrice is the LINE TOTAL (unit * qty - disc)
    // We try to find the unit price from item.unitPrice, item.price, or item.basePrice
    const unitPrice = Number(item.unitPrice) || Number(item.price) || Number(item.basePrice) || 0;
    const itemDiscount = Number(item.discount) || 0;

    const rowTotal = Math.max(0, (unitPrice * item.quantity) - itemDiscount);
    item.finalPrice = rowTotal; // Store as line total in DB
    subtotal += rowTotal;
  }
  const totalPrice = Math.max(0, subtotal + (Number(shippingFee) || 0) - (Number(orderDiscount) || 0));
  return { subtotal, totalPrice };
}

// Helper: Resolve shipping fee and carrier dynamically from database
async function resolveShippingFeeAndCarrier(customer, inputCarrier, providedShippingFee) {
  let carrier = inputCarrier || '';
  let shippingFee = providedShippingFee !== undefined ? Number(providedShippingFee) : 0;

  try {
    const Setting = require('../models/Setting');
    const shippingOptionsRecord = await Setting.findOne({ key: 'shipping_options' });
    const shippingOptions = (shippingOptionsRecord && Array.isArray(shippingOptionsRecord.value)) ? shippingOptionsRecord.value : [];

    const isCityEqual = (a, b) => {
      if (!a || !b) return false;
      const norm = (s) => s.replace(/[أإآا]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, '').toLowerCase().trim();
      return norm(a) === norm(b);
    };

    const Shipping = require('../models/Shipping');
    const record = await Shipping.findOne({ $or: [{ city: customer.government }, { cityOtherName: customer.government }] });
    const cityName = record ? (record.cityOtherName || record.city) : customer.government;

    // 1. Match carrier option from DB
    const selectedOption = (shippingOptions || []).find(o => 
      o.name === inputCarrier || (inputCarrier && o.name && o.name.toLowerCase().trim() === inputCarrier.toLowerCase().trim())
    ) || (shippingOptions || [])[0];

    if (selectedOption) {
      carrier = selectedOption.name;
    }

    // 2. Resolve fee from DB if not explicitly provided
    if (providedShippingFee === undefined) {
      const cityObj = selectedOption ? (selectedOption.cities || []).find(c =>
        isCityEqual(c.city, cityName) ||
        (record && (isCityEqual(c.city, record.city) || isCityEqual(c.city, record.cityOtherName)))
      ) : null;

      if (cityObj && cityObj.fee !== undefined && !isNaN(Number(cityObj.fee))) {
        shippingFee = Number(cityObj.fee);
      } else if (selectedOption && selectedOption.cost !== undefined && !isNaN(Number(selectedOption.cost))) {
        shippingFee = Number(selectedOption.cost);
      } else if (record && record.fee !== undefined && !isNaN(Number(record.fee))) {
        shippingFee = Number(record.fee);
      }
    }
  } catch (e) {
    console.error('Error resolving shipping fee from DB:', e.message);
  }

  return { shippingFee, carrier };
}


// ── Public ──────────────────────────────────────────────

// POST /api/orders — create order (public from storefront OR admin)
router.post('/', async (req, res) => {
  try {
    const { customer, items, paymentMethod, discount = 0, paidAmount = 0, shippingFee: providedShippingFee, carrier: providedCarrier } = req.body;
    normalizeCustomerDigits(customer);

    if (!customer || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Customer info and at least one item are required' });
    }
    if (!customer.name || !customer.phone || !customer.address || !customer.government) {
      return res.status(400).json({ error: 'Customer name, phone, address, and government are required' });
    }
    if (!paymentMethod) {
      return res.status(400).json({ error: 'Valid payment method is required' });
    }

    // Shipping fee and Carrier resolution (from DB authority):
    let carrier = providedCarrier || '';
    let shippingFee = providedShippingFee !== undefined ? Number(providedShippingFee) : 0;

    try {
      const resolved = await resolveShippingFeeAndCarrier(customer, carrier, providedShippingFee);
      carrier = resolved.carrier || carrier;
      shippingFee = resolved.shippingFee;
    } catch (e) {
      console.error('Error resolving shipping fee in order creation:', e.message);
    }

    if (shippingFee === 0 && !customer.government) {
      return res.status(400).json({ error: `Unknown government: ${customer.government}` });
    }

    // Evaluate promotions server-side to prevent spoofing
    let finalDiscount = discount || 0; // fallback to frontend provided discount (e.g. coupons if we have them)
    let appliedPromotionId = null;
    let appliedPromotionName = null;
    let appliedPromotionRewards = [];
    let appliedPromotionRewardText = '';
    try {
      const promoResult = await evaluateCartPromotions(items);
      
      if (promoResult.appliedPromotion) {
        appliedPromotionId = promoResult.appliedPromotion._id || null;
        appliedPromotionName = promoResult.appliedPromotion.name;
      }
      if (Array.isArray(promoResult.rewardTexts) && promoResult.rewardTexts.length > 0) {
        appliedPromotionRewards = promoResult.rewardTexts;
        appliedPromotionRewardText = promoResult.rewardText || promoResult.rewardTexts.join(' و ');
      }

      // If promotion gives a higher discount, use it
      if (promoResult.totalDiscount > finalDiscount) {
        finalDiscount = promoResult.totalDiscount;
      }
      // If promotion gives free shipping, override shipping fee
      if (promoResult.freeShipping) {
        shippingFee = 0;
      }

      // Validate free gifts in the cart
      for (const item of items) {
        if (item.isFreeGift) {
          let isValidGift = false;
          promoResult.unlockedGifts.forEach(g => {
            if (g.type === 'CHOICE' && g.products.some(p => p.id.toString() === item.productId.toString())) {
              isValidGift = true;
            }
          });
          
          if (isValidGift) {
            item.unitPrice = 0;
            item.price = 0;
            item.basePrice = 0;
            item.discount = 0;
          } else {
            throw new Error(`The free gift "${item.name}" is no longer eligible. Please review your cart.`);
          }
        }
      }
    } catch (e) {
      console.error('Error evaluating promotions during checkout:', e);
      if (e.message.includes('free gift')) {
        return res.status(400).json({ error: e.message });
      }
    }

    const { totalPrice } = calcTotals(items, shippingFee, finalDiscount);

    const Counter = require('../models/Counter');
    const counter = await Counter.findByIdAndUpdate(
      'orderSeq',
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    const generatedOrderId = `Order-${counter.seq}`;

    const order = new Order({
      orderId: generatedOrderId,
      customer,
      items,
      discount: finalDiscount,
      appliedPromotionId,
      appliedPromotionName,
      appliedPromotionRewards,
      appliedPromotionRewardText,
      totalPrice,
      shippingFee,
      paymentMethod,
      carrier,
      paidAmount: Number(paidAmount) || 0,
      paid: (Number(paidAmount) || 0) >= totalPrice,
      paidAt: (Number(paidAmount) || 0) > 0 ? new Date() : undefined,
      processingStatus: 'pending'
    });

    await order.save();


    // Decrease stock
    for (const item of items) {
      try {
        await adjustStock(item.productId, item.selectedOptions, -item.quantity);
      } catch (err) {
        console.error(`[Inventory] Failed to decrease stock for ${item.productId}:`, err.message);
      }
    }


    // 4. Background processing (Notifications, Webhooks, etc.)
    await orderQueue.add('process_new_order', { order: order.toObject() });

    res.status(201).json(order);
  } catch (err) {
    console.error('Order creation error:', err);
    if (err.name === 'ValidationError') return res.status(400).json({ error: err.message });
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// GET /api/orders/public/:orderId — single order (public for storefront)
router.get('/public/:orderId', async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

// POST /api/orders/public/:orderId/transfer-info — public endpoint to update transfer info
router.post('/public/:orderId/transfer-info', async (req, res) => {
  try {
    const { transferNumber, transferNotes, transferScreenshot } = req.body;
    console.log(`Received transfer info for order ${req.params.orderId}:`, req.body);
    
    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    
    if (transferNumber !== undefined) order.transferNumber = transferNumber;
    if (transferScreenshot !== undefined) order.transferScreenshot = transferScreenshot;
    if (transferNotes !== undefined) order.transferNotes = transferNotes;
    
    await order.save();
    console.log(`Saved transfer info for order ${req.params.orderId}`);

    // Trigger webhook and WhatsApp notifications when transfer screenshot is uploaded
    if (transferScreenshot && typeof transferScreenshot === 'string' && transferScreenshot.trim()) {
      sendWebhook('order.created', order.toObject()).catch(err => {
        console.error('Failed to trigger webhook on transfer screenshot upload:', err);
      });
    }

    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update transfer info' });
  }
});

// ── Admin ───────────────────────────────────────────────

// GET /api/orders/bulk/download-pdf — Bulk PDF download using PDFBolt
router.get('/bulk/download-pdf', adminAuth, async (req, res) => {
  try {
    const orders = await Order.find({ archived: { $ne: true }, status: { $ne: 'cancelled' }, paidAmount: { $gt: 0 } }).sort({ createdAt: 1 });
    const Setting = require('../models/Setting');
    const globalSettings = await Setting.findOne({ key: 'loli_global_settings' });
    const settings = globalSettings ? globalSettings.value : {};

    let pagesHtml = '';
    for (const order of orders) {
      const innerHtml = await generateInvoiceInnerHtml(order, settings);
      pagesHtml += `
        <div class="page" style="page-break-after: always;">
          <div class="invoice-wrapper">
            ${innerHtml}
          </div>
        </div>
      `;
    }

    const fullHtml = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@500;600&display=swap');
* { font-family: 'Cairo', sans-serif !important; font-weight: 500; box-sizing: border-box; }
h1, h2, h3, h4, th, strong, b, .notes-title, .footer, .grand, .green, .red, .label-column { font-weight: 600 !important; }
@page { size: A5; margin: 4mm; }
body { margin: 0; padding: 0; }
.page {
  page-break-after: always;
  break-after: page;
  width: 140mm;
  height: 202mm;
  overflow: hidden;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}
.page:last-child { page-break-after: auto; break-after: auto; }
.invoice-wrapper { width: 100%; transform-origin: center center; }

/* USER CSS START */
.invoice { width: 500px; margin: 0 auto; direction: rtl; padding: 10px 5px; }
.customer-table { width: 100%; border-collapse: collapse; border: 1px solid #000; margin-bottom: 7px; }
.customer-table td { border: 1px solid #000; font-size: 10px; font-weight: 600; text-align: center; padding: 4px; }
.label-column { width: 25%; background: #fff; }
.value-column { width: 75%; }
.order-section { border: 1px solid #000; }
.items-table { width: 100%; border-collapse: collapse; }
.items-table thead { background: #f5ede0; }
.items-table th, .items-table td { padding: 6px 6px; font-weight: 600; font-size: 12px; text-align: center; border-bottom: 1px solid #a6a5a5; }
.items-table tbody tr:nth-child(even) { background-color: #f9f6ef; }
.items-table tbody tr:nth-child(odd) { background-color: #ffffff; }
.items-table td:first-child, .items-table th:first-child { text-align: right; }
.summary { background: #f5ede0; padding: 1px 6px; }
.row { display: flex; justify-content: space-between; font-size: 13px; margin: 2px; }
.grand { border-top: 2px solid #4a2c0a; font-weight: 700; margin-top: 4px; padding-top: 4px; }
.paid-box { background: #e8f5ed; padding: 1px 6px; }
.green { color: #1a7a45; font-weight: 700; }
.red { color: #b84a20; font-weight: 700; }
.notes-section { padding: 4px 6px; font-size: 11px; background: #f5ede0; }
.notes-title { font-weight: 700; color: #b84a20; text-decoration: underline; padding-bottom: 2px; }
.footer { background: #4a2c0a; color: #fff; text-align: center; padding: 7px; font-weight: 700; font-size: 13px; }
/* USER CSS END */
</style>
<script>
window.onload = function() {
  document.querySelectorAll('.page').forEach(function(page) {
    var wrapper = page.querySelector('.invoice-wrapper');
    if (!wrapper) return;
    var pageH = page.offsetHeight;
    var pageW = page.offsetWidth;
    var contentH = wrapper.scrollHeight;
    var contentW = wrapper.scrollWidth;
    var scaleH = pageH / contentH;
    var scaleW = pageW / contentW;
    var scale = Math.min(scaleH, scaleW);
    scale = Math.min(Math.max(scale, 0.55), 2.0);
    wrapper.style.transform = 'scale(' + scale + ')';
    wrapper.style.width = (100 / scale) + '%';
  });
};
</script>
</head>
<body>
${pagesHtml}
</body>
</html>`;

    // Call PDFBolt API
    const apiKey = process.env.PDFBOLT_API_KEY;
    if (!apiKey) throw new Error('PDFBOLT_API_KEY is missing');

    const response = await fetch('https://api.pdfbolt.com/v1/direct', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'API-KEY': apiKey
      },
      body: JSON.stringify({
        html: Buffer.from(fullHtml).toString('base64'),
        format: 'A5',
        printBackground: true,
        preferCssPageSize: true
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`PDFBolt Error: ${errText}`);
    }

    const pdfBuffer = await response.arrayBuffer();

    res.setHeader('Content-Type', 'application/pdf');
    const d = new Date();
    const filename = `Invoices_${d.getDate()}-${d.getMonth() + 1}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(pdfBuffer));

  } catch (err) {
    console.error('Bulk PDF Generation Error:', err);
    res.status(500).send('Failed to generate bulk PDF: ' + err.message);
  }
});

router.get('/bulk/invoice-html', adminAuth, async (req, res) => {
  try {
    const orders = await Order.find({ archived: { $ne: true }, status: { $ne: 'cancelled' }, paidAmount: { $gt: 0 } }).sort({ createdAt: -1 });
    const Setting = require('../models/Setting');
    const globalSettings = await Setting.findOne({ key: 'loli_global_settings' });
    const settings = globalSettings ? globalSettings.value : {};

    let pagesHtml = '';
    for (const order of orders) {
      const innerHtml = await generateInvoiceInnerHtml(order, settings, { includeImages: false });
      pagesHtml += `
        <div class="page" style="page-break-after: always; break-after: page;">
          <div class="invoice-wrapper">
            ${innerHtml}
          </div>
        </div>
      `;
    }

    const fullHtml = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@500;600&display=swap');
* { font-family: 'Cairo', sans-serif !important; font-weight: 500; box-sizing: border-box; }
h1, h2, h3, h4, th, strong, b, .notes-title, .footer, .grand, .green, .red, .label-column { font-weight: 600 !important; }
@page { size: A5; margin: 4mm; }
body { margin: 0; padding: 0; }
.page {
  page-break-after: always;
  break-after: page;
  width: 140mm;
  height: 202mm;
  overflow: hidden;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}
.page:last-child { page-break-after: auto; break-after: auto; }
.invoice-wrapper { width: 100%; transform-origin: center center; }

/* USER CSS START */
.invoice { width: 500px; margin: 0 auto; direction: rtl; padding: 10px 5px; }
.customer-table { width: 100%; border-collapse: collapse; border: 1px solid #000; margin-bottom: 7px; }
.customer-table td { border: 1px solid #000; font-size: 10px; font-weight: 600; text-align: center; padding: 4px; }
.label-column { width: 25%; background: #fff; }
.value-column { width: 75%; }
.order-section { border: 1px solid #000; }
.items-table { width: 100%; border-collapse: collapse; }
.items-table thead { background: #f5ede0; }
.items-table th, .items-table td { padding: 6px 6px; font-weight: 600; font-size: 12px; text-align: center; border-bottom: 1px solid #a6a5a5; }
.items-table tbody tr:nth-child(even) { background-color: #f9f6ef; }
.items-table tbody tr:nth-child(odd) { background-color: #ffffff; }
.items-table td:first-child, .items-table th:first-child { text-align: right; }
.summary { background: #f5ede0; padding: 1px 6px; }
.row { display: flex; justify-content: space-between; font-size: 13px; margin: 2px; }
.grand { border-top: 2px solid #4a2c0a; font-weight: 700; margin-top: 4px; padding-top: 4px; }
.paid-box { background: #e8f5ed; padding: 1px 6px; }
.green { color: #1a7a45; font-weight: 700; }
.red { color: #b84a20; font-weight: 700; }
.notes-section { padding: 4px 6px; font-size: 11px; background: #f5ede0; }
.notes-title { font-weight: 700; color: #b84a20; text-decoration: underline; padding-bottom: 2px; }
.footer { background: #4a2c0a; color: #fff; text-align: center; padding: 7px; font-weight: 700; font-size: 13px; }
/* USER CSS END */
</style>
<script>
window.onload = function() {
  document.querySelectorAll('.page').forEach(function(page) {
    var wrapper = page.querySelector('.invoice-wrapper');
    if (!wrapper) return;
    var pageH = page.offsetHeight;
    var pageW = page.offsetWidth;
    var contentH = wrapper.scrollHeight;
    var contentW = wrapper.scrollWidth;
    var scaleH = pageH / contentH;
    var scaleW = pageW / contentW;
    var scale = Math.min(scaleH, scaleW);
    scale = Math.min(Math.max(scale, 0.55), 2.0);
    wrapper.style.transform = 'scale(' + scale + ')';
    wrapper.style.width = (100 / scale) + '%';
  });
};
</script>
</head>
<body>
${pagesHtml}
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(fullHtml);

  } catch (err) {
    console.error('Bulk HTML Generation Error:', err);
    res.status(500).send('Failed to generate bulk HTML: ' + err.message);
  }
});

// GET /api/orders/:orderId/download-image — Download invoice as image using SnapRender
router.get('/:orderId/download-image', adminAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    let query = { orderId: orderId };
    if (mongoose.Types.ObjectId.isValid(orderId)) {
      query = { $or: [{ orderId: orderId }, { _id: orderId }] };
    }

    const order = await Order.findOne(query);
    if (!order) return res.status(404).send('Order not found');

    const Setting = require('../models/Setting');
    const globalSettings = await Setting.findOne({ key: 'loli_global_settings' });
    const settings = globalSettings ? globalSettings.value : {};

    const innerHtml = await generateInvoiceInnerHtml(order, settings);

    const fullHtml = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@500;600&display=swap');
* { font-family: 'Cairo', sans-serif !important; font-weight: 500; box-sizing: border-box; }
h1, h2, h3, h4, th, strong, b, .notes-title, .footer, .grand, .green, .red, .label-column { font-weight: 600 !important; }
html, body { margin: 0; padding: 0; background: #fff; display: inline-block; }
.invoice-container { width: 500px; margin: 0 auto; background: #fff; padding: 10px; }

/* USER CSS START */
.invoice { width: 100%; direction: rtl; padding: 10px 5px; }
.customer-table { width: 100%; border-collapse: collapse; border: 1px solid #000; margin-bottom: 7px; }
.customer-table td { border: 1px solid #000; font-size: 11px; font-weight: 600; text-align: center; padding: 6px; }
.label-column { width: 25%; background: #fff; }
.value-column { width: 75%; }
.order-section { border: 1px solid #000; }
.items-table { width: 100%; border-collapse: collapse; }
.items-table thead { background: #f5ede0; }
.items-table th, .items-table td { padding: 6px 6px; font-weight: 600; font-size: 12px; text-align: center; border-bottom: 1px solid #a6a5a5; }
.items-table td:first-child, .items-table th:first-child { text-align: right; }
.summary { background: #f5ede0; padding: 1px 6px; }
.row { display: flex; justify-content: space-between; font-size: 13px; margin: 2px; }
.grand { border-top: 2px solid #4a2c0a; font-weight: 700; margin-top: 4px; padding-top: 4px; }
.paid-box { background: #e8f5ed; padding: 1px 6px; }
.green { color: #1a7a45; font-weight: 700; }
.red { color: #b84a20; font-weight: 700; }
.notes-section { padding: 4px 6px; font-size: 11px; background: #f5ede0; }
.notes-title { font-weight: 700; color: #b84a20; text-decoration: underline; padding-bottom: 2px; }
.footer { background: #4a2c0a; color: #fff; text-align: center; padding: 7px; font-weight: 700; font-size: 13px; }
/* USER CSS END */
</style>
</head>
<body>
<div class="invoice-container">
  ${innerHtml}
</div>
</body>
</html>`;

    // Call SnapRender API
    const apiKey = process.env.SNAPRENDER_API_KEY;
    if (!apiKey) throw new Error('SNAPRENDER_API_KEY is missing');
    const response = await fetch('https://app.snap-render.com/v1/screenshot', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.SNAPRENDER_API_KEY
      },
      body: JSON.stringify({
        html: fullHtml,
        type: 'png',
        width: 500,
        height: 200,
        full_page: true,
        fullPage: true,
        omitBackground: true,
        selector: '.invoice',
        deviceScaleFactor: 2
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`SnapRender Error: ${errText}`);
    }

    const imageBuffer = await response.arrayBuffer();

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename=invoice-${order.orderId}.png`);
    res.send(Buffer.from(imageBuffer));

  } catch (err) {
    console.error('Image Generation Error:', err);
    res.status(500).send('Failed to generate image invoice: ' + err.message);
  }
});

// Alias for compatibility or if you want to keep the old path
router.get('/:orderId/download-pdf', adminAuth, async (req, res) => {
  res.redirect(`/api/orders/${req.params.orderId}/download-image`);
});

// GET /api/orders/:orderId/invoice — Raw HTML for preview (Native Print)
router.get('/:orderId/invoice', adminAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    let query = { orderId: orderId };
    if (mongoose.Types.ObjectId.isValid(orderId)) {
      query = { $or: [{ orderId: orderId }, { _id: orderId }] };
    }

    const order = await Order.findOne(query);
    if (!order) return res.status(404).send('Order not found');

    const Setting = require('../models/Setting');
    const globalSettings = await Setting.findOne({ key: 'loli_global_settings' });
    const settings = globalSettings ? globalSettings.value : {};

    const innerHtml = await generateInvoiceInnerHtml(order, settings);

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@500;600&display=swap');
* { font-family: 'Cairo', sans-serif !important; font-weight: 500; box-sizing: border-box; }
h1, h2, h3, h4, th, strong, b, .notes-title, .footer, .grand, .green, .red, .label-column { font-weight: 600 !important; }
@page { size: A5; margin: 4mm; }
body { margin: 0; padding: 0; }
.page {
  width: 140mm;
  height: 202mm;
  overflow: hidden;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}
.invoice-wrapper { width: 100%; transform-origin: center center; }

/* USER CSS START */
.invoice { width: 500px; margin: 0 auto; direction: rtl; padding: 10px 5px; }
.customer-table { width: 100%; border-collapse: collapse; border: 1px solid #000; margin-bottom: 7px; }
.customer-table td { border: 1px solid #000; font-size: 10px; font-weight: 600; text-align: center; padding: 4px; }
.label-column { width: 25%; background: #fff; }
.value-column { width: 75%; }
.order-section { border: 1px solid #000; }
.items-table { width: 100%; border-collapse: collapse; }
.items-table thead { background: #f5ede0; }
.items-table th, .items-table td { padding: 6px 6px; font-weight: 600; font-size: 12px; text-align: center; border-bottom: 1px solid #a6a5a5; }
.items-table tbody tr:nth-child(even) { background-color: #f9f6ef; }
.items-table tbody tr:nth-child(odd) { background-color: #ffffff; }
.items-table td:first-child, .items-table th:first-child { text-align: right; }
.summary { background: #f5ede0; padding: 1px 6px; }
.row { display: flex; justify-content: space-between; font-size: 13px; margin: 2px; }
.grand { border-top: 2px solid #4a2c0a; font-weight: 700; margin-top: 4px; padding-top: 4px; }
.paid-box { background: #e8f5ed; padding: 1px 6px; }
.green { color: #1a7a45; font-weight: 700; }
.red { color: #b84a20; font-weight: 700; }
.notes-section { padding: 4px 6px; font-size: 11px; background: #f5ede0; }
.notes-title { font-weight: 700; color: #b84a20; text-decoration: underline; padding-bottom: 2px; }
.footer { background: #4a2c0a; color: #fff; text-align: center; padding: 7px; font-weight: 700; font-size: 13px; }
/* USER CSS END */
</style>
<script>
window.onload = function() {
  var page = document.querySelector('.page');
  var wrapper = document.querySelector('.invoice-wrapper');
  if (!wrapper) return;
  var pageH = page.offsetHeight;
  var pageW = page.offsetWidth;
  var contentH = wrapper.scrollHeight;
  var contentW = wrapper.scrollWidth;
  var scaleH = pageH / contentH;
  var scaleW = pageW / contentW;
  var scale = Math.min(scaleH, scaleW);
  scale = Math.min(Math.max(scale, 0.55), 2.0);
  wrapper.style.transform = 'scale(' + scale + ')';
  wrapper.style.width = (100 / scale) + '%';
};
</script>
</head>
<body>
<div class="page">
  <div class="invoice-wrapper">
    ${innerHtml}
  </div>
</div>
</body>
</html>`;
    res.send(html);
  } catch (err) {
    res.status(500).send('Failed to generate invoice');
  }
});

// GET /api/orders — list all
router.get('/', adminAuth, async (req, res) => {
  try {
    const { archived, page, limit, status, search } = req.query;
    const query = {};
    if (archived === 'true') {
      query.archived = true;
    } else {
      query.archived = { $ne: true };
    }
    
    // Status filters based on UI tabs
    if (status === 'pending') {
      query.status = 'pending';
      query.$or = [{ paid: true }, { paidAmount: { $gt: 0 } }];
    } else if (status === 'ready') {
      query.status = 'ready';
    } else if (status === 'shipped') {
      query.status = 'shipped';
    } else if (status === 'unpaid') {
      query.$or = [{ paid: false }, { paid: { $exists: false } }];
      query.$and = [{ paidAmount: { $eq: 0 } }, { status: { $ne: 'shipped' } }];
    }
    
    // Search
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      const orConditions = [
        { orderId: searchRegex },
        { 'customer.name': searchRegex },
        { 'customer.phone': searchRegex }
      ];
      
      if (query.$or && status !== 'pending') {
        // If there's an existing $or, we need an $and to combine them
        if (query.$and) {
           query.$and.push({ $or: orConditions });
        } else {
           query.$and = [{ $or: query.$or }, { $or: orConditions }];
           delete query.$or;
        }
      } else if (status === 'pending') {
        // 'pending' already uses $or for paid/paidAmount, so use $and
        query.$and = [{ $or: query.$or }, { $or: orConditions }];
        delete query.$or;
      } else {
        query.$or = orConditions;
      }
    }
    
    if (page && limit) {
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 50;
      const skip = (pageNum - 1) * limitNum;
      
      const orders = await Order.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum);
        
      const totalCount = await Order.countDocuments(query);
      const totalPages = Math.ceil(totalCount / limitNum);
      
      res.json({
        orders,
        totalPages,
        totalCount,
        currentPage: pageNum
      });
    } else {
      // Backward compatibility for full fetch
      const orders = await Order.find(query).sort({ createdAt: -1 });
      res.json(orders);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// POST /api/orders/archive/batch — archive multiple orders
router.post('/archive/batch', adminAuth, async (req, res) => {
  try {
    const { orderIds } = req.body;
    if (!Array.isArray(orderIds)) return res.status(400).json({ error: 'orderIds must be an array' });
    await Order.updateMany({ orderId: { $in: orderIds } }, { $set: { archived: true } });
    res.json({ message: 'Orders archived' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to archive orders' });
  }
});

// POST /api/orders/unarchive/batch — unarchive multiple orders
router.post('/unarchive/batch', adminAuth, async (req, res) => {
  try {
    const { orderIds } = req.body;
    if (!Array.isArray(orderIds)) return res.status(400).json({ error: 'orderIds must be an array' });
    await Order.updateMany({ orderId: { $in: orderIds } }, { $set: { archived: false } });
    res.json({ message: 'Orders unarchived' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to unarchive orders' });
  }
});

// POST /api/orders/activate/batch — activate multiple orders
router.post('/activate/batch', adminAuth, async (req, res) => {
  try {
    const { orderIds } = req.body;
    if (!Array.isArray(orderIds)) return res.status(400).json({ error: 'orderIds must be an array' });

    // Deduct stock for each order before activating (re-reserving stock)
    for (const id of orderIds) {
      const order = await Order.findOne({ orderId: id });
      if (order && order.status === 'cancelled') {
        for (const item of order.items) {
          await adjustStock(item.productId, item.selectedOptions, -item.quantity);
        }
      }
    }

    await Order.updateMany({ orderId: { $in: orderIds }, status: 'cancelled' }, { $set: { status: 'pending' } });

    res.json({ message: 'Orders activated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to activate orders' });
  }
});

// POST /api/orders/cancel/batch — cancel multiple orders
router.post('/cancel/batch', adminAuth, async (req, res) => {
  try {
    const { orderIds } = req.body;
    if (!Array.isArray(orderIds)) return res.status(400).json({ error: 'orderIds must be an array' });

    // Restore stock for each order before cancelling
    for (const id of orderIds) {
      const order = await Order.findOne({ orderId: id });
      if (order && order.status !== 'cancelled') {
        for (const item of order.items) {
          await adjustStock(item.productId, item.selectedOptions, item.quantity);
        }
      }
    }

    await Order.updateMany({ orderId: { $in: orderIds } }, { $set: { status: 'cancelled' } });

    // Trigger webhooks for each cancelled order
    res.json({ message: 'Orders cancelled successfully' });

    // Background notifications
    (async () => {
      for (const id of orderIds) {
        try {
          const order = await Order.findOne({ orderId: id });
          if (order) {
            await sendWebhook('order.cancelled', order.toObject());
          }
        } catch (whErr) {
          console.error(`[Webhook] Cancel background fail for ${id}:`, whErr.message);
        }
      }
    })();
  } catch (err) {
    res.status(500).json({ error: 'Failed to cancel orders' });
  }
});

// POST /api/orders/delete/batch — delete multiple orders
router.post('/delete/batch', adminAuth, async (req, res) => {
  try {
    const { orderIds } = req.body;
    if (!Array.isArray(orderIds)) return res.status(400).json({ error: 'orderIds must be an array' });

    // Restore stock for each order before deleting
    for (const id of orderIds) {
      const order = await Order.findOne({ orderId: id });
      if (order && order.status !== 'cancelled') {
        for (const item of order.items) {
          await adjustStock(item.productId, item.selectedOptions, item.quantity);
        }
      }
    }

    await Order.deleteMany({ orderId: { $in: orderIds } });

    res.json({ message: 'Orders deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete orders' });
  }
});

// POST /api/orders/:orderId/cancel — cancel single order
router.post('/:orderId/cancel', adminAuth, async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (order.status !== 'cancelled') {
      // Restore stock
      for (const item of order.items) {
        await adjustStock(item.productId, item.selectedOptions, item.quantity);
      }
      order.status = 'cancelled';
      await order.save();
      res.json({ message: 'Order cancelled', order });

      // Background notification
      (async () => {
        try {
          await sendWebhook('order.cancelled', order.toObject());
        } catch (whErr) {
          console.error('[Webhook] Cancel background fail:', whErr.message);
        }
      })();
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to cancel order' });
  }
});

// POST /api/orders/ship/batch — mark multiple orders as shipped
router.post('/ship/batch', adminAuth, async (req, res) => {
  try {
    const { orderIds } = req.body;
    if (!Array.isArray(orderIds)) return res.status(400).json({ error: 'orderIds must be an array' });

    await Order.updateMany({ orderId: { $in: orderIds }, status: { $ne: 'cancelled' } }, { $set: { status: 'shipped' } });
    res.json({ message: 'Orders marked as shipped' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark orders as shipped' });
  }
});

// POST /api/orders/unship/batch — unmark multiple orders as shipped (revert to ready or pending)
router.post('/unship/batch', adminAuth, async (req, res) => {
  try {
    const { orderIds } = req.body;
    if (!Array.isArray(orderIds)) return res.status(400).json({ error: 'orderIds must be an array' });

    await Order.updateMany({ orderId: { $in: orderIds }, status: 'shipped' }, { $set: { status: 'ready' } });
    res.json({ message: 'Orders unshipped' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to unship orders' });
  }
});

// POST /api/orders/bulk/ship — ship multiple orders via Bosta Bulk API
router.post('/bulk/ship', adminAuth, async (req, res) => {
  try {
    const { orderIds } = req.body;
    if (!Array.isArray(orderIds)) return res.status(400).json({ error: 'orderIds must be an array' });

    const orders = await Order.find({
      orderId: { $in: orderIds },
      status: 'ready',
      bostaDeliveryId: { $exists: false },
      carrier: { $ne: 'egyptpost' }
    });
    if (!orders.length) return res.json({ message: 'No eligible orders to ship (Egyptpost orders are excluded)', count: 0 });

    const { createBulkBostaDeliveries } = require('../utils/bosta');
    const result = await createBulkBostaDeliveries(orders);

    // Bosta returns results in the same order as the input deliveries
    // Support both { deliveries: [] } and direct array [ ... ]
    let successCount = 0;
    const deliveries = Array.isArray(result) ? result : (result.deliveries || []);

    if (deliveries && deliveries.length > 0) {
      for (let i = 0; i < orders.length; i++) {
        // Find matching response by businessReference (orderId) or by index
        const bostaRes = deliveries[i];
        if (bostaRes && (bostaRes._id || bostaRes.id)) {
          const deliveryId = bostaRes._id || bostaRes.id;
          await Order.updateOne({ _id: orders[i]._id }, {
            $set: {
              bostaDeliveryId: deliveryId,
              bostaTrackingNumber: bostaRes.trackingNumber
            }
          });
          successCount++;
        }
      }
    }

    res.json({ message: 'تم شحن الطلبات بنجاح', count: successCount });
  } catch (err) {
    console.error('Bulk ship error:', err);
    res.status(500).json({ error: 'Failed to ship orders bulk: ' + err.message });
  }
});

// GET /api/orders/:orderId/promotion — applied promotion display info
router.get('/:orderId/promotion', adminAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    let query = { orderId: orderId };
    if (mongoose.Types.ObjectId.isValid(orderId)) {
      query = { $or: [{ orderId: orderId }, { _id: orderId }] };
    }
    const order = await Order.findOne(query);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    let rewardText = '';
    let promotion = null;
    let rewardParts = [];
    if (order.appliedPromotionId || order.appliedPromotionName) {
      if (order.appliedPromotionId) {
        promotion = await Promotion.findById(order.appliedPromotionId).lean();
      }
      if (!promotion && order.appliedPromotionName) {
        promotion = await Promotion.findOne({ name: order.appliedPromotionName }).lean();
      }
      if (promotion) {
        if (promotion.discountType === 'PERCENTAGE') rewardParts.push(`خصم ${promotion.discountValue}%`);
        if (promotion.discountType === 'FIXED') rewardParts.push(`خصم ${promotion.discountValue} ج`);
        if (promotion.isFreeShipping) rewardParts.push('شحن مجاني');
        if (promotion.isFreeGift) rewardParts.push('هدية مجانية');
        rewardText = rewardParts.filter(Boolean).join(' و ');
      }
    }

    if (!rewardText) {
      rewardText = order.appliedPromotionRewardText || (Array.isArray(order.appliedPromotionRewards) ? order.appliedPromotionRewards.filter(Boolean).join(' و ') : '');
    }
    const promotionLine = [order.appliedPromotionName, rewardText].filter(Boolean).join(' : ');

    const finalRewards = (Array.isArray(order.appliedPromotionRewards) && order.appliedPromotionRewards.length > 0)
      ? order.appliedPromotionRewards
      : rewardParts;

    res.json({
      appliedPromotionId: order.appliedPromotionId,
      appliedPromotionName: order.appliedPromotionName,
      rewardText,
      appliedPromotionRewards: finalRewards || [],
      promotion,
      promotionLine
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch order promotion info' });
  }
});

// GET /api/orders/:orderId — single order (GREEDY ROUTE - MUST BE AT BOTTOM)
router.get('/:orderId', adminAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    let query = { orderId: orderId };
    if (mongoose.Types.ObjectId.isValid(orderId)) {
      query = { $or: [{ orderId: orderId }, { _id: orderId }] };
    }
    const order = await Order.findOne(query);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

// PUT /api/orders/:orderId — edit order details
router.put('/:orderId', adminAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const updates = req.body;

    let query = { orderId: orderId };
    if (mongoose.Types.ObjectId.isValid(orderId)) {
      query = { $or: [{ orderId: orderId }, { _id: orderId }] };
    }

    const order = await Order.findOne(query);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Special action: Resend / Force trigger payment & created webhooks only (when no order update is requested)
    const isWebhookOnly = updates.forcePaymentWebhook && !updates.items && updates.paidAmount === undefined && !updates.customer && !updates.status;
    if (isWebhookOnly) {
      const event = (order.paidAmount > 0) ? 'order.paid' : 'order.created';
      console.log(`[Webhook] Force triggering webhooks and WhatsApp for ${event} - order ${order.orderId}`);
      sendWebhook(event, order.toObject()).catch(err => {
        console.error('[Webhook] Background trigger failed:', err.message);
      });
      return res.json(order);
    }

    // 1. Concurrency Check (Optimistic Locking)
    if (updates.updatedAt) {
      const incomingTime = new Date(updates.updatedAt).getTime();
      const existingTime = new Date(order.updatedAt).getTime();
      // Allow 1 second clock drift / precision leeway
      if (existingTime - incomingTime > 1000) {
        return res.status(409).json({ 
          error: 'conflict', 
          message: 'تم تعديل هذا الطلب بالفعل بواسطة مستخدم آخر. يرجى تحديث الصفحة للحصول على أحدث البيانات.' 
        });
      }
      delete updates.updatedAt;
    }

    // Handle stock adjustment only for actual difference between old and new items if order is not cancelled
    if (updates.items && order.status !== 'cancelled') {
      const getItemKey = (item) => {
        const prodId = String(item.productId || '');
        const opts = (item.selectedOptions || [])
          .map(o => `${(o.groupName || '').trim().toLowerCase()}:${(o.label || '').trim().toLowerCase()}`)
          .sort()
          .join('|');
        return `${prodId}__${opts}`;
      };

      const oldMap = new Map();
      for (const item of (order.items || [])) {
        const key = getItemKey(item);
        const existing = oldMap.get(key) || { item, quantity: 0 };
        existing.quantity += Number(item.quantity) || 0;
        oldMap.set(key, existing);
      }

      const newMap = new Map();
      for (const item of (updates.items || [])) {
        const key = getItemKey(item);
        const existing = newMap.get(key) || { item, quantity: 0 };
        existing.quantity += Number(item.quantity) || 0;
        newMap.set(key, existing);
      }

      const allKeys = new Set([...oldMap.keys(), ...newMap.keys()]);
      for (const key of allKeys) {
        const oldEntry = oldMap.get(key);
        const newEntry = newMap.get(key);
        const oldQty = oldEntry ? oldEntry.quantity : 0;
        const newQty = newEntry ? newEntry.quantity : 0;
        const diff = newQty - oldQty;

        if (diff !== 0) {
          const sampleItem = (newEntry && newEntry.item) || (oldEntry && oldEntry.item);
          // diff > 0 means items were added, so deduct from stock (-diff)
          // diff < 0 means items were removed, so restore to stock (-diff is positive)
          await adjustStock(sampleItem.productId, sampleItem.selectedOptions, -diff);
        }
      }
    }

    // Recalculate totals if items, shipping, or discount changed
    const items = updates.items || order.items;
    let shippingFee = (updates.shippingFee !== undefined) ? updates.shippingFee : order.shippingFee;
    let discount = (updates.discount !== undefined) ? updates.discount : order.discount;

    let appliedPromotionId = (updates.appliedPromotionId !== undefined) ? updates.appliedPromotionId : (order.appliedPromotionId || null);
    let appliedPromotionName = (updates.appliedPromotionName !== undefined) ? updates.appliedPromotionName : (order.appliedPromotionName || null);
    let appliedPromotionRewards = (updates.appliedPromotionRewards !== undefined) ? updates.appliedPromotionRewards : (order.appliedPromotionRewards || []);
    let appliedPromotionRewardText = (updates.appliedPromotionRewardText !== undefined) ? updates.appliedPromotionRewardText : (order.appliedPromotionRewardText || '');

    // Check if the discount is explicitly marked as custom or changed by admin
    let isCustomDiscount;
    if (updates.isCustomDiscount !== undefined) {
      isCustomDiscount = Boolean(updates.isCustomDiscount);
    } else if (updates.discount !== undefined && updates.discount !== order.discount) {
      isCustomDiscount = true;
    } else {
      isCustomDiscount = Boolean(order.isCustomDiscount);
    }

    const isCustomShipping = updates.isCustomShipping !== undefined ? Boolean(updates.isCustomShipping) : Boolean(order.isCustomShipping);

    // Evaluate promotions if items changed
    if (updates.items) {
      try {
        const promoResult = await evaluateCartPromotions(items);

        if (promoResult.appliedPromotion) {
          appliedPromotionId = promoResult.appliedPromotion._id || null;
          appliedPromotionName = promoResult.appliedPromotion.name;
          appliedPromotionRewards = promoResult.rewardTexts || [];
          appliedPromotionRewardText = promoResult.rewardText || (promoResult.rewardTexts ? promoResult.rewardTexts.join(' و ') : '');

          if (!isCustomDiscount) {
            discount = promoResult.totalDiscount || 0;
          }

          if (promoResult.freeShipping) {
            if (!isCustomShipping) {
              shippingFee = 0;
            }
          } else {
            if (order.appliedPromotionName && order.shippingFee === 0 && !isCustomShipping && (updates.shippingFee === undefined || updates.shippingFee === 0)) {
              const resolved = await resolveShippingFeeAndCarrier(updates.customer || order.customer, updates.carrier || order.carrier, undefined);
              shippingFee = resolved.shippingFee;
            }
          }
        } else {
          // No promotion qualified
          if (!isCustomDiscount) {
            appliedPromotionId = null;
            appliedPromotionName = null;
            appliedPromotionRewards = [];
            appliedPromotionRewardText = '';
            discount = 0;
          }
          if (order.appliedPromotionName && order.shippingFee === 0 && !isCustomShipping && (updates.shippingFee === undefined || updates.shippingFee === 0)) {
            const resolved = await resolveShippingFeeAndCarrier(updates.customer || order.customer, updates.carrier || order.carrier, undefined);
            shippingFee = resolved.shippingFee;
          }
        }
      } catch (promoErr) {
        console.error('Error evaluating promotions on update:', promoErr);
      }
    } else {
      if (isCustomDiscount && !appliedPromotionName) {
        appliedPromotionId = null;
        appliedPromotionName = null;
      }
    }

    updates.isCustomDiscount = isCustomDiscount;
    updates.isCustomShipping = isCustomShipping;
    updates.appliedPromotionId = appliedPromotionId;
    updates.appliedPromotionName = appliedPromotionName;
    updates.appliedPromotionRewards = appliedPromotionRewards;
    updates.appliedPromotionRewardText = appliedPromotionRewardText;
    updates.discount = discount;
    updates.shippingFee = shippingFee;

    const { subtotal, totalPrice } = calcTotals(items, shippingFee, discount);
    updates.subtotal = subtotal;
    updates.totalPrice = totalPrice;
    
    const newPaidAmount = updates.paidAmount !== undefined ? updates.paidAmount : order.paidAmount;
    updates.paid = (Number(newPaidAmount) >= totalPrice);
    
    if (!order.paidAt && (Number(newPaidAmount) > 0 || updates.paid)) {
      updates.paidAt = new Date();
    }

    const updatedOrder = await Order.findOneAndUpdate(query, { $set: updates }, { new: true, runValidators: true });
    res.json(updatedOrder);

    // 4. Trigger Webhooks (WhatsApp, etc.) - Background
    if (updatedOrder) {
      (async () => {
        try {
          const event = (updatedOrder.paidAmount > 0) ? 'order.paid' : 'order.created';
          const isNewlyPaid = !order.paid && updatedOrder.paid;

          if (updates.forcePaymentWebhook) {
            console.log(`[Webhook] Force triggering webhooks and WhatsApp for ${event} - order ${updatedOrder.orderId}`);
            await sendWebhook(event, updatedOrder.toObject());
          } else {
            // Normal update: Always send HTTP Webhook for the update unless skipped
            // Also if it just became paid, trigger the order.paid event for both WhatsApp and Webhook
            if (!updates.skipWebhook) {
              console.log(`[Webhook] Triggering update webhook for order ${updatedOrder.orderId}`);
              await sendWebhook('order.updated', updatedOrder.toObject(), { webhookOnly: true });
            } else {
              console.log(`[Webhook] Skipped update webhook for order ${updatedOrder.orderId} due to skipWebhook flag`);
            }

            if (isNewlyPaid) {
              console.log(`[Webhook] Triggering order.paid for order ${updatedOrder.orderId}`);
              await sendWebhook('order.paid', updatedOrder.toObject());
            }
          }
        } catch (whErr) {
          console.error('[Webhook] Background trigger failed:', whErr.message);
        }
      })();
    }
  } catch (err) {
    console.error('Order update error:', err);
    res.status(500).json({ error: 'Failed to update order' });
  }
});

// DELETE /api/orders/:orderId — delete order
router.delete('/:orderId', adminAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    let query = { orderId: orderId };
    if (mongoose.Types.ObjectId.isValid(orderId)) {
      query = { $or: [{ orderId: orderId }, { _id: orderId }] };
    }
    const order = await Order.findOne(query);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (order.status !== 'cancelled') {
      // Restore stock
      for (const item of order.items) {
        await adjustStock(item.productId, item.selectedOptions, item.quantity);
      }
    }

    await Order.deleteOne(query);
    res.json({ message: 'Order deleted' });

  } catch (err) {
    res.status(500).json({ error: 'Failed to delete order' });
  }
});

module.exports = router;
