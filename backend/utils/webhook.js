/**
 * Webhook utility — sends POST to WEBHOOK_URL.
 * Fire-and-forget: logs errors but never blocks the response.
 */
const Webhook = require('../models/Webhook');
const cityMap = require('./cityMap');

const helpers = {
  async httpRequest({ method, url, qs, body, headers, timeout }) {
    try {
      const queryString = qs ? '?' + new URLSearchParams(qs).toString() : '';
      const res = await fetch(url + queryString, {
        method: method || 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          ...headers
        },
        body: body || undefined,
        signal: AbortSignal.timeout(timeout || 10000)
      });
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      return await res.text();
    } catch (err) {
      console.warn('[helpers.httpRequest] Error:', err.message);
      return null;
    }
  }
};

async function sendWebhook(event, data, options = {}) {
  const context = { helpers };
  return sendWebhookInner.call(context, event, data, options);
}

async function sendWebhookInner(event, data, options = {}) {
  try {
    const skipHttp = options.whatsappOnly === true;
    const skipWa = options.webhookOnly === true;

    const hasTransferScreenshot = !!(data.transferScreenshot && typeof data.transferScreenshot === 'string' && data.transferScreenshot.trim());
    const messageLabel = (event === 'order.paid')
      ? 'الفاتورة'
      : (hasTransferScreenshot ? 'رسالة التحويل' : 'تفاصيل الطلب');

    let customerDeliveryStatus = {
      attempted: false,
      sent: false,
      phone: '',
      label: messageLabel,
      statusText: ''
    };

    // Shared WhatsApp variables and helper definitions
    let cachedInvoiceMedia = null;
    let triedInvoiceGeneration = false;
    let getInvoiceMedia = async () => null;
    let fallbackSentToMerchant = false;

    // ── Phase 1: WhatsApp Customer Notification (Executed first to determine delivery status) ──
    if (!skipWa) {
      try {
        const Setting = require('../models/Setting');
        const { generateInvoiceInnerHtml } = require('./invoice');

        const waConfigSetting = await Setting.findOne({ key: 'whatsapp_configs' });
        const globalSettings = await Setting.findOne({ key: 'loli_global_settings' });
        const settings = globalSettings ? globalSettings.value : {};
        const brandName = settings.storeNameAr || settings.storeName || 'متجرنا';

        if (waConfigSetting && Array.isArray(waConfigSetting.value)) {
          const configs = waConfigSetting.value;

          // Helper to format WhatsApp phone numbers (Egypt)
          const formatWaNumber = (raw) => {
            if (!raw) return '';
            let clean = String(raw).replace(/\D/g, '').replace(/^0+/, '');
            if (!clean) return '';
            if (!clean.startsWith('20')) clean = '20' + clean;
            return clean;
          };

          // Helper to send WhatsApp messages via Evolution API
          const sendWaMessage = async (cleanBaseUrl, instance, apikey, targetNumber, messageText, mediaBase64, orderId) => {
            const waPayload = {
              number: targetNumber,
              delay: 1,
              linkPreview: false,
              mentionsEveryOne: false
            };

            let finalWaUrl = '';
            if (mediaBase64) {
              finalWaUrl = `${cleanBaseUrl}/message/sendMedia/${instance}`;
              waPayload.mediatype = 'image';
              waPayload.mediaType = 'image';
              waPayload.mimetype = 'image/png';
              waPayload.caption = messageText;
              waPayload.media = mediaBase64.replace(/\s/g, '');
              waPayload.fileName = `invoice-${orderId}.png`;
            } else {
              finalWaUrl = `${cleanBaseUrl}/message/sendText/${instance}`;
              waPayload.text = messageText;
            }

            console.log(`[WhatsApp] Sending to ${finalWaUrl} (target: ${targetNumber})`);
            const res = await fetch(finalWaUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'apikey': apikey
              },
              body: JSON.stringify(waPayload),
              signal: AbortSignal.timeout(15000)
            });

            const rawText = await res.text();
            let json = null;
            try {
              json = JSON.parse(rawText);
            } catch (e) { }

            // Fallback: If sendMedia failed but NOT because number is missing from WhatsApp, retry with sendText
            if (!res.ok && mediaBase64) {
              const isNoWa = res.status === 400 && (rawText.includes('"exists":false') || rawText.includes('"exists": false'));
              if (!isNoWa) {
                console.warn(`[WhatsApp] sendMedia failed (${res.status}), trying sendText fallback for ${targetNumber}...`);
                try {
                  const textRes = await fetch(`${cleanBaseUrl}/message/sendText/${instance}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': apikey },
                    body: JSON.stringify({ number: targetNumber, delay: 1, text: messageText }),
                    signal: AbortSignal.timeout(15000)
                  });
                  const textRaw = await textRes.text();
                  let textJson = null;
                  try { textJson = JSON.parse(textRaw); } catch (e) { }
                  if (textRes.ok) {
                    return { ok: true, status: textRes.status, json: textJson, text: textRaw };
                  }
                } catch (textErr) {
                  console.warn('[WhatsApp] sendText fallback error:', textErr.message);
                }
              }
            }

            return { ok: res.ok, status: res.status, json, text: rawText };
          };

          // Cache invoice media generation across configs (for order.paid)
          getInvoiceMedia = async () => {
            if (triedInvoiceGeneration) return cachedInvoiceMedia;
            triedInvoiceGeneration = true;
            if (event !== 'order.paid') return null;
            try {
              const innerHtml = await generateInvoiceInnerHtml(data, settings, { includeImages: true });
              const fullHtml = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@500;600&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    width: 500px;
    background: #ffffff;
    font-family: 'Cairo', Arial, sans-serif !important;
    font-weight: 500;
    display: inline-block;
  }
  h1, h2, h3, h4, th, strong, b, .notes-title, .footer, .grand, .green, .red, .label-column { font-weight: 600 !important; }
  .invoice {
    width: 500px;
    margin: 0;
    direction: rtl;
    padding: 10px 5px;
    height: fit-content;
  }
  .customer-table { width: 100%; border-collapse: collapse; border: 1px solid #000; margin-bottom: 7px; }
  .customer-table td { border: 1px solid #000; font-size: 10px; font-weight: 600; text-align: center; padding: 4px; }
  .label-column { width: 25%; }
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
</style>
</head>
<body>${innerHtml}</body>
</html>`;

              const RENDER_API_URL = 'https://invoice-api-wybe.onrender.com/api/render';

              const renderRes = await fetch(RENDER_API_URL, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  html: fullHtml,
                  width: 500,
                  height: 200,
                  fullPage: true,
                  omitBackground: true,
                  selector: '.invoice',
                  deviceScaleFactor: 2
                }),
                signal: AbortSignal.timeout(30000)
              });

              if (renderRes.ok) {
                const buffer = await renderRes.arrayBuffer();
                cachedInvoiceMedia = Buffer.from(buffer).toString('base64');
              } else {
                const errorData = await renderRes.text();
                console.warn('[WhatsApp] Render API Rendering failed:', errorData);
              }
            } catch (err) {
              console.error('[WhatsApp] Image generation error:', err.message);
            }
            return cachedInvoiceMedia;
          };

          // Calculate amounts
          const baseRemaining = (data.totalPrice || 0) - (data.paidAmount || 0);
          let codFee = 0;
          if (baseRemaining > 0) {
            codFee = Math.max(10, Math.ceil((baseRemaining * 0.01) / 5) * 5);
          }
          const displayRemaining = baseRemaining > 0 ? (baseRemaining + codFee) : 0;
          const remainingText = baseRemaining > 0 ? `الدفع عند الاستلام : ${displayRemaining} EGP` : `مدفوع بالكامل`;

          // Prepare Customer Message
          let customerMessage = '';
          if (event === 'order.created') {
            if (hasTransferScreenshot) {
              customerMessage = `مرحباً ${data.customer.name}

رقم الطلب: ${data.orderId}
إجمالي المبلغ: ${data.totalPrice} EGP
جاري مراجعة الطلب وهنبعتلك الفاتورة اول ميتأكد 

شكراً لثقتك بنا ♡`;
            } else {
              const selectedPaymentMethod = (settings.paymentMethods || []).find(m => m.label === data.paymentMethod);
              const paymentNumber = selectedPaymentMethod ? selectedPaymentMethod.number : '';

              const normPayment = `${data.paymentMethod || ''} ${selectedPaymentMethod?.label || ''} ${selectedPaymentMethod?.id || ''}`
                .toLowerCase()
                .replace(/[أإآ]/g, 'ا');

              let accountHolder = '';
              if (normPayment.includes('انستا') || normPayment.includes('insta')) {
                accountHolder = 'دينا علي  (دينا ع** م*** ا****** ق**** )';
              } else if (normPayment.includes('فودافون') || normPayment.includes('vodafone')) {
                accountHolder = 'دينا علي محمد  \n(Dina A**  M******)';
              }

              customerMessage = `مرحباً ${data.customer.name}

رقم الطلب: ${data.orderId}
إجمالي المبلغ: ${data.totalPrice} EGP
طريقة الدفع: ${data.paymentMethod}${paymentNumber ? `\nرقم الدفع: ${paymentNumber}` : ''}${accountHolder ? `\nب اسم : ${accountHolder}` : ''}

${settings.paymentNotes || ''}

شكراً لثقتك بنا ♡`;
            }
          } else {
            customerMessage = `شكراً لشرائك من متجر ${brandName} ♡

رقم الأوردر : ${data.orderId} 
اسم العميل : ${data.customer.name} 
المبلغ الاجمالي : ${data.totalPrice} EGP
تم الدفع : ${data.paidAmount || 0} EGP
${remainingText}

شكراً لثقتك بنا ♡`;
          }

          // Generate WhatsApp Link for the customer
          let cleanCustomerPhone = formatWaNumber(data.customer?.phone);
          const whatsappLink = `https://api.whatsapp.com/send?phone=${cleanCustomerPhone}&text=${encodeURIComponent(customerMessage)}`;

          // Shorten the Link using URL shortener
          let shortLink = whatsappLink;
          try {
            const shortenerUrl = process.env.URL_SHORTENER_URL || 'https://url.sundura.workers.dev/api/shorten';
            const shortenRes = await fetch(shortenerUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: whatsappLink }),
              signal: AbortSignal.timeout(8000)
            });
            if (shortenRes.ok) {
              const shortenData = await shortenRes.json();
              if (shortenData && shortenData.shortUrl) {
                shortLink = shortenData.shortUrl;
              }
            }
          } catch (error) {
            console.warn('[WhatsApp] Link shortening failed:', error.message);
          }

          // Filter customer configs
          const customerConfigs = configs.filter(conf => {
            const triggers = Array.isArray(conf.triggers) ? conf.triggers : (conf.trigger ? [conf.trigger] : []);
            const isActive = conf.isActive !== false;
            return isActive && triggers.includes(event) && conf.baseUrl && conf.instance && conf.apikey && conf.recipientType === 'customer';
          });

          // Send to Customer if configured
          if (customerConfigs.length > 0) {
            customerDeliveryStatus.attempted = true;
            const customerConf = customerConfigs[0];
            let cleanBaseUrl = customerConf.baseUrl.trim().replace(/\/+$/, '');
            if (!cleanBaseUrl.startsWith('http')) cleanBaseUrl = `https://${cleanBaseUrl}`;

            const invoiceMedia = (event === 'order.paid') ? await getInvoiceMedia() : null;
            const primaryPhone = formatWaNumber(data.customer?.phone);
            const secondPhone = formatWaNumber(data.customer?.secondPhone);
            const fallbackMerchantPhone = '201039317393';

            let sentSuccess = false;
            let successPhone = '';

            // 1. Try Primary Phone
            if (primaryPhone) {
              console.log(`[WhatsApp] Sending customer message to primary phone: ${primaryPhone}`);
              try {
                const res1 = await sendWaMessage(cleanBaseUrl, customerConf.instance, customerConf.apikey, primaryPhone, customerMessage, invoiceMedia, data.orderId);
                if (res1.ok) {
                  console.log(`[WhatsApp] Successfully sent to customer primary phone: ${primaryPhone}`);
                  sentSuccess = true;
                  successPhone = primaryPhone;
                } else {
                  console.warn(`[WhatsApp] Primary phone ${primaryPhone} failed (${res1.status}):`, res1.text);
                }
              } catch (err) {
                console.warn(`[WhatsApp] Primary phone network failed:`, err.message);
              }
            }

            // 2. If primary phone failed or had no WhatsApp, try Secondary Phone
            if (!sentSuccess && secondPhone && secondPhone !== primaryPhone) {
              console.log(`[WhatsApp] Trying customer secondary phone: ${secondPhone}`);
              try {
                const res2 = await sendWaMessage(cleanBaseUrl, customerConf.instance, customerConf.apikey, secondPhone, customerMessage, invoiceMedia, data.orderId);
                if (res2.ok) {
                  console.log(`[WhatsApp] Successfully sent to customer secondary phone: ${secondPhone}`);
                  sentSuccess = true;
                  successPhone = secondPhone;
                } else {
                  console.warn(`[WhatsApp] Secondary phone ${secondPhone} failed (${res2.status}):`, res2.text);
                }
              } catch (err) {
                console.warn(`[WhatsApp] Secondary phone network failed:`, err.message);
              }
            }

            const cleanOrderId = String(data.orderId || '').replace(/^(?:order|ord)[-_]?/i, '').trim();
            const customerName = data.customer?.name || '';

            // Update customer delivery outcome
            if (sentSuccess) {
              customerDeliveryStatus.sent = true;
              customerDeliveryStatus.phone = successPhone;
              if (event === 'order.paid') {
                customerDeliveryStatus.statusText = `✅ تم إرسال الفاتورة للعميل `;
              } else if (hasTransferScreenshot) {
                customerDeliveryStatus.statusText = `✅ تم إرسال رسالة جاري مراجعة الدفع للعميل `;
              } else {
                customerDeliveryStatus.statusText = `✅ تم إرسال تأكيد الطلب للعميل `;
              }
            } else {
              customerDeliveryStatus.sent = false;
              const failLabel = hasTransferScreenshot
                ? 'رسالة التحويل'
                : (event === 'order.paid' ? 'الفاتورة' : 'تفاصيل الطلب');
              customerDeliveryStatus.statusText = `⚠️ تعذر إرسال ${failLabel} للعميل : ${customerName}\nرقم الاوردر : ${cleanOrderId} (أرقام العميل ليس عليها واتساب)`;

              // Fallback to merchant phone 201039317393
              console.log(`[WhatsApp] Customer has no WhatsApp. Falling back to merchant at ${fallbackMerchantPhone}`);
              const fallbackMedia = (event === 'order.paid') ? await getInvoiceMedia() : null;
              const fallbackNotice = `${customerDeliveryStatus.statusText}\n\n`;
              const fallbackOldMessage = (event === 'order.paid'
                ? `✅ تم تأكيد الدفع 

رقم الطلب: ${data.orderId}
اسم العميل: ${data.customer.name}
اجمالي الطلب: EGP ${data.totalPrice}
${remainingText}

رابط واتساب للعميل:
${shortLink}`
                : `${hasTransferScreenshot ? '📸 الطلب مرفق به اسكرين التحويل' : '🔔 طلب جديد'}
رقم الطلب: ${data.orderId}
اسم العميل: ${data.customer.name}
اجمالي الطلب: EGP ${data.totalPrice}${data.customer.notes ? `\nملاحظات: ${data.customer.notes}` : ''}

رابط واتساب:
${shortLink}`);

              const fallbackMessage = fallbackNotice + fallbackOldMessage;

              try {
                const resFallback = await sendWaMessage(cleanBaseUrl, customerConf.instance, customerConf.apikey, fallbackMerchantPhone, fallbackMessage, fallbackMedia, data.orderId);
                if (resFallback.ok) {
                  console.log(`[WhatsApp] Fallback message successfully sent to merchant: ${fallbackMerchantPhone}`);
                  fallbackSentToMerchant = true;
                } else {
                  console.error(`[WhatsApp] Fallback to merchant failed (${resFallback.status}):`, resFallback.text);
                }
              } catch (err) {
                console.error(`[WhatsApp] Fallback to merchant network failed:`, err.message);
              }
            }
          }

          // ── Phase 2: Send Merchant WhatsApp Notifications ──
          // Build Owner Message containing confirmation of customer delivery
          let confirmationText = '';
          if (customerDeliveryStatus.statusText) {
            confirmationText = `\n\n${customerDeliveryStatus.statusText}`;
          }

          let ownerMessage = '';
          if (event === 'order.created') {
            ownerMessage = `${hasTransferScreenshot ? '📸 الطلب مرفق به اسكرين التحويل' : '🔔 طلب جديد'}
رقم الطلب: ${data.orderId}
اسم العميل: ${data.customer.name}
اجمالي الطلب: EGP ${data.totalPrice}${data.customer.notes ? `\nملاحظات: ${data.customer.notes}` : ''}

رابط واتساب:
${shortLink}`;
            if (confirmationText) ownerMessage += confirmationText;
          } else if (event === 'order.paid') {
            ownerMessage = `✅ تم تأكيد الدفع 

رقم الطلب: ${data.orderId}
اسم العميل: ${data.customer.name}
اجمالي الطلب: EGP ${data.totalPrice}
${remainingText}

رابط واتساب للعميل:
${shortLink}`;
            if (confirmationText) ownerMessage += confirmationText;
          } else {
            ownerMessage = `إشعار طلب: ${event}\nرقم الطلب: ${data.orderId}\nالعميل: ${data.customer.name}`;
            if (confirmationText) ownerMessage += confirmationText;
          }

          const merchantConfigs = configs.filter(conf => {
            const triggers = Array.isArray(conf.triggers) ? conf.triggers : (conf.trigger ? [conf.trigger] : []);
            const isActive = conf.isActive !== false;
            return isActive && triggers.includes(event) && conf.baseUrl && conf.instance && conf.apikey && conf.recipientType !== 'customer' && conf.number;
          });

          for (const conf of merchantConfigs) {
            let cleanNumber = formatWaNumber(conf.number);
            if (!cleanNumber) continue;

            // Avoid sending twice if fallback was already sent to this exact number
            if (cleanNumber === '201039317393' && fallbackSentToMerchant) {
              console.log(`[WhatsApp] Skipping merchant ${cleanNumber} as fallback was already delivered.`);
              continue;
            }

            let cleanBaseUrl = conf.baseUrl.trim().replace(/\/+$/, '');
            if (!cleanBaseUrl.startsWith('http')) cleanBaseUrl = `https://${cleanBaseUrl}`;

            // The merchant receives the invoice image if:
            // 1) Direct sending to the customer is disabled/inactive (like the old behavior)
            // 2) Or if direct sending was attempted but failed because customer has no WhatsApp
            // (Merchant only skips receiving invoice media when the customer has already received it successfully)
            const shouldSendMediaToMerchant = (!customerDeliveryStatus.sent && event === 'order.paid');
            const merchantMedia = shouldSendMediaToMerchant ? await getInvoiceMedia() : null;

            try {
              const resOwner = await sendWaMessage(cleanBaseUrl, conf.instance, conf.apikey, cleanNumber, ownerMessage, merchantMedia, data.orderId);
              if (resOwner.ok) {
                console.log(`[WhatsApp] Merchant message sent to ${cleanNumber}`);
              } else {
                console.error(`[WhatsApp] Merchant message failed (${resOwner.status}):`, resOwner.text);
              }
            } catch (err) {
              console.error(`[WhatsApp] Network failed for merchant ${cleanNumber}:`, err.message);
            }
          }
        }
      } catch (waErr) {
        console.error('[WhatsApp] System error:', waErr.message);
      }
    }

    // ── Phase 3: HTTP Webhook Notifications ──
    // Delivered with customer notification status included in payload
    if (!skipHttp) {
      const webhooks = await Webhook.find({ active: true, events: event });
      console.log(`[Webhook] Found ${webhooks.length} active webhooks for event: ${event}`);

      if (webhooks.length > 0) {
        const subamount = (data.totalPrice || 0) - (data.shippingFee || 0);

        const products = (data.items || []).map(item => ({
          "name": item.name,
          "count": item.quantity,
          "price": item.quantity ? (item.finalPrice / item.quantity) : item.finalPrice,
          "value option": (item.selectedOptions || []).map(o => o.label).join(' / ') || ""
        }));

        const rawPayload = {
          "Order ID": data.orderId,
          "Name": data.customer?.name || "",
          "Phone": data.customer?.phone || "",
          "Second Phone": data.customer?.secondPhone || "",
          "Address": data.customer?.address || "",
          "Gov-ar": data.customer?.government || "",
          "Gov-en": cityMap[data.customer?.government] || data.customer?.government || "",
          "notes": data.customer?.notes || "",
          "subamount": subamount,
          "shipment-amount": data.shippingFee || 0,
          "total amount": data.totalPrice || 0,
          "paid amount": data.paidAmount || 0,
          "remaining amount": (data.totalPrice || 0) - (data.paidAmount || 0),
          "products": products,
          "Month": new Date().toLocaleString('en-US', { month: 'long' }),
          "month_number": new Date().getMonth() + 1,
          "Transfer Screenshot": data.transferScreenshot || "",
          "Transfer Number": data.transferNumber || "",
          "Customer Notified": customerDeliveryStatus.sent ? "نعم" : (customerDeliveryStatus.attempted ? "لا" : "غير مفعل"),
          "Customer Notification Status": customerDeliveryStatus.statusText || (customerDeliveryStatus.attempted ? "تعذر الإرسال" : "غير مفعل"),
          "Customer Phone Contacted": customerDeliveryStatus.phone || "",
          "customer_notified": customerDeliveryStatus.sent,
          "customer_notification_type": customerDeliveryStatus.label || "",
          "customer_notification_status": customerDeliveryStatus.statusText || ""
        };

        const payload = JSON.stringify({
          event,
          timestamp: new Date().toISOString(),
          data: rawPayload
        });

        const promises = webhooks.map(wh => {
          console.log(`[Webhook] Sending payload to ${wh.url}...`);
          return fetch(wh.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            signal: AbortSignal.timeout(5000)
          }).catch(err => {
            console.error(`Failed to send webhook to ${wh.url}:`, err.message);
          });
        });

        await Promise.all(promises);
      }
    }

  } catch (err) {
    console.error('Webhook system error:', err.message);
  }
}

module.exports = sendWebhook;
