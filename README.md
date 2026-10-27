# image-cdn

Cloudflare Worker yang menyajikan gambar dari **R2** sekaligus sebagai CDN: resize sesuai permintaan (on-the-fly) + negosiasi format **AVIF/WebP**, dengan caching agresif di edge.

Dipakai sebagai `cdn.enterprisejadikanweb.biz.id` oleh [jadikanweb.id](https://jadikanweb.id).

## Cara kerja

| Request | Perilaku |
|---|---|
| `GET /path/img.jpg` | File asli dari R2 apa adanya (tanpa transformasi) |
| `GET /path/img.jpg?width=800` | Di-resize ke lebar 800px, diformat AVIF/WebP sesuai header `Accept` browser |
| `?width=800&quality=70` | Quality custom (default 80; AVIF otomatis diturunkan ~0.8× agar setara secara visual) |

Detail implementasi (`src/index.ts`):

- **Origin**: bucket R2 `jadikanweb` (binding `IMAGES_BUCKET`), key = path URL.
- **Transformasi**: Cloudflare Images binding (`IMAGES`) — tidak perlu menyimpan varian ukuran.
- **Batas lebar**: 16–2400px, supaya kuota transformasi tidak dihabiskan oleh ribuan ukuran acak.
- **Cache**: `Cache API` Cloudflare + `Cache-Control: public, max-age=31536000, immutable`. Format hasil dimasukkan ke cache key (`_f=avif|webp`) karena cache tidak membedakan respons berdasarkan header `Accept`.
- **Passthrough**: SVG dan GIF (animasi) tidak ditransformasi.
- **Fail-safe**: transformasi gagal → file asli dikembalikan, bukan error 500.
- `X-Worker-Cache: HIT|MISS` untuk debugging cache worker.

## Development

```bash
npm install
npm run dev      # wrangler dev (lokal, emulate R2 + Images)
npm test         # vitest
npm run deploy   # wrangler deploy ke production
```

Prasyarat: login Wrangler (`npx wrangler login`) dan akses ke akun Cloudflare yang memiliki bucket R2 `jadikanweb`.

## Konfigurasi

Lihat `wrangler.jsonc`:

- `r2_buckets` → binding `IMAGES_BUCKET` ke bucket `jadikanweb`
- `images` → binding `IMAGES` untuk API transformasi
- `observability` aktif, source maps di-upload
