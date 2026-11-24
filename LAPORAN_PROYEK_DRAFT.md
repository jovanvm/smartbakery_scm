# Draft Laporan Proyek — SmartBakery SCM

> **Status:** Draft kerangka narasi untuk flipbook laporan UAS.  
> **Studi kasus:** Roti Nusa — UMKM roti dan kue fiktif.  
> **Catatan:** Database MySQL `smartbakery_scm` telah di-reset ke data seed awal pada 23 November 2026 agar pengambilan screenshot E2E dimulai dari kondisi bersih.

---

## 1. Informasi Proyek

| Field | Isi |
|---|---|
| Nama aplikasi | SmartBakery SCM |
| Mata kuliah | Supply Chain Management |
| Studi kasus | Roti Nusa |
| Topik | Sistem pendukung keputusan SCM berbasis web dengan agen AI |
| Tenggat flipbook | Kamis, 26 November 2026 pukul 18.00 WIB |
| Lokasi proyek | `C:\xampp\htdocs\SCM` |
| Alamat demo | `http://localhost:3000` |

**Nama mahasiswa:** _[isi]_  
**NIM:** _[isi]_  
**Dosen pengampu:** _[isi]_

---

## 2. Ringkasan Eksekutif

SmartBakery SCM adalah dashboard Supply Chain Management untuk membantu UMKM Roti Nusa merencanakan produksi, memantau persediaan bahan baku, mengelola pemasok, serta menyusun draf pesanan pembelian. Aplikasi ini menggabungkan perhitungan deterministik di backend dengan agen AI berbasis OpenRouter tool calling yang kompatibel dengan format OpenAI.

Agen AI berperan sebagai asisten operasional: membaca data stok, menghitung kebutuhan bahan, membandingkan penawaran pemasok, dan membuat draf PO. Seluruh keputusan final tetap berada di tangan pengguna melalui tombol Setujui, Batalkan, dan Terima Barang.

Pengujian end-to-end dengan skenario produksi **100 Roti Manis** berhasil lolos. Sistem menghitung kebutuhan pembelian **5 kg tepung terigu** dan **2 kg mentega**, memilih **Toko Sumber Pangan**, serta menghasilkan draf PO sebesar **Rp121.000** dengan status `MENUNGGU_PERSETUJUAN`.

---

## 3. Tujuan dan Ruang Lingkup

### 3.1 Tujuan

1. Membangun dashboard SCM berbasis web yang mudah digunakan dan seluruh labelnya berbahasa Indonesia.
2. Mengotomatisasi perhitungan kebutuhan bahan baku berdasarkan resep dan stok pengaman.
3. Memberikan rekomendasi pemasok yang memenuhi tenggat produksi dengan mempertimbangkan harga.
4. Menyediakan alur Purchase Order yang aman: draf dari agen, persetujuan manual oleh pengguna.
5. Membuktikan alur tersebut melalui pengujian skenario 100 Roti Manis.

### 3.2 Ruang Lingkup

- Modul Dashboard, Persediaan, Pemasok, Produk & BOM, Rencana Produksi, Pembelian, AI Agent, dan Riwayat Aktivitas.
- Database MySQL dengan 10 tabel, termasuk `agent_logs`, dan transaksi untuk perubahan status PO.
- API Express dengan validasi input dan penanganan error terpusat.
- Integrasi OpenRouter API OpenAI-compatible dengan `OPENROUTER_MODEL`, `OPENROUTER_BASE_URL`, dan API key hanya di backend.
- Tidak termasuk pembayaran, pengiriman nyata, atau autentikasi pengguna.

---

## 4. Stack Teknologi dan Arsitektur

| Lapisan | Teknologi |
|---|---|
| Frontend | HTML, CSS, JavaScript vanilla, single-page dashboard |
| Backend | Node.js, Express.js, ES Modules |
| Database | MySQL/MariaDB di XAMPP dengan `mysql2/promise` connection pool |
| AI | OpenRouter tool calling OpenAI-compatible via `fetch` native Node.js |
| Konfigurasi | `dotenv` melalui file `.env` |

**Struktur umum:**

```text
public/
  index.html
  css/style.css
  js/app.js, dashboard.js, inventory.js, suppliers.js,
     products.js, production.js, procurement.js, agent.js, logs.js
src/
  database/db.js, schema.sql, seed.js
  services/scm-calculation.service.js, procurement.service.js, openrouter.service.js
  tools/scm-tools.js
  routes/api.routes.js
  middleware/error-handler.js
server.js
```

**Prinsip desain penting:**

- Semua angka dihitung backend, bukan oleh model AI.
- Harga PO diambil dari tabel `supplier_offers`, bukan input bebas.
- Agen hanya boleh memanggil tool yang masuk allowlist.
- Agen dilarang menyetujui, membatalkan, atau menerima PO.
- Setiap pemanggilan tool dicatat di `agent_logs`.

---

## 5. Alur Pengerjaan

### Tahap 1 — Kerangka dan Layout UI

Antarmuka dibuat sebagai dashboard satu halaman dengan sidebar kiri, header, kartu KPI, tabel data, badge status, modal form, toast, dan navigasi antar modul. Seluruh label menggunakan Bahasa Indonesia dan tidak ada tombol palsu.

![Tahap 1 — Dashboard awal](screenshots/01-dashboard-awal.png)

### Tahap 2 — Database dan Seed Data

Schema MySQL (InnoDB, foreign key, dan indeks) dibuat otomatis saat server berjalan. Seed otomatis mengisi 4 bahan baku, 2 pemasok, 6 penawaran, 1 produk, 4 item BOM, dan 1 rencana produksi `PP-2026-001`.

![Tahap 2 — Data persediaan awal](screenshots/02-persediaan-awal.png)

### Tahap 3 — Modul Inti SCM

CRUD persediaan, pemasok & penawaran, produk & BOM, dan rencana produksi dihubungkan ke API. Kalkulasi kebutuhan dan alur PO manual diimplementasikan di backend.

![Tahap 3 — Rencana produksi](screenshots/03-rencana-produksi.png)

### Tahap 4 — Integrasi OpenRouter Tool Calling

`scm-tools.js` menyediakan sembilan tool SCM dengan allowlist dan validasi argumen. `openrouter.service.js` menjalankan loop tool calling, membatasi iterasi, memangkas riwayat chat, serta mencatat setiap pemanggilan tool ke `agent_logs`.

![Tahap 4 — AI Agent](screenshots/04-ai-agent.png)

### Tahap 5 — Pengujian End-to-End 100 Roti

Skenario dijalankan dari data seed bersih. Kalkulasi, rekomendasi pemasok, draf PO, persetujuan, penerimaan barang, dan pergerakan stok diverifikasi satu per satu.

![Tahap 5 — Draf PO](screenshots/05-draf-po.png)

### Tahap 6 — Dokumentasi Flipbook

Screenshot tiap proses disusun berurutan sesuai checklist di Bagian 9. Narasi ini menjadi kerangka laporan akhir.

![Tahap 6 — Riwayat aktivitas](screenshots/06-riwayat-aktivitas.png)

---

## 6. Data Simulasi Awal

### 6.1 Persediaan Bahan Baku

| Kode | Nama Bahan | Stok | Pengaman | Satuan |
|---|---|---:|---:|---|
| BB001 | Tepung terigu | 8 | 3 | kg |
| BB002 | Gula pasir | 4 | 2 | kg |
| BB003 | Telur | 40 | 10 | butir |
| BB004 | Mentega | 1 | 1 | kg |

### 6.2 Resep Roti Manis per 100 Roti

| Bahan | Kebutuhan |
|---|---:|
| Tepung terigu | 10 kg |
| Gula pasir | 2 kg |
| Telur | 30 butir |
| Mentega | 2 kg |

### 6.3 Pemasok Terpilih

| Pemasok | Bahan | Harga | Lead time |
|---|---|---:|---:|
| Toko Sumber Pangan | Tepung terigu | Rp13.000/kg | 1 hari |
| Toko Sumber Pangan | Mentega | Rp28.000/kg | 2 hari |
| Grosir Makmur | Tepung terigu | Rp12.500/kg | 3 hari |
| Grosir Makmur | Mentega | Rp29.000/kg | 1 hari |

Rencana produksi uji adalah `PP-2026-001`, produk Roti Manis 100 roti, dibutuhkan dua hari setelah tanggal seed.

---

## 7. Pengujian End-to-End Skenario 100 Roti

### 7.1 Kalkulasi Kebutuhan

| Bahan | Kebutuhan | Stok | Pengaman | Perlu dibeli | Pemasok | Subtotal |
|---|---:|---:|---:|---:|---|---:|
| Tepung terigu | 10 kg | 8 kg | 3 kg | 5 kg | Toko Sumber Pangan | Rp65.000 |
| Gula pasir | 2 kg | 4 kg | 2 kg | 0 | — | Rp0 |
| Telur | 30 butir | 40 butir | 10 butir | 0 | — | Rp0 |
| Mentega | 2 kg | 1 kg | 1 kg | 2 kg | Toko Sumber Pangan | Rp56.000 |

**Total estimasi:** `Rp121.000`  
**Jumlah bahan kurang:** 2  
**Risiko keterlambatan:** tidak ada

Tepung tetap memilih Toko Sumber Pangan meski harganya lebih tinggi, karena Grosir Makmur memiliki lead time 3 hari sehingga melanggar tenggat 2 hari. Mentega memilih Toko Sumber Pangan karena kedua pemasok memenuhi tenggat, tetapi harganya Rp28.000 lebih murah dibanding Rp29.000.

### 7.2 Draf Purchase Order

Draf PO dibuat melalui tool `create_purchase_order_draft` dengan hasil:

| Field | Hasil |
|---|---|
| Nomor PO | `PO-20261123-001` |
| Pemasok | Toko Sumber Pangan |
| Status | `MENUNGGU_PERSETUJUAN` |
| Item 1 | Tepung terigu 5 kg × Rp13.000 = Rp65.000 |
| Item 2 | Mentega 2 kg × Rp28.000 = Rp56.000 |
| Total | Rp121.000 |

### 7.3 Alur Persetujuan dan Penerimaan

| Langkah | Hasil yang diharapkan | Hasil pengujian |
|---|---|---|
| Terima PO sebelum disetujui | Ditolak | `409 Conflict`, status masih `MENUNGGU_PERSETUJUAN` |
| Setujui PO | Status `DISETUJUI` | Lolos |
| Terima barang | Status `DITERIMA`, stok bertambah | Lolos |
| Terima PO dua kali | Ditolak | `409 Conflict` |

Persetujuan dan penerimaan PO dijalankan dalam transaksi database `BEGIN` → `COMMIT` / `ROLLBACK`. Baris PO dikunci dengan `SELECT ... FOR UPDATE`, sehingga status tidak dapat berubah dua kali secara bersamaan dan stok tidak bertambah ganda.

### 7.4 Kondisi Akhir Setelah Penerimaan

| Bahan | Stok awal | Stok akhir |
|---|---:|---:|
| Tepung terigu | 8 kg | 13 kg |
| Mentega | 1 kg | 3 kg |

- Jumlah pergerakan stok: 2 (`MASUK` dari PO).
- KPI bahan kritis: 0.
- PO terbaru di dashboard: `DITERIMA`, total `Rp121.000`.
- Riwayat aktivitas: 1 entri `create_purchase_order_draft` berstatus `SUCCESS`.

### 7.5 Perilaku Agen dan Penanganan Error

Pengujian fungsional tool juga mencakup:

- Tool di luar allowlist ditolak dengan `400` dan dicatat sebagai `ERROR`.
- Error OpenRouter sementara seperti `429 rate limit`, `503 unavailable`, dan timeout ditangani dengan retry otomatis dua kali serta pesan Bahasa Indonesia yang jelas.
- API key tidak pernah dikirim ke frontend atau ditampilkan di UI.

---

## 8. Cara Menjalankan Aplikasi

```bash
npm install
npm run dev
```

Buka `http://localhost:3000`.

Konfigurasi backend ada pada `.env`:

```text
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=smartbakery_scm
OPENROUTER_MODEL=openai/gpt-4o-mini
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_API_KEY=...
```

API key cukup diisi sekali di backend. Jika file `.env` diubah, jalankan ulang server karena `node --watch` tidak memantau file `.env`.

Untuk mengembalikan database ke kondisi seed awal secara bersih:

```bash
npm run db:reset
```

`db:reset` mengosongkan seluruh tabel, mengembalikan `AUTO_INCREMENT`, lalu menjalankan seed ulang. `npm run db:seed` tetap tersedia untuk mengisi database kosong tanpa menghapus data yang sudah ada.

---

## 9. Checklist Screenshot Flipbook

1. Dashboard dan data awal.
2. Persediaan dengan stok tepung 8 kg dan mentega 1 kg.
3. Rencana produksi `PP-2026-001` untuk 100 roti.
4. Prompt Agent untuk memeriksa kebutuhan bahan.
5. Agent memanggil tool pengambilan data dan kalkulasi.
6. Hasil kebutuhan: tepung 5 kg dan mentega 2 kg.
7. Agent membandingkan penawaran pemasok.
8. Alasan pemilihan Toko Sumber Pangan.
9. Agent membuat draf PO.
10. Modul Pembelian menampilkan PO `Rp121.000` berstatus menunggu persetujuan.
11. PO disetujui melalui tombol aplikasi.
12. Penerimaan barang melalui tombol Terima Barang.
13. Stok bertambah dan riwayat pergerakan stok tercatat.
14. Riwayat Aktivitas menampilkan tool yang dijalankan Agent.

---

## 10. Kelebihan dan Keterbatasan

### 10.1 Kelebihan

- Perhitungan SCM transparan dan dapat diverifikasi langsung dari database.
- Rekomendasi pemasok mempertimbangkan tenggat sebelum harga.
- Agen AI membantu pengguna, tetapi tidak mengambil keputusan final.
- Setiap aksi agen tercatat sehingga mudah diaudit.
- Validasi backend mencegah status PO tidak sah dan penerimaan ganda.

### 10.2 Keterbatasan

- Ketersediaan jawaban agen bergantung pada layanan OpenRouter, model yang dipilih, dan kredit akun; permintaan dapat gagal sementara saat rate limit atau gangguan penyedia.
- Aplikasi belum memiliki autentikasi dan manajemen pengguna.
- Data yang digunakan adalah data simulasi, bukan data produksi nyata.
- Pengambilan screenshot flipbook masih perlu dilakukan manual melalui browser.

---

## 11. Penutup

SmartBakery SCM berhasil memenuhi alur utama yang diminta: dari perencanaan produksi, perhitungan kebutuhan bahan, rekomendasi pemasok, pembuatan draf PO oleh agen, hingga persetujuan dan penerimaan barang oleh pengguna. Pengujian skenario 100 Roti Manis membuktikan bahwa seluruh angka sesuai dengan acuan, dengan total draf PO Rp121.000 dan perubahan stok yang tercatat dengan benar.

Dokumen ini masih berupa draft. Narasi dapat disesuaikan dengan gaya penulisan laporan akhir, lalu dipasangkan dengan screenshot sesuai checklist pada Bagian 9.
