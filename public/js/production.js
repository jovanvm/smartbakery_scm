(function () {
  window.SmartBakery = window.SmartBakery || {};

  let initialized = false;
  let productsCache = [];
  let selectedPlanId = null;

  function renderPlans(plans) {
    const { utils } = window.SmartBakery;
    const body = document.querySelector('#plans-body');

    document.querySelector('#plan-count').textContent = `${plans.length} rencana`;
    body.innerHTML = plans.length
      ? plans.map((plan) => `
          <tr>
            <td>${utils.escapeHtml(plan.plan_number)}</td>
            <td>${utils.escapeHtml(plan.product_name)}</td>
            <td>${plan.quantity} ${utils.escapeHtml(plan.unit ?? '')}</td>
            <td>${utils.escapeHtml(plan.needed_date)}</td>
            <td>${utils.statusBadge(plan.status)}</td>
            <td>
              <button type="button" class="button link small" data-plan-id="${plan.id}">Lihat kebutuhan</button>
            </td>
          </tr>
        `).join('')
      : utils.emptyRow(6, 'Belum ada rencana produksi.');
  }

  async function showRequirements(planId) {
    const { api, utils } = window.SmartBakery;
    const data = await api.get(`/production-plans/${planId}/requirements`);

    selectedPlanId = planId;
    document.querySelector('#requirements-caption').textContent = data.production_plan?.plan_number ?? 'Perhitungan manual';

    document.querySelector('#requirements-summary').innerHTML = `
      <div class="detail-item">
        <span>Produk</span>
        <strong>${utils.escapeHtml(data.product.name)}</strong>
      </div>
      <div class="detail-item">
        <span>Jumlah produksi</span>
        <strong>${data.production_plan?.quantity ?? '—'} ${utils.escapeHtml(data.product.unit)}</strong>
      </div>
      <div class="detail-item">
        <span>Tanggal kebutuhan</span>
        <strong>${utils.escapeHtml(data.needed_date)} (${data.needed_days} hari)</strong>
      </div>
      <div class="detail-item">
        <span>Estimasi pembelian</span>
        <strong>${utils.formatRupiah(data.summary.estimated_total_cost)}</strong>
      </div>
      <div class="detail-item">
        <span>Bahan kurang</span>
        <strong>${data.summary.shortage_materials} dari ${data.summary.total_materials}</strong>
      </div>
      <div class="detail-item">
        <span>Risiko tenggat</span>
        <strong>${data.summary.has_deadline_risk ? '<span class="badge badge-danger">Ada</span>' : '<span class="badge badge-success">Tidak ada</span>'}</strong>
      </div>
    `;

    document.querySelector('#requirements-body').innerHTML = data.materials.length
      ? data.materials.map((item) => {
          const recommendation = item.recommended_supplier
            ? `${utils.escapeHtml(item.recommended_supplier.supplier_name)} — ${utils.formatRupiah(item.recommended_supplier.estimated_subtotal)}`
            : item.net_purchase_quantity > 0
              ? '<span class="badge badge-danger">Tidak ada yang memenuhi tenggat</span>'
              : 'Tidak perlu dibeli';

          return `
            <tr>
              <td>${utils.escapeHtml(item.code)} — ${utils.escapeHtml(item.name)}</td>
              <td>${utils.formatNumber(item.production_requirement)} ${utils.escapeHtml(item.unit)}</td>
              <td>${utils.formatNumber(item.current_stock)}</td>
              <td>${utils.formatNumber(item.safety_stock)}</td>
              <td>${utils.formatNumber(item.incoming_quantity)}</td>
              <td>${utils.formatNumber(item.net_purchase_quantity)}</td>
              <td>${utils.statusBadge(item.status)}</td>
              <td>${recommendation}</td>
            </tr>
          `;
        }).join('')
      : utils.emptyRow(8, 'Resep produk belum tersedia.');
  }

  function init() {
    if (initialized) {
      return;
    }

    initialized = true;
    const { api, utils } = window.SmartBakery;

    document.querySelector('#plan-add').addEventListener('click', () => {
      const options = [
        { value: '', label: 'Pilih produk' },
        ...productsCache.map((product) => ({
          value: product.id,
          label: `${product.code} — ${product.name} (${product.batch_size} ${product.unit})`
        }))
      ];

      utils.openModal({
        title: 'Buat Rencana Produksi',
        bodyHtml: `
          <div class="form-grid">
            ${utils.fieldInput({ name: 'plan_number', label: 'No. rencana (opsional)', required: false, placeholder: 'Dibuat otomatis jika kosong' })}
            ${utils.fieldSelect({ name: 'product_id', label: 'Produk', options })}
            ${utils.fieldInput({ name: 'quantity', label: 'Jumlah produksi', type: 'number', min: '1', step: '1' })}
            ${utils.fieldInput({ name: 'needed_date', label: 'Tanggal bahan dibutuhkan', type: 'date', value: utils.datePlusDays(2) })}
            ${utils.fieldSelect({
              name: 'status',
              label: 'Status',
              options: [{ value: 'DIRANCANG', label: 'DIRANCANG' }, { value: 'DRAFT', label: 'DRAFT' }],
              selected: 'DIRANCANG'
            })}
          </div>
        `,
        submitLabel: 'Buat Rencana',
        onSubmit: async (data) => {
          await api.post('/production-plans', {
            plan_number: String(data.plan_number ?? '').trim() || undefined,
            product_id: Number(data.product_id),
            quantity: Number(data.quantity),
            needed_date: data.needed_date,
            status: data.status
          });

          utils.showToast('Rencana produksi berhasil dibuat.');
          await load();
        }
      });
    });

    document.querySelector('#plans-body').addEventListener('click', async (event) => {
      const button = event.target.closest('[data-plan-id]');

      if (!button) {
        return;
      }

      try {
        await showRequirements(Number(button.dataset.planId));
      } catch (error) {
        utils.showToast(error.message, 'error');
      }
    });

    document.querySelector('#analyze-with-agent').addEventListener('click', () => {
      window.SmartBakery.agentContext = selectedPlanId
        ? { productionPlanId: selectedPlanId }
        : null;
    });
  }

  async function load() {
    init();

    const { api } = window.SmartBakery;
    const [plans, products] = await Promise.all([
      api.get('/production-plans'),
      api.get('/products')
    ]);

    productsCache = products;
    renderPlans(plans);

    if (selectedPlanId && !plans.some((plan) => plan.id === selectedPlanId)) {
      selectedPlanId = plans[0]?.id ?? null;
    }

    if (!selectedPlanId && plans.length > 0) {
      selectedPlanId = plans[0].id;
    }

    if (selectedPlanId) {
      await showRequirements(selectedPlanId);
    } else {
      document.querySelector('#requirements-caption').textContent = 'Pilih rencana produksi';
      document.querySelector('#requirements-summary').innerHTML = '';
      document.querySelector('#requirements-body').innerHTML = window.SmartBakery.utils.emptyRow(8, 'Belum ada rencana produksi.');
    }
  }

  window.SmartBakery.production = { load };
})();
