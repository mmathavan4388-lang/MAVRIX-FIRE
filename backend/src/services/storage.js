// S3-compatible object storage (Supabase Storage S3, Cloudflare R2, AWS S3). Images are re-encoded
// server-side (strips metadata, bounds size, converts to WebP) before upload.
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { config, flags } from '../config.js';
import { unavailable, badRequest } from '../util/http.js';

let client;
const s3 = () => (client ??= new S3Client({
  region: config.storage.region,
  endpoint: config.storage.endpoint || undefined,
  forcePathStyle: !!config.storage.endpoint,
  credentials: { accessKeyId: config.storage.accessKeyId, secretAccessKey: config.storage.secretAccessKey },
}));

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function processImage(buffer, mimetype, { maxWidth = 1600, quality = 78 } = {}) {
  if (!ALLOWED.has(mimetype)) throw badRequest('bad_image_type', 'Only JPEG, PNG or WebP images are allowed');
  try {
    return await sharp(buffer, { limitInputPixels: 40_000_000 })
      .rotate().resize({ width: maxWidth, withoutEnlargement: true }).webp({ quality }).toBuffer();
  } catch {
    throw badRequest('bad_image', 'This file is not a valid image');
  }
}

/** Returns { url, key }. folder e.g. "products/<shopId>". */
export async function uploadImage(file, folder, opts) {
  if (!flags.storage()) throw unavailable('storage_not_configured', 'Image storage is not configured on the server');
  const body = await processImage(file.buffer, file.mimetype, opts);
  const key = `${folder}/${randomUUID()}.webp`;
  await s3().send(new PutObjectCommand({
    Bucket: config.storage.bucket, Key: key, Body: body,
    ContentType: 'image/webp', CacheControl: 'public, max-age=31536000, immutable',
  }));
  return { url: `${config.storage.publicBaseUrl}/${key}`, key };
}
