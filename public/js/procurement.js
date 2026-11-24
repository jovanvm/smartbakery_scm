(function () {
  window.SmartBakery = window.SmartBakery || {};

  let initialized = false;
  let selectedPoId = null;

  function renderList(orders) {
    const { utils } = window.SmartBakery;
    const body = document.querySelector('#po-body');

    document.querySelector('#po-count').textContent = `${orders.length} PO`;
    body.innerHTML = orders.length
      ? orders.map((order) => `
          <tr class="${order.id === selectedPoId ? 'row-selected' : ''}" data-po-row="${order.id}">
            <td>${utils.escapeHtml(order.po_number)}</td>
            <td>${utils.escapeHtml(order.supplier_name)}</td>
            <td>${utils.escapeHtml(order.expected_arrival_date)}</td>
            <td>${utils.formatRupiah(order.total_amount)}</td>
            <td>${utils.statusBadge(order.status)}</td>
          </tr>
        `).join('')
      : utils.emptyRow(5, 'Belum ada purchase order.');
  }

  function renderDetail(detail) {
    const { utils } = window.SmartBakery;

    document.querySelector('#po-detail-title').textContent = detail.po_number;
    document.querySelector('#po-detail-grid').innerHTML = `
      <div class="detail-item">
        <span>Pemasok</span>
        <strong>${utils.escapeHtml(detail.supplier_name)}</strong>
      </div>
      <div class="detail-item">
        <span>Estimasi tiba</span>
        <strong>${utils.escapeHtml(detail.expected_arrival_date)}</strong>
      </div>
      <div class="detail-item">
        <span>Status</span>
        <strong>${utils.statusBadge(detail.status)}</strong>
      </div>
      <div class="detail-item">
        <span>Total PO</span>
        <strong>${utils.formatRupiah(detail.total_amount)}</strong>
      </div>
    `;

    document.querySelector('#po-items-body').innerHTML = detail.items.length
      ? detail.items.map((item) => `
          <tr>
            <td>${utils.escapeHtml(item.material_code)} — ${utils.escapeHtml(item.material_name)}</td>
            <td>${utils.formatNumber(item.quantity)} ${utils.escapeHtml(item.unit)}</td>
            <td>${utils.formatRupiah(item.unit_price)}</td>
            <td>${utils.formatRupiah(item.subtotal)}</td>
          </tr>
        `).join('')
      : utils.emptyRow(4, 'Tidak ada item pada PO ini.');

    const canApprove = ['DRAFT', 'MENUNGGU_PERSETUJUAN'].includes(detail.status);
    const canCancel = ['DRAFT', 'MENUNGGU_PERSETUJUAN', 'DISETUJUI'].includes(detail.status);
    const canReceive = detail.status === 'DISETUJUI';

    document.querySelector('#po-approve').disabled = !canApprove;
    document.querySelector('#po-cancel').disabled = !canCancel;
    document.querySelector('#po-receive').disabled = !canReceive;
  }

  function clearDetail() {
    document.querySelector('#po-detail-title').textContent = 'Rincian PO';
    document.querySelector('#po-detail-grid').innerHTML = '';
    document.querySelector('#po-items-body').innerHTML = window.SmartBakery.utils.emptyRow(4, 'Pilih PO untuk melihat rincian.');
    document.querySelector('#po-approve').disabled = true;
    document.querySelector('#po-cancel').disabled = true;
    document.querySelector('#po-receive').disabled = true;
  }

  async function showDetail(poId) {
    const detail = await window.SmartBakery.api.get(`/purchase-orders/${poId}`);
    selectedPoId = poId;
    renderDetail(detail);
  }

  async function performAction(action) {
    if (!selectedPoId) {
      return;
    }

    const { utils, api } = window.SmartBakery;
    const messages = {
      approve: 'Setujui purchase order ini? Stok belum akan bertambah.',
      cancel: 'Batalkan purchase order ini? Tindakan ini bersifat final.',
      receive: 'Terima barang dan tambahkan stok gudang sekarang?'
    };

    if (!utils.confirmAction(messages[action])) {
      return;
    }

    await api.post(`/purchase-orders/${selectedPoId}/${action}`);
    utils.showToast(action === 'receive' ? 'Barang diterima dan stok diperbarui.' : `PO berhasil ${action === 'approve' ? 'disetujui' : 'dibatalkan'}.`);
    await load();
  }

  function init() {
    if (initialized) {
      return;
    }

    initialized = true;

    document.querySelector('#po-status').addEventListener('change', load);
    document.querySelector('#po-approve').addEventListener('click', () => performAction('approve'));
    document.querySelector('#po-cancel').addEventListener('click', () => performAction('cancel'));
    document.querySelector('#po-receive').addEventListener('click', () => performAction('receive'));

    document.querySelector('#po-body').addEventListener('click', async (event) => {
      const row = event.target.closest('[data-po-row]');

      if (!row) {
        return;
      }

      try {
        await showDetail(Number(row.dataset.poRow));
        renderList(await window.SmartBakery.api.get('/purchase-orders', {
          status: document.querySelector('#po-status').value
        }));
      } catch (error) {
        window.SmartBakery.utils.showToast(error.message, 'error');
      }
    });
  }

  async function load() {
    init();

    const { api } = window.SmartBakery;
    const status = document.querySelector('#po-status').value;
    const orders = await api.get('/purchase-orders', { status });

    if (selectedPoId && !orders.some((order) => order.id === selectedPoId)) {
      selectedPoId = orders[0]?.id ?? null;
    }

    if (!selectedPoId && orders.length > 0) {
      selectedPoId = orders[0].id;
    }

    renderList(orders);

    if (selectedPoId) {
      await showDetail(selectedPoId);
      renderList(orders);
    } else {
      clearDetail();
    }
  }

  window.SmartBakery.procurement = { load };
})();
