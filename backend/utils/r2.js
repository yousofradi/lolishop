const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');
const path = require('path');

// Clean and sanitize R2 Environment Variables
const accountId = (process.env.R2_ACCOUNT_ID || '')
  .trim()
  .replace(/^https?:\/\//i, '')
  .replace(/\.r2\.cloudflarestorage\.com.*$/i, '');
const accessKeyId = (process.env.R2_ACCESS_KEY_ID || '').trim().replace(/^["']|["']$/g, '');
const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || '').trim().replace(/^["']|["']$/g, '');
const bucketName = (process.env.R2_BUCKET_NAME || '').trim().replace(/^["']|["']$/g, '');

const isR2Configured = Boolean(accountId && accessKeyId && secretAccessKey && bucketName);

let s3Client = null;

if (isR2Configured) {
  s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: accessKeyId,
      secretAccessKey: secretAccessKey,
    }
  });
  console.log('✅ R2: Cloudflare R2 Client Configured successfully.');
}

/**
 * Optimizes an image buffer to WebP (max width 800px) and uploads it to Cloudflare R2.
 * @param {Buffer} fileBuffer - The original file buffer.
 * @param {string} originalName - The original filename.
 * @param {string} folder - The destination folder prefix in R2.
 * @param {string} prefix - Optional custom prefix for the filename (e.g., product name).
 * @returns {Promise<string>} - The public URL of the uploaded image.
 */
async function uploadToR2(fileBuffer, originalName, folder = 'lolishop', prefix = '') {
  if (!isR2Configured || !s3Client) {
    throw new Error('Cloudflare R2 is not configured in Environment Variables.');
  }

  try {
    // 1. Optimize the image with Sharp
    const optimizedBuffer = await sharp(fileBuffer)
      .resize(800, null, { withoutEnlargement: true, fit: 'inside' })
      .webp({ quality: 80 })
      .toBuffer();

    // 2. Generate a unique filename
    const ext = '.webp';
    const uniqueSuffix = Math.round(Math.random() * 1E5); // Shorter suffix
    
    let baseName = '';
    if (prefix) {
      baseName = prefix.replace(/[^a-zA-Z0-9\u0600-\u06FF-]/g, '-').replace(/-+/g, '-');
    } else {
      baseName = path.basename(originalName, path.extname(originalName)).replace(/[^a-zA-Z0-9]/g, '');
      if (!baseName) baseName = 'image';
    }
    
    const filename = `${folder}/${baseName}-${uniqueSuffix}${ext}`;

    // 3. Upload to R2
    const uploadParams = {
      Bucket: bucketName,
      Key: filename,
      Body: optimizedBuffer,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable'
    };

    await s3Client.send(new PutObjectCommand(uploadParams));

    // 4. Return the public URL
    // If R2_PUBLIC_URL is defined, use it. Otherwise, return the raw R2.dev URL (requires public access enabled in bucket settings).
    const publicDomain = (process.env.R2_PUBLIC_URL || '').trim() || `https://pub-${accountId}.r2.dev`;
    
    // Ensure publicDomain doesn't end with a slash
    const cleanDomain = publicDomain.replace(/\/$/, '');
    
    return `${cleanDomain}/${filename}`;

  } catch (error) {
    console.error('❌ R2 Upload Error:', error);
    throw error;
  }
}

/**
 * Checks if a URL is an R2 URL (for the frontend optimization bypass).
 * @param {string} url 
 * @returns {boolean}
 */
function isR2Url(url) {
  if (!url || typeof url !== 'string') return false;
  return url.includes('r2.dev') || url.includes('r2.cloudflarestorage.com') || (process.env.R2_PUBLIC_URL && url.startsWith(process.env.R2_PUBLIC_URL));
}

module.exports = {
  isR2Configured,
  uploadToR2,
  isR2Url
};
