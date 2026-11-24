(function () {
  window.SmartBakery = window.SmartBakery || {};

  let initialized = false;
  let busy = false;
  const conversation = [];

  function renderMessages() {
    const { utils } = window.SmartBakery;
    const container = document.querySelector('#chat-messages');

    container.innerHTML = conversation.length
      ? conversation.map((item) => `
          <div class="chat-message chat-${item.role}">
            <div class="chat-avatar">${item.role === 'user' ? 'AN' : 'SA'}</div>
            <div class="chat-bubble">
              <div class="chat-role">${item.role === 'user' ? 'Admin Roti Nusa' : 'SmartBakery Assistant'}</div>
              <div class="chat-text">${utils.escapeHtml(item.text).replaceAll('\n', '<br>')}</div>
            </div>
          </div>
        `).join('')
      : `
          <div class="chat-empty">
            <strong>SmartBakery Assistant siap membantu.</strong>
            <span>Tanyakan stok, kebutuhan produksi, perbandingan pemasok, atau minta draf PO.</span>
          </div>
        `;

    container.scrollTop = container.scrollHeight;
  }

  function renderTools(toolsCalled, createdDraftPoIds) {
    const { utils } = window.SmartBakery;
    const trail = document.querySelector('#agent-tools');

    trail.innerHTML = toolsCalled.length
      ? toolsCalled.map((tool, index) => `
          <div class="tool-step">
            <span class="tool-step-number">${index + 1}</span>
            <div>
              <div class="tool-step-head">
                <code>${utils.escapeHtml(tool.name)}</code>
                ${tool.status === 'SUCCESS' ? '<span class="badge badge-success">SUCCESS</span>' : '<span class="badge badge-danger">ERROR</span>'}
              </div>
              <p>${utils.escapeHtml(tool.summary ?? '')}</p>
            </div>
          </div>
        `).join('')
      : '<span class="muted">Belum ada tool yang dijalankan pada balasan terakhir.</span>';

    const result = document.querySelector('#agent-result');

    if (createdDraftPoIds.length > 0) {
      const poId = createdDraftPoIds[createdDraftPoIds.length - 1];
      window.SmartBakery.lastDraftPoId = poId;
      result.hidden = false;
      result.innerHTML = `
        <div>
          <strong>Draf PO berhasil dibuat</strong>
          <p>ID PO #${poId} menunggu tinjauan Anda. Stok belum bertambah sampai barang diterima.</p>
        </div>
        <button type="button" class="button primary small" data-route="procurement">Lihat Detail Draft PO</button>
      `;
    } else {
      result.hidden = true;
      result.innerHTML = '';
    }
  }

  function setBusy(value) {
    busy = value;
    document.querySelector('#chat-input').disabled = value;
    document.querySelector('#chat-send').disabled = value;
    document.querySelector('#chat-loading').hidden = !value;
  }

  async function sendMessage(rawMessage) {
    if (busy) {
      return;
    }

    const message = String(rawMessage ?? '').trim();

    if (!message) {
      return;
    }

    const { api, utils } = window.SmartBakery;
    const history = conversation.slice(0, -1).map((item) => ({
      role: item.role,
      text: item.text
    }));

    conversation.push({ role: 'user', text: message });
    renderMessages();
    setBusy(true);

    try {
      const payload = await api.post('/agent/chat', { message, history });

      conversation.push({
        role: 'assistant',
        text: String(payload.reply ?? '').trim() || 'Agent tidak mengembalikan jawaban.'
      });
      renderMessages();
      renderTools(payload.toolsCalled ?? [], payload.createdDraftPoIds ?? []);
    } catch (error) {
      utils.showToast(error.message, 'error');
      conversation.push({
        role: 'assistant',
        text: `Maaf, permintaan belum berhasil diproses.\n\n${error.message}`
      });
      renderMessages();
    } finally {
      setBusy(false);
    }
  }

  function init() {
    if (initialized) {
      return;
    }

    initialized = true;

    document.querySelector('#chat-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const input = document.querySelector('#chat-input');
      const message = input.value;
      input.value = '';
      sendMessage(message);
    });

    document.querySelector('#quick-prompts').addEventListener('click', (event) => {
      const button = event.target.closest('[data-prompt]');

      if (button) {
        sendMessage(button.dataset.prompt);
      }
    });
  }

  async function load() {
    init();
    renderMessages();
    renderTools([], []);

    const context = window.SmartBakery.agentContext;
    const contextChip = document.querySelector('#agent-context');
    const input = document.querySelector('#chat-input');

    if (context?.productionPlanId) {
      contextChip.hidden = false;
      contextChip.textContent = `Konteks: rencana produksi #${context.productionPlanId}`;
      input.value = `Analisis kebutuhan bahan untuk rencana produksi ID ${context.productionPlanId}. Bandingkan pemasok yang memenuhi tenggat, lalu buatkan draf PO untuk bahan yang kurang. Jangan setujui PO.`;
    } else {
      contextChip.hidden = true;
    }
  }

  window.SmartBakery.agent = { load, sendMessage };
})();
