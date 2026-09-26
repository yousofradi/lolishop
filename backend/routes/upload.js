const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cloudinaryPackage = require('cloudinary');
const CloudinaryStorage = require('multer-storage-cloudinary');
const adminAuth = require('../middleware/adminAuth');
const { isR2Configured, uploadToR2, isR2Url } = require('../utils/r2');
const Product = require('../models/Product');
const Collection = require('../models/Collection');
const Order = require('../models/Order');
const Setting = require('../models/Setting');
const Promotion = require('../models/Promotion');
const GiftCollection = require('../models/GiftCollection');

// ── Storage Configuration ────────────────────────────────

// Check for Cloudinary credentials
const isCloudinaryConfigured = process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET;

let storage;

if (isR2Configured) {
  // If R2 is configured, we use memory storage so sharp can process the buffer
  storage = multer.memoryStorage();
  console.log('✅ Upload: Using Cloudflare R2 storage (MemoryBuffer -> Sharp -> R2)');
} else if (isCloudinaryConfigured) {
  // Cloudinary Storage (Persistent)
  cloudinaryPackage.v2.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });

  storage = new CloudinaryStorage({
    cloudinary: cloudinaryPackage,
    params: {
      folder: 'ecommerce-uploads',
      format: 'webp',
      transformation: [
        { width: 800, crop: 'limit' },
        { quality: 'auto:good' }
      ]
    }
  });
  console.log('✅ Upload: Using Cloudinary storage with pre-compression');
} else {
  // Local Disk Storage (Fallback - NOT persistent on ephemeral platforms)
  const uploadDir = path.join(__dirname, '../uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, uniqueSuffix + path.extname(file.originalname));
    }
  });
  console.log('⚠️ Upload: Cloudinary and R2 not configured, using local disk storage');
}

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// ── Routes ───────────────────────────────────────────────

// POST /api/upload — upload a single image
router.post('/', adminAuth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    let imageUrl = '';
    let filename = '';

    if (isR2Configured) {
      const folder = req.body.folder || 'lolishop';
      const prefix = req.body.prefix || '';
      imageUrl = await uploadToR2(req.file.buffer, req.file.originalname, folder, prefix);
      filename = path.basename(imageUrl);
    } else {
      imageUrl = req.file.path || req.file.secure_url || req.file.url;
      filename = req.file.filename || req.file.public_id;

      if (isCloudinaryConfigured) {
        const { optimizeCloudinaryUrl } = require('../utils/cloudinary');
        if (typeof imageUrl === 'string') {
          imageUrl = imageUrl.replace(/\.(png|jpe?g|gif)$/i, '.webp');
          imageUrl = optimizeCloudinaryUrl(imageUrl);
        }
      } else {
        const host = req.get('host');
        const protocol = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0];
        const finalProtocol = (host.includes('render.com') || host.includes('onrender.com')) ? 'https' : protocol;
        imageUrl = `${finalProtocol}://${host}/uploads/${req.file.filename}`;
      }
    }

    res.json({ url: imageUrl, filename });
  } catch (err) {
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

// POST /api/upload/public — upload a single image publicly (e.g. transfer screenshots)
router.post('/public', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    let imageUrl = '';
    let filename = '';

    if (isR2Configured) {
      const folder = req.body.folder || 'transactions';
      const prefix = req.body.prefix || '';
      imageUrl = await uploadToR2(req.file.buffer, req.file.originalname, folder, prefix);
      filename = path.basename(imageUrl);
    } else {
      imageUrl = req.file.path || req.file.secure_url || req.file.url;
      filename = req.file.filename || req.file.public_id;

      if (isCloudinaryConfigured) {
        const { optimizeCloudinaryUrl } = require('../utils/cloudinary');
        if (typeof imageUrl === 'string') {
          imageUrl = imageUrl.replace(/\.(png|jpe?g|gif)$/i, '.webp');
          imageUrl = optimizeCloudinaryUrl(imageUrl);
        }
      } else {
        const host = req.get('host');
        const protocol = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0];
        const finalProtocol = (host.includes('render.com') || host.includes('onrender.com')) ? 'https' : protocol;
        imageUrl = `${finalProtocol}://${host}/uploads/${req.file.filename}`;
      }
    }

    res.json({ url: imageUrl, filename });
  } catch (err) {
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

// GET / POST /api/upload/migrate-to-r2 — Migrate all non-R2 image URLs in DB to Cloudflare R2
router.all('/migrate-to-r2', adminAuth, async (req, res) => {
  if (!isR2Configured) {
    return res.status(400).json({ error: 'Cloudflare R2 is not configured in Environment Variables.' });
  }

  const urlMap = new Map();
  const stats = {
    migrated: 0,
    skippedAlreadyR2: 0,
    failed: 0,
    productsUpdated: 0,
    collectionsUpdated: 0,
    ordersUpdated: 0,
    settingsUpdated: 0,
    promotionsUpdated: 0,
    giftCollectionsUpdated: 0,
    errors: []
  };

  async function migrateUrl(url, folder = 'lolishop', prefix = '') {
    if (!url || typeof url !== 'string' || !url.trim()) return url;
    const cleanUrl = url.trim();
    if (isR2Url(cleanUrl)) {
      stats.skippedAlreadyR2++;
      return cleanUrl;
    }
    if (urlMap.has(cleanUrl)) {
      return urlMap.get(cleanUrl);
    }

    try {
      let imageBuffer = null;
      let originalName = path.basename(cleanUrl.split('?')[0]) || 'migrated-image.jpg';

      if (cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://')) {
        const fetchSignal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined;
        const response = await fetch(cleanUrl, { signal: fetchSignal });
        if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${cleanUrl}`);
        const arrayBuffer = await response.arrayBuffer();
        imageBuffer = Buffer.from(arrayBuffer);
      } else if (cleanUrl.startsWith('/uploads/') || cleanUrl.startsWith('uploads/')) {
        const localPath = path.join(__dirname, '..', cleanUrl.startsWith('/') ? cleanUrl : `/${cleanUrl}`);
        if (fs.existsSync(localPath)) {
          imageBuffer = fs.readFileSync(localPath);
        } else {
          throw new Error(`Local file not found at ${localPath}`);
        }
      } else {
        return cleanUrl;
      }

      if (!imageBuffer || imageBuffer.length === 0) {
        throw new Error(`Empty image buffer for ${cleanUrl}`);
      }

      const r2Url = await uploadToR2(imageBuffer, originalName, folder, prefix);
      urlMap.set(cleanUrl, r2Url);
      stats.migrated++;
      return r2Url;
    } catch (err) {
      stats.failed++;
      stats.errors.push({ url: cleanUrl, error: err.message });
      return cleanUrl;
    }
  }

  try {
    // 1. Products
    const products = await Product.find({});
    for (const product of products) {
      let updated = false;
      if (Array.isArray(product.images) && product.images.length > 0) {
        const newImages = [];
        for (const img of product.images) {
          const newUrl = await migrateUrl(img, 'lolishop', product.name || 'product');
          if (newUrl !== img) updated = true;
          newImages.push(newUrl);
        }
        product.images = newImages;
      }

      if (Array.isArray(product.variants) && product.variants.length > 0) {
        for (const variant of product.variants) {
          if (variant.image) {
            const newUrl = await migrateUrl(variant.image, 'lolishop', `${product.name}-variant`);
            if (newUrl !== variant.image) {
              variant.image = newUrl;
              updated = true;
            }
          }
        }
      }

      if (updated) {
        await product.save();
        stats.productsUpdated++;
      }
    }

    // 2. Collections
    const collections = await Collection.find({});
    for (const collection of collections) {
      if (collection.image) {
        const newUrl = await migrateUrl(collection.image, 'lolishop', collection.name || 'collection');
        if (newUrl !== collection.image) {
          collection.image = newUrl;
          await collection.save();
          stats.collectionsUpdated++;
        }
      }
    }

    // 3. Orders (transfer Screenshots)
    const orders = await Order.find({ transferScreenshot: { $ne: null } });
    for (const order of orders) {
      if (order.transferScreenshot) {
        const newUrl = await migrateUrl(order.transferScreenshot, 'transactions', order.orderId || 'order');
        if (newUrl !== order.transferScreenshot) {
          order.transferScreenshot = newUrl;
          await order.save();
          stats.ordersUpdated++;
        }
      }
    }

    // 4. Settings
    const settings = await Setting.find({});
    for (const setting of settings) {
      if (typeof setting.value === 'string' && (setting.value.startsWith('http') || setting.value.startsWith('/uploads'))) {
        const newUrl = await migrateUrl(setting.value, 'lolishop', setting.key);
        if (newUrl !== setting.value) {
          setting.value = newUrl;
          await setting.save();
          stats.settingsUpdated++;
        }
      }
    }

    // 5. Promotions
    try {
      const promotions = await Promotion.find({});
      for (const promo of promotions) {
        if (promo.image) {
          const newUrl = await migrateUrl(promo.image, 'lolishop', promo.title || 'promo');
          if (newUrl !== promo.image) {
            promo.image = newUrl;
            await promo.save();
            stats.promotionsUpdated++;
          }
        }
      }
    } catch (_) { }

    // 6. Gift Collections
    try {
      const giftCollections = await GiftCollection.find({});
      for (const gc of giftCollections) {
        if (gc.image) {
          const newUrl = await migrateUrl(gc.image, 'lolishop', gc.title || 'gift');
          if (newUrl !== gc.image) {
            gc.image = newUrl;
            await gc.save();
            stats.giftCollectionsUpdated++;
          }
        }
      }
    } catch (_) { }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(JSON.stringify({
      success: true,
      message: 'Migration process completed.',
      stats,
      migratedCount: stats.migrated
    }, null, 2));
  } catch (err) {
    res.status(500).setHeader('Content-Type', 'application/json; charset=utf-8').send(JSON.stringify({ error: 'Migration failed: ' + err.message, stats }, null, 2));
  }
});

module.exports = router;
