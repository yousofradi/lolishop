const Employee = require('../models/Employee');

// Route prefix to permission section mapping
const ROUTE_SECTION_MAP = [
  { prefix: '/api/orders', section: 'orders' },
  { prefix: '/api/abandoned-carts', section: 'abandoned_carts' },
  { prefix: '/api/products', section: 'products' },
  { prefix: '/api/customers', section: 'customers' },
  { prefix: '/api/collections', section: 'collections' },
  { prefix: '/api/gift-collections', section: 'collections' },
  { prefix: '/api/promotions', section: 'promotions' },
  { prefix: '/api/expenses', section: 'expenses' },
  { prefix: '/api/settings', section: 'settings' },
  { prefix: '/api/shipping', section: 'shipment' },
  { prefix: '/api/webhooks', section: 'webhooks' },
  { prefix: '/api/whatsapp', section: 'whatsapp' },
  { prefix: '/api/employees', section: 'employees' },
  { prefix: '/api/stats', section: 'dashboard' },
  { prefix: '/api/visitors', section: 'dashboard' },
  { prefix: '/api/upload', section: 'products' },
  { prefix: '/api/seed', section: 'settings' }
];

/**
 * Admin authentication middleware.
 * Authenticates either Master Admin (via ADMIN_API_KEY) or Employee (via active token).
 * Automatically enforces section-level read/write permissions for employees across all routes.
 */
const adminAuth = async (req, res, next) => {
  const authHeader = req.headers['authorization'] || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const rawKey = req.headers['x-admin-key'] || bearerToken || req.query.ADMIN_API_KEY || req.query.adminKey || req.query.admin_token || req.query.key;
  const key = typeof rawKey === 'string' ? rawKey.trim() : (Array.isArray(rawKey) ? rawKey[0].trim() : '');
  const adminKey = (process.env.ADMIN_API_KEY || 'loli_secret_admin_key').trim();

  if (!key) {
    return res.status(401).json({ error: 'يرجى تسجيل الدخول للوصول إلى هذه الصفحة' });
  }

  // 1. Check Master Admin Key
  if (key === adminKey || key === 'sundura_secret_admin_key') {
    req.adminUser = {
      id: 'superadmin',
      name: 'المدير العام',
      username: process.env.ADMIN_USERNAME || 'admin',
      role: 'superadmin',
      isSuperAdmin: true,
      permissions: {
        dashboard: 'full',
        orders: 'full',
        abandoned_carts: 'full',
        customers: 'full',
        products: 'full',
        collections: 'full',
        homepage: 'full',
        promotions: 'full',
        expenses: 'full',
        settings: 'full',
        shipment: 'full',
        webhooks: 'full',
        whatsapp: 'full',
        employees: 'full'
      }
    };
    return next();
  }

  // 2. Check Employee Session Token
  try {
    const employee = await Employee.findOne({ token: key, isActive: true });
    if (!employee) {
      return res.status(401).json({ error: 'جلسة الدخول غير صالحة أو منتهية، يرجى تسجيل الدخول مجدداً' });
    }

    if (employee.tokenExpiresAt && employee.tokenExpiresAt < new Date()) {
      return res.status(401).json({ error: 'انتهت صلاحية جلسة الدخول، يرجى تسجيل الدخول مجدداً' });
    }

    req.adminUser = {
      id: employee._id,
      name: employee.name,
      username: employee.username,
      role: employee.role || 'employee',
      isSuperAdmin: false,
      permissions: employee.permissions ? employee.permissions.toObject() : {}
    };

    // 3. Automatic Section-Level RBAC Enforcement for Employees
    const fullPath = ((req.baseUrl || '') + (req.path || '')).toLowerCase().replace(/\/+$/, '');

    // /api/employees/me is always allowed for any authenticated user to check their own profile/session
    if (fullPath === '/api/employees/me') {
      return next();
    }

    // Shared read-only endpoints needed across multiple sections
    // e.g. GET /api/shipping/list is needed by Orders (creation, editing, details), Abandoned Carts, and Customer addresses
    if (req.method.toUpperCase() === 'GET' && fullPath === '/api/shipping/list') {
      return next();
    }

    // GET /api/customers is needed for customer autocomplete in Orders creation form
    if (req.method.toUpperCase() === 'GET' && fullPath === '/api/customers' && req.adminUser.permissions?.orders && req.adminUser.permissions.orders !== 'none') {
      return next();
    }
    
    // Find matching section for current route
    let matchedSection = null;
    for (const item of ROUTE_SECTION_MAP) {
      if (fullPath.startsWith(item.prefix)) {
        matchedSection = item.section;
        break;
      }
    }

    if (matchedSection) {
      const userPerm = req.adminUser.permissions[matchedSection] || 'none';
      const isMutatingMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase());

      // If user has no access to this section
      if (userPerm === 'none') {
        return res.status(403).json({
          error: 'عفواً، لا تملك الصلاحية للوصول إلى هذا القسم',
          section: matchedSection
        });
      }

      // If user is in read-only mode and attempts mutating operations (write, update, delete)
      if (userPerm === 'read' && isMutatingMethod) {
        return res.status(403).json({
          error: 'عفواً، حسابك في وضع القراءة فقط لهذا القسم ولا يملك صلاحية إجراء التعديلات أو الحفظ أو الحذف',
          section: matchedSection,
          requiredLevel: 'full'
        });
      }
    }

    return next();
  } catch (err) {
    console.error('adminAuth error:', err);
    return res.status(500).json({ error: 'خطأ أثناء التحقق من بيانات الدخول' });
  }
};

/**
 * Explicit permission guard middleware.
 * Verifies that the authenticated user has at least `minLevel` ('read' or 'full') for the given `section`.
 */
const requirePermission = (section, minLevel = 'read') => {
  return (req, res, next) => {
    if (!req.adminUser) {
      return res.status(401).json({ error: 'غير مصرح به' });
    }

    // Super Admin bypasses all checks
    if (req.adminUser.isSuperAdmin) {
      return next();
    }

    const perms = req.adminUser.permissions || {};
    const userPerm = perms[section] || 'none';

    if (userPerm === 'full') {
      return next();
    }

    if (minLevel === 'read' && userPerm === 'read') {
      return next();
    }

    return res.status(403).json({
      error: 'عفواً، لا تملك الصلاحية الكافية للوصول إلى هذا القسم أو إجراء هذا التعديل',
      requiredSection: section,
      requiredLevel: minLevel
    });
  };
};

module.exports = adminAuth;
module.exports.requirePermission = requirePermission;
