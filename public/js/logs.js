(function () {
  window.SmartBakery = window.SmartBakery || {};

  let initialized = false;

  function shorten(value, maximum) {
    const text = String(value ?? '');
    return text.length > maximum ? `${text.slice(0, maximum)}…` : text;
  }

  function render(logs) {
    const { utils } = window.SmartBakery;
    const body = document.querySelector('#logs-body');

    document.querySelector('#logs-count').textContent = `${logs.length} aktivitas`;
    body.innerHTML = logs.length
      ? logs.map((log) => `
          <tr>
            <td>${utils.escapeHtml(log.created_at)}</td>
            <td>${utils.escapeHtml(log.triggered_by)}</td>
            <td><code>${utils.escapeHtml(log.tool_name)}</code></td>
            <td><code>${utils.escapeHtml(shorten(JSON.stringify(log.arguments ?? {}), 140))}</code></td>
            <td>${utils.escapeHtml(shorten(log.result_summary ?? '—', 180))}</td>
            <td>${utils.statusBadge(log.status)}</td>
            <td>${log.related_po_id ? `#${log.related_po_id}` : '—'}</td>
          </tr>
        `).join('')
      : utils.emptyRow(7, 'Belum ada aktivitas agent yang tercatat.');
  }

  async function load() {
    init();

    const { api } = window.SmartBakery;
    const status = document.querySelector('#logs-status').value;
    const logs = await api.get('/agent/logs', { status });

    render(logs);
  }

  function init() {
    if (initialized) {
      return;
    }

    initialized = true;

    document.querySelector('#logs-status').addEventListener('change', load);
    document.querySelector('#logs-refresh').addEventListener('click', load);
  }

  window.SmartBakery.logs = { load };
})();
