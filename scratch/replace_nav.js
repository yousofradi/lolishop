const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../frontend/admin');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));

const newSidebar = `
    <aside class="admin-sidebar">
      <div class="admin-brand-header">
        <div class="admin-brand-sub">متاجري <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg></div>
        <div class="admin-brand-title">LoliShop</div>
        <a href="../" target="_blank" class="admin-store-preview">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
          معاينة المتجر
        </a>
      </div>
      <button class="sidebar-toggle" style="position:absolute; top:20px; left:20px; background:none; border:none; font-size:1.5rem; cursor:pointer; color:#475569;">☰</button>
      
      <div style="font-size:0.85rem; font-weight:600; color:#94a3b8; margin-bottom:8px; padding-right:14px;">متجري</div>
      <nav class="admin-nav">
        <a href="index" data-nav="index">
          <svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
          الرئيسية
        </a>
        <a href="orders" data-nav="orders">
          <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
          الطلبات
        </a>
        <a href="products" data-nav="products">
          <svg viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>
          المنتجات
        </a>
        <a href="collections" data-nav="collections">
          <svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
          المجموعات
        </a>
        <a href="homepage" data-nav="homepage">
          <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
          تخصيص الواجهة
        </a>
        <a href="shipment" data-nav="shipment">
          <svg viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>
          الشحن
        </a>
        <a href="webhooks" data-nav="webhooks">
          <svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
          Webhooks
        </a>
        <a href="#" onclick="logout()" class="logout">
          <svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
          خروج
        </a>
      </nav>
    </aside>`;

files.forEach(f => {
  const p = path.join(dir, f);
  if (f === 'login.html') return;
  let html = fs.readFileSync(p, 'utf8');
  // First handle the older structure (which has <div class="admin-sidebar-header">...</div>)
  // or just replace the whole <aside> element
  html = html.replace(/<aside class="admin-sidebar">[\s\S]*?<\/aside>/, newSidebar);
  
  // Set active class based on file name
  let activeKey = f.replace('.html', '').replace('-form', '').replace('-details', '');
  if (activeKey === 'index') activeKey = 'index';
  if (activeKey === 'product') activeKey = 'products';
  if (activeKey === 'collection') activeKey = 'collections';
  if (activeKey === 'order') activeKey = 'orders';
  
  html = html.replace(new RegExp(`data-nav="${activeKey}">`), `class="active">`);
  // Remove data-nav attributes from other links
  html = html.replace(/ data-nav="[a-z]+"/g, '');
  
  fs.writeFileSync(p, html);
});
console.log('Replaced sidebar in all admin files.');
