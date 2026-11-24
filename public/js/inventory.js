(function () {
  window.SmartBakery = window.SmartBakery || {};

  let initialized = false;
  let cachedMaterials = [];
  let searchTimer = null;

  function formFields(material = {}) {
    const { fieldInput } = window.SmartBakery.utils;

    return `
      <div class="form-grid">
        ${fieldInput({ name: 'code', label: 'Kode bahan', value: material.code ?? '', placeholder: 'BB005' })}
        ${fieldInput({ name: 'name', label: 'Nama bahan', value: material.name ?? '', placeholder: 'Keju' })}
        ${fieldInput({ name: 'category', label: 'Kategori', value: material.category ?? '', placeholder: 'Bahan dingin' })}
        ${fieldInput({ name: 'unit', label: 'Satuan', value: material.unit ?? '', placeholder: 'kg' })}
        ${fieldInput({ name: 'current_stock', label: 'Stok tersedia', value: material.current_stock ?? 0, type: 'number', min: '0', step: '0.01' })}
        ${fieldInput({ name: 'safety_stock', label: 'Stok pengaman', value: material.safety_stock ?? 0, type: 'number', min: '0', step: '0.01' })}
      </div>
    `;
  }

  function openMaterialModal(material = null) {
    const { utils } = window.SmartBakery;
    const isEdit = material !== null;

    utils.openModal({
      title: isEdit ? `Edit ${material.name}` : 'Tambah Bahan Baku',
      bodyHtml: formFields(material),
      submitLabel: isEdit ? 'Simpan Perubahan' : 'Tambah Bahan',
      onSubmit: async (data) => {
        const payload = {
          code: String(data.code).trim(),
          name: String(data.name).trim(),
          category: String(data.category).trim(),
          unit: String(data.unit).trim(),
          current_stock: Number(data.current_stock),
          safety_stock: Number(data.safety_stock)
        };

        if (isEdit) {
          await window.SmartBakery.api.put(`/materials/${material.id}`, payload);
          utils.showToast('Bahan baku berhasil diperbarui.');
        } else {
          await window.SmartBakery.api.post('/materials', payload);
          utils.showToast('Bahan baku berhasil ditambahkan.');
        }

        await load();
      }
    });
  }

  async function populateFilters() {
    const { api } = window.SmartBakery;
    const categorySelect = document.querySelector('#inventory-category');
    const movementSelect = document.querySelector('#movement-material');
    const selectedCategory = categorySelect.value;
    const selectedMovement = movementSelect.value;

    cachedMaterials = await api.get('/materials');
    const categories = [...new Set(cachedMaterials.map((item) => item.category))].sort();

    categorySelect.innerHTML = '<option value="">Semua kategori</option>' + categories.map((category) => `
      <option value="${window.SmartBakery.utils.escapeHtml(category)}">${window.SmartBakery.utils.escapeHtml(category)}</option>
    `).join('');
    categorySelect.value = categories.includes(selectedCategory) ? selectedCategory : '';

    movementSelect.innerHTML = '<option value="">Semua bahan</option>' + cachedMaterials.map((item) => `
      <option value="${item.id}">${window.SmartBakery.utils.escapeHtml(item.code)} — ${window.SmartBakery.utils.escapeHtml(item.name)}</option>
    `).join('');
    movementSelect.value = cachedMaterials.some((item) => String(item.id) === selectedMovement) ? selectedMovement : '';
  }

  async function refreshMaterials() {
    const { api, utils } = window.SmartBakery;
    const params = {
      search: document.querySelector('#inventory-search').value.trim(),
      category: document.querySelector('#inventory-category').value,
      status: document.querySelector('#inventory-status').value
    };

    const materials = await api.get('/materials', params);
    document.querySelector('#inventory-count').textContent = `${materials.length} bahan`;

    document.querySelector('#inventory-body').innerHTML = materials.length
      ? materials.map((item) => `
          <tr>
            <td>${utils.escapeHtml(item.code)}</td>
            <td>${utils.escapeHtml(item.name)}</td>
            <td>${utils.escapeHtml(item.category)}</td>
            <td>${utils.formatNumber(item.current_stock)}</td>
            <td>${utils.formatNumber(item.safety_stock)}</td>
            <td>${utils.statusBadge(item.status)}</td>
            <td>
              <button type="button" class="button link small" data-edit-material="${item.id}">Edit</button>
            </td>
          </tr>
        `).join('')
      : utils.emptyRow(7, 'Tidak ada bahan yang cocok dengan filter.');
  }

  async function refreshMovements() {
    const { api, utils } = window.SmartBakery;
    const materialId = document.querySelector('#movement-material').value;
    const movements = await api.get('/movements', {
      material_id: materialId,
      limit: 100
    });

    document.querySelector('#movements-body').innerHTML = movements.length
      ? movements.map((movement) => `
          <tr>
            <td>${utils.escapeHtml(movement.created_at)}</td>
            <td>${utils.escapeHtml(movement.material_code)} — ${utils.escapeHtml(movement.material_name)}</td>
            <td>${utils.statusBadge(movement.movement_type)}</td>
            <td>${movement.quantity_change > 0 ? '+' : ''}${utils.formatNumber(movement.quantity_change)}</td>
            <td>${movement.reference_id ? `${utils.escapeHtml(movement.reference_type)} #${movement.reference_id}` : '—'}</td>
            <td>${utils.escapeHtml(movement.notes ?? '—')}</td>
          </tr>
        `).join('')
      : utils.emptyRow(6, 'Belum ada pergerakan stok.');
  }

  function init() {
    if (initialized) {
      return;
    }

    initialized = true;

    const searchInput = document.querySelector('#inventory-search');
    searchInput.addEventListener('input', () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(refreshMaterials, 250);
    });

    document.querySelector('#inventory-category').addEventListener('change', refreshMaterials);
    document.querySelector('#inventory-status').addEventListener('change', refreshMaterials);
    document.querySelector('#movement-material').addEventListener('change', refreshMovements);
    document.querySelector('#inventory-add').addEventListener('click', () => openMaterialModal());

    document.querySelector('#inventory-body').addEventListener('click', (event) => {
      const button = event.target.closest('[data-edit-material]');

      if (!button) {
        return;
      }

      const material = cachedMaterials.find((item) => item.id === Number(button.dataset.editMaterial));

      if (material) {
        openMaterialModal(material);
      }
    });
  }

  async function load() {
    init();
    await populateFilters();
    await Promise.all([refreshMaterials(), refreshMovements()]);
  }

  window.SmartBakery.inventory = { load };
})();
