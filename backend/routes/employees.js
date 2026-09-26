const express = require('express');
const router = express.Router();
const Employee = require('../models/Employee');
const adminAuth = require('../middleware/adminAuth');
const { requirePermission } = adminAuth;

// Full permissions object for Super Admin
const ALL_PERMISSIONS_FULL = {
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
};

/**
 * POST /api/employees/login
 * Authenticates either Master Admin (from .env) or Employee (from DB).
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'يرجى إدخال اسم المستخدم وكلمة المرور' });
    }

    const cleanUsername = username.trim().toLowerCase();
    const envUsername = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
    const envPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const envApiKey = process.env.ADMIN_API_KEY || 'loli_secret_admin_key';

    // 1. Check Super Admin credentials (.env)
    if (cleanUsername === envUsername && password === envPassword) {
      return res.json({
        success: true,
        token: envApiKey,
        user: {
          id: 'superadmin',
          name: 'المدير العام',
          username: envUsername,
          role: 'superadmin',
          isSuperAdmin: true,
          permissions: ALL_PERMISSIONS_FULL
        }
      });
    }

    // 2. Check Employee in Database
    const employee = await Employee.findOne({ username: cleanUsername });
    if (!employee) {
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }

    if (!employee.isActive) {
      return res.status(403).json({ error: 'هذا الحساب معطل حالياً. يرجى مراجعة إدارة المتجر' });
    }

    const isMatch = employee.validatePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }

    const token = employee.generateAuthToken();
    await employee.save();

    return res.json({
      success: true,
      token,
      user: {
        id: employee._id,
        name: employee.name,
        username: employee.username,
        role: employee.role || 'employee',
        isSuperAdmin: false,
        permissions: employee.permissions ? employee.permissions.toObject() : {}
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'حدث خطأ غير متوقع أثناء تسجيل الدخول' });
  }
});

/**
 * GET /api/employees/me
 * Returns current authenticated user details and permissions.
 */
router.get('/me', adminAuth, (req, res) => {
  res.json({
    user: req.adminUser
  });
});

/**
 * GET /api/employees
 * List all employees. Requires 'employees' section permission.
 */
router.get('/', adminAuth, requirePermission('employees', 'read'), async (req, res) => {
  try {
    const employees = await Employee.find()
      .select('-passwordHash -salt')
      .sort({ createdAt: -1 });
    res.json({ employees });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/employees
 * Create a new employee. Requires 'employees' section full permission.
 */
router.post('/', adminAuth, requirePermission('employees', 'full'), async (req, res) => {
  try {
    const { name, username, password, permissions, isActive } = req.body;

    if (!name || !username || !password) {
      return res.status(400).json({ error: 'جميع الحقول الأساسية (الاسم، اسم المستخدم، كلمة المرور) مطلوبة' });
    }

    const cleanUsername = username.trim().toLowerCase();
    const envUsername = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();

    if (cleanUsername === envUsername) {
      return res.status(400).json({ error: 'اسم المستخدم هذا محجوز للمدير العام' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'كلمة المرور يجب أن تتكون من 6 أحرف أو أرقام على الأقل' });
    }

    const existing = await Employee.findOne({ username: cleanUsername });
    if (existing) {
      return res.status(400).json({ error: 'اسم المستخدم مستخدم بالفعل، يرجى اختيار اسم آخر' });
    }

    const employee = new Employee({
      name: name.trim(),
      username: cleanUsername,
      permissions: permissions || {},
      isActive: isActive !== false
    });

    employee.setPassword(password);
    await employee.save();

    res.status(201).json({
      message: 'تم إنشاء حساب الموظف بنجاح',
      employee: {
        id: employee._id,
        name: employee.name,
        username: employee.username,
        permissions: employee.permissions,
        isActive: employee.isActive,
        createdAt: employee.createdAt
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/employees/:id
 * Update an existing employee.
 */
router.put('/:id', adminAuth, requirePermission('employees', 'full'), async (req, res) => {
  try {
    const { name, username, password, permissions, isActive } = req.body;
    const employee = await Employee.findById(req.params.id);

    if (!employee) {
      return res.status(404).json({ error: 'الموظف غير موجود' });
    }

    if (username) {
      const cleanUsername = username.trim().toLowerCase();
      const envUsername = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
      if (cleanUsername === envUsername) {
        return res.status(400).json({ error: 'اسم المستخدم هذا محجوز للمدير العام' });
      }

      const duplicate = await Employee.findOne({ username: cleanUsername, _id: { $ne: employee._id } });
      if (duplicate) {
        return res.status(400).json({ error: 'اسم المستخدم مسجل لموظف آخر' });
      }
      employee.username = cleanUsername;
    }

    if (name) employee.name = name.trim();
    if (permissions) {
      employee.permissions = permissions;
      // Invalidate existing sessions immediately when permissions change
      employee.token = null;
      employee.tokenExpiresAt = null;
    }
    if (typeof isActive === 'boolean') {
      employee.isActive = isActive;
      if (!isActive) {
        employee.token = null;
        employee.tokenExpiresAt = null;
      }
    }

    if (password && password.trim().length > 0) {
      if (password.trim().length < 6) {
        return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 خانات على الأقل' });
      }
      employee.setPassword(password.trim());
      // Invalidate existing sessions on password change
      employee.token = null;
      employee.tokenExpiresAt = null;
    }

    await employee.save();

    res.json({
      message: 'تم تحديث بيانات الموظف بنجاح',
      employee: {
        id: employee._id,
        name: employee.name,
        username: employee.username,
        permissions: employee.permissions,
        isActive: employee.isActive,
        updatedAt: employee.updatedAt
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/employees/:id/toggle-status
 * Toggle employee active/inactive status.
 */
router.patch('/:id/toggle-status', adminAuth, requirePermission('employees', 'full'), async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) {
      return res.status(404).json({ error: 'الموظف غير موجود' });
    }

    employee.isActive = !employee.isActive;
    if (!employee.isActive) {
      employee.token = null; // Kick session out immediately
      employee.tokenExpiresAt = null;
    }
    await employee.save();

    res.json({
      message: employee.isActive ? 'تم تفعيل الحساب' : 'تم تعطيل الحساب',
      isActive: employee.isActive
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/employees/:id
 * Delete an employee.
 */
router.delete('/:id', adminAuth, requirePermission('employees', 'full'), async (req, res) => {
  try {
    const employee = await Employee.findByIdAndDelete(req.params.id);
    if (!employee) {
      return res.status(404).json({ error: 'الموظف غير موجود' });
    }
    res.json({ message: 'تم حذف الموظف بنجاح' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/employees/force-logout-all
 * Invalidate all employee active tokens in the database.
 */
router.post('/force-logout-all', adminAuth, async (req, res) => {
  try {
    await Employee.updateMany({}, { $set: { token: null, tokenExpiresAt: null } });
    res.json({ message: 'تم تسجيل خروج جميع الموظفين بنجاح' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
