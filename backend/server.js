require('dotenv').config();

// Programmatically suppress Bull/BullMQ automatic Redis eviction policy warning logs
const originalWarn = console.warn;
console.warn = function (...args) {
  if (args[0] && typeof args[0] === 'string' && args[0].includes('Eviction policy is')) {
    return;
  }
  originalWarn.apply(console, args);
};
const originalError = console.error;
console.error = function (...args) {
  if (args[0] && typeof args[0] === 'string' && args[0].includes('Eviction policy is')) {
    return;
  }
  originalError.apply(console, args);
};
const originalLog = console.log;
console.log = function (...args) {
  if (args[0] && typeof args[0] === 'string' && args[0].includes('Eviction policy is')) {
    return;
  }
  originalLog.apply(console, args);
};
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');

// Initialize background worker
require('./utils/queue');

const app = express();

// ── Middleware ───────────────────────────────────────────
const compression = require('compression');
app.use(compression()); // gzip all responses

// ── CORS Configuration ──────────────────────────────────
const corsOptions = {
  origin: true, // Reflect request origin
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key'],
  exposedHeaders: ['Content-Disposition'],
  credentials: true,
  maxAge: 86400
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '5mb' }));

// ── Routes (mount under both /api/... and /... for backward compatibility) ──────────────
const routeModules = [
  ['products', require('./routes/products')],
  ['orders', require('./routes/orders')],
  ['shipping', require('./routes/shipping')],
  ['collections', require('./routes/collectionRoutes').router],
  ['webhooks', require('./routes/webhookRoutes')],
  ['settings', require('./routes/settings')],
  ['seed', require('./routes/seed')],
  ['upload', require('./routes/upload')],
  ['customers', require('./routes/customerRoutes')],
  ['promotions', require('./routes/promotions').router],
  ['gift-collections', require('./routes/giftCollections')],
  ['notifications', require('./routes/notifications')],
  ['abandoned-carts', require('./routes/abandonedCarts')],
  ['visitors', require('./routes/visitors')],
  ['stats', require('./routes/stats')],
  ['employees', require('./routes/employees')]
];

for (const [name, routerModule] of routeModules) {
  app.use(`/api/${name}`, routerModule);
  app.use(`/${name}`, routerModule);
}

// Serve static uploads with long cache
app.use(['/uploads', '/api/uploads'], express.static('uploads', {
  maxAge: '365d',
  immutable: true
}));

// ── Root route ──────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    message: 'LoliShop API is running',
    endpoints: {
      health: 'GET /api/health',
      products: 'GET /api/products',
      collections: 'GET /api/collections',
      shipping: 'GET /api/shipping',
      orders: 'POST /api/orders'
    }
  });
});

// ── Health check ────────────────────────────────────────
app.get(['/api/health', '/health'], (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── 404 handler ─────────────────────────────────────────
app.get('/favicon.ico', (req, res) => res.status(204).end());

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Error handler ───────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ───────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(` Server running on port ${PORT}`);
  });
});
