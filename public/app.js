// Bé Bơ Shopping menu — static JSON loader.
// All data is pre-rendered to data/ and public/images/ by the hourly refresh job.
// We fetch static files from GitHub Pages; no live API or external request is needed.

const menu = document.getElementById('menu');
const status = document.getElementById('status');
const search = document.getElementById('search');
const refreshButton = document.getElementById('refreshButton');
const generatedAt = document.getElementById('generatedAt');

const CACHE_BUSTER = Date.now();
const version = { value: 0 };

const products = [];
const collectionsMeta = []; // [{ name, slug }]

const money = (value) =>
  Number(value) > 0 ? `${Math.round(Number(value)).toLocaleString('vi-VN')}đ` : 'Chưa có giá';

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[char]));

function card(item) {
  const img = item.image
    ? `<img src="${escapeHtml(item.image)}?v=${CACHE_BUSTER}" alt="${escapeHtml(item.name)}" loading="lazy" decoding="async">`
    : '<span class="placeholder">▧</span>';
  return `<article class="card"><div class="image">${img}</div><div class="card-body"><h4 class="name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</h4><div class="collection-label">${escapeHtml(item.collection)}</div><div class="meta"><span>Số lượng</span><strong>${Number(item.quantity_available || 0)}</strong></div><div class="price"><span>Giá lẻ</span><strong>${money(item.retail_price)}</strong></div></div></article>`;
}

function render() {
  const query = search.value.trim().toLocaleLowerCase('vi');
  const visible = products.filter((item) => !query || `${item.name} ${item.collection}`.toLocaleLowerCase('vi').includes(query));
  const groups = visible.reduce((result, item) => {
    const key = item.collection || 'Chưa phân loại';
    (result[key] ||= []).push(item);
    return result;
  }, {});
  const ordered = collectionsMeta
    .map((c) => c.name)
    .filter((name) => groups[name])
    .concat(Object.keys(groups).filter((n) => !collectionsMeta.some((c) => c.name === n)));

  if (!ordered.length) {
    menu.innerHTML = '<div class="message">Không tìm thấy sản phẩm nào.</div>';
    return;
  }

  menu.innerHTML = ordered.map((collection) => {
    const items = (groups[collection] || []).sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi'));
    return `<section class="collection"><div class="collection-title"><h3>${escapeHtml(collection)}</h3><span class="count">${items.length} món</span></div><div class="grid">${items.map(card).join('')}</div></section>`;
  }).join('');
}

async function fetchJson(path) {
  const response = await fetch(`${path}?v=${CACHE_BUSTER}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

async function loadMenu() {
  const v = ++version.value;
  products.length = 0;
  collectionsMeta.length = 0;
  menu.innerHTML = '<div class="message">Đang tải danh sách bộ sưu tập...</div>';
  status.textContent = 'Đang tải dữ liệu mới...';
  refreshButton.disabled = true;

  try {
    const index = await fetchJson('data/collections.json');
    if (v !== version.value) return;
    for (const c of index.collections || []) collectionsMeta.push(c);
    if (index.generated_at && generatedAt) {
      const stamp = new Date(index.generated_at);
      generatedAt.textContent = `Cập nhật lúc ${stamp.toLocaleString('vi-VN')}`;
    }

    menu.innerHTML = collectionsMeta.map((c) => `<section class="collection" data-slug="${escapeHtml(c.slug)}"><div class="collection-title"><h3>${escapeHtml(c.name)}</h3><span class="count" data-count>Đang tải</span></div><div class="grid" data-grid></div></section>`).join('')
      || '<div class="message">Không có sản phẩm nào.</div>';

    await Promise.all(collectionsMeta.map(async (c) => {
      try {
        const file = await fetchJson(`data/products/${encodeURIComponent(c.slug)}.json`);
        if (v !== version.value) return;
        const items = Array.isArray(file.items) ? file.items : [];
        products.push(...items);
        const section = menu.querySelector(`[data-slug="${CSS.escape(c.slug)}"]`);
        if (!section) return;
        section.querySelector('[data-grid]').innerHTML = items.map(card).join('');
        section.querySelector('[data-count]').textContent = `${items.length} món`;
      } catch (error) {
        console.error(`Không tải được bộ sưu tập ${c.name}:`, error);
        const section = menu.querySelector(`[data-slug="${CSS.escape(c.slug)}"]`);
        if (section) section.querySelector('[data-count]').textContent = 'Lỗi tải';
      }
    }));

    if (v !== version.value) return;
    status.textContent = `Đã cập nhật lúc ${new Date(index.generated_at || Date.now()).toLocaleTimeString('vi-VN')} · ${products.length} sản phẩm`;
  } catch (error) {
    if (v !== version.value) return;
    menu.innerHTML = '<div class="message error">Không thể tải menu. Vui lòng thử lại sau vài phút (cron sắp chạy).</div>';
    status.textContent = 'Tải dữ liệu thất bại';
    console.error(error);
  } finally {
    if (v === version.value) refreshButton.disabled = false;
  }
}

search.addEventListener('input', render);
refreshButton.addEventListener('click', loadMenu);
window.addEventListener('pageshow', loadMenu);
