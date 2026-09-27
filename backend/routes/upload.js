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
const isCloudinaryConfigured = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

if (isCloudinaryConfigured) {
  cloudinaryPackage.v2.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
  console.log('✅ Upload: Cloudinary configured');
}

// Memory storage allows us to optimize with Sharp and try R2 -> Cloudinary -> Local Disk seamlessly
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

async function uploadToCloudinaryBuffer(buffer, folder = 'ecommerce-uploads') {
  if (!isCloudinaryConfigured) return null;
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinaryPackage.v2.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
        format: 'webp',
        transformation: [
          { width: 800, crop: 'limit' },
          { quality: 'auto:good' }
        ]
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result.secure_url || result.url);
      }
    );
    uploadStream.end(buffer);
  });
}

async function saveToDisk(buffer, originalName, req) {
  const uploadDir = path.join(__dirname, '../uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  let finalBuffer = buffer;
  let ext = '.webp';
  try {
    const sharp = require('sharp');
    finalBuffer = await sharp(buffer)
      .resize(800, null, { withoutEnlargement: true, fit: 'inside' })
      .webp({ quality: 80 })
      .toBuffer();
  } catch (e) {
    ext = path.extname(originalName) || '.png';
  }

  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
  const cleanName = path.basename(originalName, path.extname(originalName)).replace(/[^a-zA-Z0-9]/g, '') || 'image';
  const fname = `${cleanName}-${uniqueSuffix}${ext}`;
  const filePath = path.join(uploadDir, fname);
  await fs.promises.writeFile(filePath, finalBuffer);

  const host = req.get('host');
  const protocol = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0];
  const finalProtocol = (host.includes('render.com') || host.includes('onrender.com')) ? 'https' : protocol;
  return {
    url: `${finalProtocol}://${host}/uploads/${fname}`,
    filename: fname
  };
}

async function handleFileUpload(file, folder, prefix, req) {
  // 1. Try Cloudflare R2
  if (isR2Configured) {
    try {
      const imageUrl = await uploadToR2(file.buffer, file.originalname, folder, prefix);
      return { url: imageUrl, filename: path.basename(imageUrl) };
    } catch (r2Err) {
      console.error('⚠️ R2 upload failed (Access Denied / error):', r2Err.message);
    }
  }

  // 2. Try Cloudinary
  if (isCloudinaryConfigured) {
    try {
      const cloudUrl = await uploadToCloudinaryBuffer(file.buffer, folder);
      if (cloudUrl) {
        return { url: cloudUrl, filename: path.basename(cloudUrl) };
      }
    } catch (cloudErr) {
      console.error('⚠️ Cloudinary upload fallback failed:', cloudErr.message);
    }
  }

  // 3. Fallback to Disk Storage
  console.log('ℹ️ Using local disk storage fallback for upload');
  return await saveToDisk(file.buffer, file.originalname, req);
}

// ── Routes ───────────────────────────────────────────────

// POST /api/upload — upload a single image
router.post('/', adminAuth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const folder = req.body.folder || 'lolishop';
    const prefix = req.body.prefix || '';
    const result = await handleFileUpload(req.file, folder, prefix, req);
    res.json(result);
  } catch (err) {
    console.error('Upload failed completely:', err);
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

// POST /api/upload/public — upload a single image publicly (e.g. transfer screenshots)
router.post('/public', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const folder = req.body.folder || 'transactions';
    const prefix = req.body.prefix || '';
    const result = await handleFileUpload(req.file, folder, prefix, req);
    res.json(result);
  } catch (err) {
    console.error('Public upload failed completely:', err);
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

// GET /api/upload/test-r2 — Test Cloudflare R2 connectivity and diagnose configuration
router.get('/test-r2', async (req, res) => {
  const accountId = (process.env.R2_ACCOUNT_ID || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\.r2\.cloudflarestorage\.com.*$/i, '');
  const accessKeyId = (process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretKey = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const bucketName = (process.env.R2_BUCKET_NAME || '').trim();
  const publicUrl = (process.env.R2_PUBLIC_URL || '').trim();

  const configCheck = {
    isR2Configured,
    hasAccountId: Boolean(accountId),
    accountId: accountId ? (accountId.substring(0, 4) + '...' + accountId.slice(-4)) : null,
    hasAccessKeyId: Boolean(accessKeyId),
    accessKeyIdPrefix: accessKeyId ? accessKeyId.substring(0, 6) : null,
    hasSecretAccessKey: Boolean(secretKey),
    bucketName: bucketName || null,
    publicUrl: publicUrl || null
  };

  if (!isR2Configured) {
    return res.status(400).json({
      success: false,
      error: 'R2 is not configured in Environment Variables. Make sure R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME are set in Render.',
      config: configCheck
    });
  }

  try {
    const sharp = require('sharp');
    const testBuffer = await sharp({
      create: { width: 2, height: 2, channels: 4, background: { r: 232, g: 70, b: 172, alpha: 1 } }
    }).webp().toBuffer();

    const testUrl = await uploadToR2(testBuffer, 'r2-healthcheck.png', 'diagnostics');
    res.json({
      success: true,
      message: 'Cloudflare R2 is configured and upload succeeded!',
      testUrl,
      config: configCheck
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'R2 Upload failed: ' + err.message,
      errorCode: err.code || err.name,
      config: configCheck
    });
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
