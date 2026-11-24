(function () {
  window.SmartBakery = window.SmartBakery || {};

  async function load() {
    const { api, utils } = window.SmartBakery;
    const data = await api.get('/dashboard');

    document.querySelector('#kpi-materials').textContent = data.kpi.total_materials;
    document.querySelector('#kpi-critical').textContent = data.kpi.critical_materials;
    document.querySelector('#kpi-plans').textContent = data.kpi.active_production_plans;
    document.querySelector('#kpi-po').textContent = data.kpi.pending_purchase_orders;

    const lowStockBody = document.querySelector('#dashboard-low-stock');
    lowStockBody.innerHTML = data.low_stock_items.length
      ? data.low_stock_items.map((item) => `
          <tr>
            <td>${utils.escapeHtml(item.code)}</td>
            <td>${utils.escapeHtml(item.name)}</td>
            <td>${utils.escapeHtml(item.category)}</td>
            <td>${utils.formatNumber(item.current_stock)} ${utils.escapeHtml(item.unit)}</td>
            <td>${utils.formatNumber(item.safety_stock)} ${utils.escapeHtml(item.unit)}</td>
            <td>${utils.statusBadge(item.status)}</td>
          </tr>
        `).join('')
      : utils.emptyRow(6, 'Tidak ada bahan kritis saat ini.');

    const recentPoBody = document.querySelector('#dashboard-recent-po');
    recentPoBody.innerHTML = data.recent_purchase_orders.length
      ? data.recent_purchase_orders.map((order) => `
          <tr>
            <td>${utils.escapeHtml(order.po_number)}</td>
            <td>${utils.escapeHtml(order.supplier_name)}</td>
            <td>${utils.escapeHtml(order.expected_arrival_date)}</td>
            <td>${utils.formatRupiah(order.total_amount)}</td>
            <td>${utils.statusBadge(order.status)}</td>
          </tr>
        `).join('')
      : utils.emptyRow(5, 'Belum ada purchase order.');

    const chart = document.querySelector('#dashboard-stock-chart');
    chart.innerHTML = data.stock_comparison.length
      ? data.stock_comparison.map((item) => {
          const maximum = Math.max(item.current_stock, item.safety_stock, 1);
          const currentWidth = Math.min(100, (item.current_stock / maximum) * 100);
          const safetyPosition = Math.min(100, (item.safety_stock / maximum) * 100);

          return `
            <div class="stock-bar-row">
              <div class="stock-bar-label">
                <strong>${utils.escapeHtml(item.name)}</strong>
                <span>${utils.formatNumber(item.current_stock)} / ${utils.formatNumber(item.safety_stock)} ${utils.escapeHtml(item.unit)}</span>
              </div>
              <div class="stock-track">
                <div class="stock-fill ${item.status === 'PERLU_DIBELI' ? 'stock-fill-warning' : ''}" style="width: ${currentWidth.toFixed(1)}%"></div>
                <div class="stock-marker" style="left: ${safetyPosition.toFixed(1)}%" title="Stok pengaman"></div>
              </div>
            </div>
          `;
        }).join('')
      : '<div class="empty-state">Belum ada data stok.</div>';
  }

  window.SmartBakery.dashboard = { load };
})();
