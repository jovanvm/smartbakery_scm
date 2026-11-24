(function () {
  window.SmartBakery = window.SmartBakery || {};

  let initialized = false;
  let materialsCache = [];

  function offerFields() {
    const { fieldInput, fieldSelect } = window.SmartBakery.utils;
    const options = [
      { value: '', label: 'Pilih bahan baku' },
      ...materialsCache.map((item) => ({
        value: item.id,
        label: `${item.code} — ${item.name} (${item.unit})`
      }))
    ];

    return `
      <div class="form-grid">
        ${fieldSelect({ name: 'material_id', label: 'Bahan baku', options })}
        ${fieldInput({ name: 'unit_price', label: 'Harga satuan (Rp)', type: 'number', min: '0', step: '1' })}
        ${fieldInput({ name: 'lead_time_days', label: 'Lead time (hari)', type: 'number', min: '0', step: '1' })}
        ${fieldInput({ name: 'moq', label: 'MOQ', value: 1, type: 'number', min: '1', step: '1' })}
      </div>
    `;
  }

  function openOfferModal(supplierId) {
    const { api, utils } = window.SmartBakery;

    utils.openModal({
      title: 'Tambah / Perbarui Penawaran',
      bodyHtml: offerFields(),
      submitLabel: 'Simpan Penawaran',
      onSubmit: async (data) => {
        await api.post(`/suppliers/${supplierId}/offers`, {
          material_id: Number(data.material_id),
          unit_price: Number(data.unit_price),
          lead_time_days: Number(data.lead_time_days),
          moq: Number(data.moq)
        });

        utils.showToast('Penawaran pemasok berhasil disimpan.');
        await load();
      }
    });
  }

  function renderSuppliers(suppliers) {
    const { utils } = window.SmartBakery;
    const body = document.querySelector('#suppliers-body');

    document.querySelector('#supplier-count').textContent = `${suppliers.length} pemasok`;
    body.innerHTML = suppliers.length
      ? suppliers.map((supplier) => {
          const offers = supplier.offers.length
            ? supplier.offers.map((offer) => `
                <div class="offer-line">
                  <strong>${utils.escapeHtml(offer.material_code)}</strong>
                  ${utils.escapeHtml(offer.material_name)} —
                  ${utils.formatRupiah(offer.unit_price)} / ${utils.escapeHtml(offer.unit)},
                  ${offer.lead_time_days} hari, MOQ ${offer.moq}
                </div>
              `).join('')
            : '<span class="muted">Belum ada penawaran</span>';

          return `
            <tr>
              <td>${utils.escapeHtml(supplier.code)}</td>
              <td>${utils.escapeHtml(supplier.name)}</td>
              <td>${utils.escapeHtml(supplier.contact ?? '—')}</td>
              <td>${supplier.is_active ? '<span class="badge badge-success">Aktif</span>' : '<span class="badge badge-muted">Nonaktif</span>'}</td>
              <td><div class="offer-list">${offers}</div></td>
              <td>
                <button type="button" class="button link small" data-offer-supplier="${supplier.id}">Kelola penawaran</button>
              </td>
            </tr>
          `;
        }).join('')
      : utils.emptyRow(6, 'Belum ada pemasok.');
  }

  function renderComparison(offers) {
    const { utils } = window.SmartBakery;
    const body = document.querySelector('#compare-body');

    body.innerHTML = offers.length
      ? offers.map((offer, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${utils.escapeHtml(offer.supplier_name)}</td>
            <td>${utils.formatRupiah(offer.unit_price)}</td>
            <td>${offer.lead_time_days} hari</td>
            <td>${offer.moq}</td>
            <td>${offer.meets_deadline ? '<span class="badge badge-success">Memenuhi</span>' : '<span class="badge badge-danger">Terlambat</span>'}</td>
            <td>${utils.formatRupiah(offer.estimated_subtotal)}</td>
          </tr>
        `).join('')
      : utils.emptyRow(7, 'Tidak ada penawaran aktif untuk bahan ini.');
  }

  async function runComparison() {
    const { api, utils } = window.SmartBakery;
    const materialId = document.querySelector('#compare-material').value;
    const neededDays = Number(document.querySelector('#compare-days').value);
    const quantity = Number(document.querySelector('#compare-quantity').value);

    if (!materialId) {
      utils.showToast('Pilih bahan baku terlebih dahulu.', 'error');
      return;
    }

    const offers = await api.get('/supplier-offers/compare', {
      material_id: materialId,
      needed_days: Number.isFinite(neededDays) && neededDays >= 0 ? neededDays : 0,
      quantity: Number.isFinite(quantity) && quantity >= 0 ? quantity : 0
    });

    renderComparison(offers);
  }

  function init() {
    if (initialized) {
      return;
    }

    initialized = true;
    const { utils } = window.SmartBakery;
    const { fieldInput, fieldSelect } = utils;

    document.querySelector('#supplier-add').addEventListener('click', () => {
      utils.openModal({
        title: 'Tambah Pemasok',
        bodyHtml: `
          <div class="form-grid">
            ${fieldInput({ name: 'code', label: 'Kode pemasok', placeholder: 'SUP003' })}
            ${fieldInput({ name: 'name', label: 'Nama pemasok' })}
            ${fieldInput({ name: 'contact', label: 'Kontak', required: false, placeholder: '0812-0000-3333' })}
            ${fieldInput({ name: 'address', label: 'Alamat singkat', required: false })}
            ${fieldSelect({
              name: 'is_active',
              label: 'Status',
              options: [{ value: 1, label: 'Aktif' }, { value: 0, label: 'Nonaktif' }],
              selected: 1
            })}
          </div>
        `,
        submitLabel: 'Tambah Pemasok',
        onSubmit: async (data) => {
          await window.SmartBakery.api.post('/suppliers', {
            code: String(data.code).trim(),
            name: String(data.name).trim(),
            contact: String(data.contact ?? '').trim(),
            address: String(data.address ?? '').trim(),
            is_active: Number(data.is_active) === 1
          });

          utils.showToast('Pemasok berhasil ditambahkan.');
          await load();
        }
      });
    });

    document.querySelector('#suppliers-body').addEventListener('click', (event) => {
      const button = event.target.closest('[data-offer-supplier]');

      if (button) {
        openOfferModal(Number(button.dataset.offerSupplier));
      }
    });

    document.querySelector('#compare-run').addEventListener('click', runComparison);
  }

  async function load() {
    init();

    const { api } = window.SmartBakery;
    const compareSelect = document.querySelector('#compare-material');
    const selectedMaterial = compareSelect.value;

    const [suppliers, materials] = await Promise.all([
      api.get('/suppliers'),
      api.get('/materials')
    ]);

    materialsCache = materials;
    compareSelect.innerHTML = '<option value="">Pilih bahan baku</option>' + materials.map((item) => `
      <option value="${item.id}">${window.SmartBakery.utils.escapeHtml(item.code)} — ${window.SmartBakery.utils.escapeHtml(item.name)}</option>
    `).join('');
    compareSelect.value = materials.some((item) => String(item.id) === selectedMaterial) ? selectedMaterial : '';

    renderSuppliers(suppliers);
  }

  window.SmartBakery.suppliers = { load };
})();
