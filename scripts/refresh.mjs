// Refresh static menu data for GitHub Pages.
//
// Each hourly run connects directly to Supabase Postgres, exports the latest
// product catalogue and image files, and writes them under data/ and public/.
// The committed files are then served by GitHub Pages.
//
// Connection string is read from the SUPABASE_DB_URL environment variable,
// which is stored as a GitHub Actions secret. The password is URL-encoded.
// Connect to Supabase using individual parameters parsed from the URL, so that
// we can fully control SSL behaviour and avoid libpq's verify-full default.
import pg from 'pg';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(PUBLIC_DIR, 'data');
const PRODUCTS_DIR = path.join(DATA_DIR, 'products');
const PUBLIC_IMAGES_DIR = path.join(PUBLIC_DIR, 'images');

const EXCLUDED_COLLECTIONS = ['Đang về', 'Đồ dùng'];

function parseConnectionString(raw) {
  // Hand-rolled parser to avoid pg's pre-emptive sslmode handling. We only
  // read the bits we actually need; everything else is passed through.
  const url = new URL(raw);
  const userInfo = url.username
    ? { user: decodeURIComponent(url.username), password: url.password ? decodeURIComponent(url.password) : undefined }
    : {};
  const dbName = url.pathname.replace(/^\//, '') || 'postgres';
  return {
    ...userInfo,
    host: url.hostname,
    port: Number(url.port || '5432'),
    database: dbName,
  };
}

// Decode a base64 data URL (data:image/xyz;base64,XXX) into a Buffer.
function decodeDataUrl(input) {
  if (!input || typeof input !== 'string') return null;
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(input.trim());
  if (!match) return null;
  const mime = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) return null;
  const ext = mimeToExt(mime);
  return { buffer, ext, mime };
}

function mimeToExt(mime) {
  switch (mime) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/avif':
      return 'avif';
    case 'image/svg+xml':
      return 'svg';
    default: {
      const slash = mime.indexOf('/');
      return slash >= 0 ? mime.slice(slash + 1).replace(/[^a-z0-9]/gi, '') : 'bin';
    }
  }
}

// Slugify a collection name into a filename-safe identifier.
function slugify(input) {
  const base = (input || '').toString().trim().toLowerCase();
  const ascii = base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
  return ascii
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'collection';
}

async function ensureDirs() {
  await fs.mkdir(PRODUCTS_DIR, { recursive: true });
  await fs.mkdir(PUBLIC_IMAGES_DIR, { recursive: true });
}

async function resetOutputs() {
  // Clear data/products and public/images from the previous run so deleted
  // collections / products don't linger on GitHub Pages.
  await fs.rm(PRODUCTS_DIR, { recursive: true, force: true });
  await fs.rm(PUBLIC_IMAGES_DIR, { recursive: true, force: true });
  await fs.mkdir(PRODUCTS_DIR, { recursive: true });
  await fs.mkdir(PUBLIC_IMAGES_DIR, { recursive: true });
}

async function writeJson(filepath, payload) {
  await fs.writeFile(filepath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

async function main() {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    throw new Error('SUPABASE_DB_URL is required. Set it as a GitHub Actions secret or in .env.local.');
  }

  console.log('[refresh] connecting to Supabase...');
  const connection = parseConnectionString(connectionString);
  const client = new pg.Client({
    ...connection,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    await ensureDirs();
    await resetOutputs();

    // 1. Collections
    const collectionsResult = await client.query(
      `SELECT DISTINCT collection
         FROM products
        WHERE warehouse = 'FK'
          AND collection IS NOT NULL
        ORDER BY collection ASC`,
    );
    const rawCollections = collectionsResult.rows
      .map((r) => r.collection)
      .filter((c) => !EXCLUDED_COLLECTIONS.includes(c));
    console.log(`[refresh] collections: ${rawCollections.length}`);

    // 2. Products grouped by collection
    const productsResult = await client.query(
      `SELECT id::text AS id, name, warehouse, collection,
              price::float8 AS price, retail_price::float8 AS retail_price,
              desired_price::float8 AS desired_price,
              quantity_available::int AS quantity_available
         FROM products
        WHERE warehouse = 'FK'
          AND collection = ANY($1::text[])
        ORDER BY collection ASC, name ASC`,
      [rawCollections],
    );
    const productsByCollection = new Map();
    const allProducts = [];
    for (const row of productsResult.rows) {
      const item = {
        id: row.id,
        name: row.name,
        warehouse: row.warehouse,
        collection: row.collection,
        price: row.price ?? 0,
        retail_price: row.retail_price ?? 0,
        desired_price: row.desired_price ?? 0,
        quantity_available: row.quantity_available ?? 0,
      };
      (productsByCollection.get(row.collection) || productsByCollection.set(row.collection, []).get(row.collection)).push(item);
      allProducts.push(item);
    }

    // 3. First image per product
    const imageResult = await client.query(
      `SELECT DISTINCT ON (product_id)
              product_id::text AS product_id,
              export_data_url,
              data_url
         FROM product_images
        WHERE product_id IS NOT NULL
        ORDER BY product_id, position ASC NULLS LAST, created_at ASC NULLS LAST`,
    );
    const imageByProduct = new Map();
    for (const row of imageResult.rows) {
      const dataUrl = row.export_data_url || row.data_url || null;
      if (!dataUrl) continue;
      const decoded = decodeDataUrl(dataUrl);
      if (!decoded) continue;
      imageByProduct.set(row.product_id, decoded);
    }

    // 4. Write per-collection product files
    for (const collection of rawCollections) {
      const items = (productsByCollection.get(collection) || []).map((item) => ({
        ...item,
        image: imageByProduct.has(item.id) ? `images/${item.id}.${imageByProduct.get(item.id).ext}` : null,
      }));
      const slug = slugify(collection);
      const target = path.join(PRODUCTS_DIR, `${slug}.json`);
      await writeJson(target, { collection, slug, count: items.length, items });
    }

    // 5. Collections index
    const collections = rawCollections.map((name) => ({
      name,
      slug: slugify(name),
    }));
    await writeJson(path.join(DATA_DIR, 'collections.json'), {
      generated_at: new Date().toISOString(),
      collections,
      excluded: EXCLUDED_COLLECTIONS,
    });

    // 6. Compact all-products file (optional fast lookup)
    await writeJson(path.join(DATA_DIR, 'all-products.json'), {
      generated_at: new Date().toISOString(),
      count: allProducts.length,
      items: allProducts,
    });

    // 7. Save binary image files referenced by each product
    let savedImages = 0;
    let totalBytes = 0;
    for (const [productId, decoded] of imageByProduct.entries()) {
      const filename = `${productId}.${decoded.ext}`;
      const target = path.join(PUBLIC_IMAGES_DIR, filename);
      await fs.writeFile(target, decoded.buffer);
      savedImages += 1;
      totalBytes += decoded.buffer.length;
    }

    // 8. image index so the static page can map id → filename without inventing one
    const imageMap = {};
    for (const [productId, decoded] of imageByProduct.entries()) {
      imageMap[productId] = `images/${productId}.${decoded.ext}`;
    }
    await writeJson(path.join(PUBLIC_DIR, 'images.json'), imageMap);

    console.log(
      `[refresh] done: ${rawCollections.length} collections, ${allProducts.length} products, ${savedImages} images (${(totalBytes / 1024 / 1024).toFixed(2)} MB)`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[refresh] FAILED:', err);
  process.exitCode = 1;
});
