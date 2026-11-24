(function () {
  window.SmartBakery = window.SmartBakery || {};

  let initialized = false;
  let materialsCache = [];

  function materialOptions(selected = '') {
    return materialsCache.map((item) => {
      const isSelected = String(item.id) === String(selected) ? ' selected' : '';
      return `<option value="${item.id}"${isSelected}>${window.SmartBakery.utils.escapeHtml(item.code)} — ${window.SmartBakery.utils.escapeHtml(item.name)}</option>`;
    }).join('');
  }

  function bomRowHtml(selected = '') {
    return `
      <div class="bom-row">
        <select name="bom_material_id[]" class="input-control" required>
          <option value="">Pilih bahan</option>
          ${materialOptions(selected)}
        </select>
        <input type="number" name="bom_quantity[]" class="input-control" min="0.01" step="0.01" placeholder="Takaran per batch" required />
        <button type="button" class="button link small" data-remove-bom>Hapus</button>
      </div>
    `;
  }

  function renderProducts(products) {
    const { utils } = window.SmartBakery;
    const body = document.querySelector('#products-body');

    document.querySelector('#product-count').textContent = `${products.length} produk`;
    body.innerHTML = products.length
      ? products.map((product) => {
          const bom = product.bom_items.length
            ? `<ul class="bom-list">${product.bom_items.map((item) => `
                <li>${utils.escapeHtml(item.material_code)} — ${utils.escapeHtml(item.material_name)}: ${utils.formatNumber(item.quantity_required)} ${utils.escapeHtml(item.unit)}</li>
              `).join('')}</ul>`
            : '<span class="muted">Belum ada resep</span>';

          return `
            <tr>
              <td>${utils.escapeHtml(product.code)}</td>
              <td>${utils.escapeHtml(product.name)}</td>
              <td>${product.batch_size}</td>
              <td>${utils.escapeHtml(product.unit)}</td>
              <td>${bom}</td>
            </tr>
          `;
        }).join('')
      : utils.emptyRow(5, 'Belum ada produk.');
  }

  function init() {
    if (initialized) {
      return;
    }

    initialized = true;
    const { utils } = window.SmartBakery;

    document.querySelector('#product-add').addEventListener('click', () => {
      utils.openModal({
        title: 'Tambah Produk & Resep',
        bodyHtml: `
          <div class="form-grid">
            ${utils.fieldInput({ name: 'code', label: 'Kode produk', placeholder: 'PRD002' })}
            ${utils.fieldInput({ name: 'name', label: 'Nama produk', placeholder: 'Kue Coklat' })}
            ${utils.fieldInput({ name: 'batch_size', label: 'Ukuran batch', type: 'number', min: '1', step: '1' })}
            ${utils.fieldInput({ name: 'unit', label: 'Satuan produk', placeholder: 'roti' })}
          </div>
          <div class="bom-editor">
            <div class="bom-editor-head">
              <strong>Komposisi per Batch</strong>
              <button type="button" class="button secondary small" id="bom-add-row">Tambah Bahan</button>
            </div>
            <div id="bom-rows"></div>
          </div>
        `,
        submitLabel: 'Tambah Produk',
        onOpen: (form) => {
          const rows = form.querySelector('#bom-rows');
          const addRow = () => rows.insertAdjacentHTML('beforeend', bomRowHtml());

          addRow();
          form.querySelector('#bom-add-row').addEventListener('click', addRow);
          rows.addEventListener('click', (event) => {
            const removeButton = event.target.closest('[data-remove-bom]');

            if (removeButton) {
              removeButton.closest('.bom-row').remove();
            }
          });
        },
        onSubmit: async (data, form) => {
          const rows = [...form.querySelectorAll('.bom-row')];

          if (rows.length === 0) {
            throw new Error('Tambahkan minimal satu bahan dalam resep.');
          }

          const bomItems = rows.map((row) => ({
            material_id: Number(row.querySelector('[name="bom_material_id[]"]').value),
            quantity_required: Number(row.querySelector('[name="bom_quantity[]"]').value)
          }));

          await window.SmartBakery.api.post('/products', {
            code: String(data.code).trim(),
            name: String(data.name).trim(),
            batch_size: Number(data.batch_size),
            unit: String(data.unit).trim(),
            bom_items: bomItems
          });

          utils.showToast('Produk dan resep berhasil ditambahkan.');
          await load();
        }
      });
    });
  }

  async function load() {
    init();

    const { api } = window.SmartBakery;
    const [products, materials] = await Promise.all([
      api.get('/products'),
      api.get('/materials')
    ]);

    materialsCache = materials;
    renderProducts(products);
  }

  window.SmartBakery.products = { load };
})();
