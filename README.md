# Bé Bơ Shopping — Public Menu (GitHub Pages)

Trang menu tĩnh phục vụ qua **GitHub Pages**, được làm mới tự động mỗi giờ bằng
**GitHub Actions** kết nối thẳng vào Supabase Postgres.

```
[ Supabase Postgres ]
        │ (cron mỗi giờ)
        ▼
[ GitHub Actions ] ── chạy scripts/refresh.mjs ── ghi data/ + public/images/
        │
        ▼
[ git commit + push ]
        │
        ▼
[ GitHub Pages ] ── phục vụ index.html, data/*.json, images/*
```

## Tại sao miễn phí vĩnh viễn

| Thành phần                | Chi phí                              |
| ------------------------- | ------------------------------------ |
| GitHub Pages              | $0 (1 GB băng thông / tháng)         |
| GitHub Actions cron       | $0 (2 000 phút / tháng cho repo private, **không giới hạn** cho repo public) |
| Supabase Postgres (read)  | $0 — free tier                      |

Cron chạy **mỗi giờ một lần**, mỗi lần ~1 phút ⇒ tổng ~720 phút / tháng.
Dùng repo public thì không lo quota Actions. Repo private cũng thoải mái.

## Cấu trúc thư mục

```
be-bo-menu/
├── .github/workflows/refresh.yml   # Cron job + workflow_dispatch
├── scripts/refresh.mjs             # Script Node.js fetch Postgres
├── public/                         # Tất cả file tĩnh — GitHub Pages serve cả folder này
│   ├── index.html
│   ├── app.js                      # Fetch static JSON (collections + per-collection)
│   ├── style.css
│   ├── images.json                 # Map product_id → file ảnh (sinh tự động)
│   ├── images/                     # Ảnh sản phẩm (sinh tự động, .gitignore)
│   └── data/                       # Sinh tự động bởi script
│       ├── collections.json
│       ├── all-products.json
│       └── products/<slug>.json
├── package.json
├── .gitignore                      # Bỏ qua node_modules/ và public/images/
└── README.md
```

Tất cả file cần thiết cho GitHub Pages đều nằm dưới `public/`. Cứ `git push`
lên GitHub, Pages sẽ tự phục vụ. Đường dẫn tương đối (`data/...`,
`images/...`) đều được resolve từ trang `public/index.html`.

## Hướng dẫn triển khai (5 phút)

### 1. Tạo repo mới trên GitHub

- Vào https://github.com/new
- Tên: **`be-bo-menu`** (hoặc tuỳ ý)
- Chọn **Public** (để Actions không tốn quota)
- **Không** tick "Add a README file" (tránh xung đột với file có sẵn)

### 2. Đẩy code lên

Mở terminal trong thư mục `be-bo-menu/`:

```bash
git init
git add .
git commit -m "feat: initial menu scaffold"
git branch -M main
git remote add origin https://github.com/<username>/be-bo-menu.git
git push -u origin main
```

Hoặc upload thủ công qua GitHub web: kéo thả toàn bộ file/folder vào trang repo
(trừ `node_modules/` và `public/images/`).

### 3. Thêm secret `SUPABASE_DB_URL`

Vào **Settings → Secrets and variables → Actions → New repository secret**.

- Name: `SUPABASE_DB_URL`
- Value (password phải URL-encode `@` thành `%40`):

```
postgresql://postgres.nmngorxshtcpcltbwalk:Bersin0501%40@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=require
```

Lưu ý: `Bersin0501@` → `Bersin0501%40` (ký tự `@` phải encode).

> **Mẹo**: Connection string này chỉ dùng để đọc (SELECT) nên an toàn. Không có
> quyền ghi/xoá DB, kể cả khi lộ.

### 4. Bật GitHub Pages

Vào **Settings → Pages**:

- Source: **Deploy from a branch**
- Branch: `main`, Folder: **`/`** (root)
- Save

Pages sẽ publish từ commit mới nhất trên `main`. Folder `public/` chứa toàn bộ
file tĩnh (`index.html`, `app.js`, `style.css`, `data/`, `images/`).

> Nếu bạn muốn URL gọn `https://<user>.github.io/<repo>/`, giữ nguyên cấu hình.
> Nếu muốn URL gốc `https://<user>.github.io/` thì phải đặt tên repo là
> `<user>.github.io` (chỉ áp dụng cho user pages).

### 5. Chạy refresh lần đầu

Vào tab **Actions → Refresh menu → Run workflow** để chạy ngay (không cần đợi cron).

Sau khi workflow xanh:

- Repo sẽ có thêm folder `public/data/`, `public/images/`, `public/images.json`
- GitHub Pages build lại (khoảng 30 giây)
- Truy cập `https://<username>.github.io/be-bo-menu/`

### 6. Lên lịch tự động

Workflow đã có sẵn `cron: '17 * * * *'` — chạy phút thứ 17 mỗi giờ. Đổi nếu muốn:

- `0 * * * *` — đầu giờ (cùng giờ với nhiều người, có thể chậm)
- `*/30 * * * *` — mỗi 30 phút (2× traffic)
- `0 */6 * * *` — mỗi 6 giờ (rất tiết kiệm)

## Chạy local để kiểm thử

```bash
cd be-bo-menu
npm install
export SUPABASE_DB_URL='postgresql://postgres.nmngorxshtcpcltbwalk:Bersin0501%40@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=require'
npm run refresh
```

Sau đó mở `public/index.html` qua bất kỳ static server:

```bash
npx http-server public -p 8080
```

## Khắc phục sự cố

- **Workflow fail với "password authentication failed"**: URL-encode `@` thành `%40` trong password.
- **Workflow fail với "self-signed certificate"**: đã fix sẵn (script tự override TLS, bỏ qua `sslmode`).
- **Pages không cập nhật sau khi workflow xanh**: đợi 1–2 phút, hoặc Settings → Pages → tắt rồi bật lại.
- **Trang trắng / load chậm**: mở DevTools → Network xem file 404 cụ thể. Thường là do refresh lần đầu chưa chạy hoặc cron fail.
- **`verifie-full` warning**: chỉ là warning từ `pg`, không ảnh hưởng kết nối. Sẽ hết khi pg v9 ra.
- **Quá quota Actions**: repo Pages là **public** → Actions miễn phí không giới hạn. Nếu để private và đụng 2 000 phút / tháng, đổi sang `0 */2 * * *` (mỗi 2 giờ) sẽ chỉ tốn ~720 phút.
- **Muốn deploy nhanh hơn cron**: vào Actions → Refresh menu → Run workflow là manual chạy trong vài giây.
