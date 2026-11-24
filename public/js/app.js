window.SmartBakery = window.SmartBakery || {};

const routes = {
  dashboard: {
    title: 'Dashboard',
    breadcrumb: 'Beranda / Dashboard'
  },
  inventory: {
    title: 'Persediaan',
    breadcrumb: 'SCM / Persediaan'
  },
  suppliers: {
    title: 'Pemasok',
    breadcrumb: 'SCM / Pemasok'
  },
  products: {
    title: 'Produk & Resep',
    breadcrumb: 'SCM / Produk & Resep'
  },
  production: {
    title: 'Rencana Produksi',
    breadcrumb: 'SCM / Rencana Produksi'
  },
  procurement: {
    title: 'Pembelian',
    breadcrumb: 'SCM / Pembelian'
  },
  agent: {
    title: 'AI Agent',
    breadcrumb: 'SCM / AI Agent'
  },
  logs: {
    title: 'Riwayat Aktivitas',
    breadcrumb: 'SCM / Riwayat Aktivitas'
  }
};

const sidebar = document.querySelector('#sidebar');
const sidebarToggle = document.querySelector('#sidebar-toggle');
const sidebarOverlay = document.querySelector('#sidebar-overlay');
const pageTitle = document.querySelector('#page-title');
const breadcrumb = document.querySelector('#breadcrumb');
const navItems = document.querySelectorAll('.nav-item');
const sections = document.querySelectorAll('[data-section]');
const modal = document.querySelector('#modal');
const modalTitle = document.querySelector('#modal-title');
const modalBody = document.querySelector('#modal-body');
const modalForm = document.querySelector('#modal-form');
const modalClose = document.querySelector('#modal-close');
const modalCancel = document.querySelector('#modal-cancel');
const modalSubmit = document.querySelector('#modal-submit');
const toast = document.querySelector('#toast');

let modalSubmitHandler = null;
let toastTimer = null;
let loadSequence = 0;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatRupiah(value) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(Number(value) || 0);
}

function formatNumber(value) {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(Number(value) || 0);
}

function datePlusDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function statusBadge(status) {
  const labels = {
    AMAN: 'aman',
    PERLU_DIBELI: 'perlu dibeli',
    KURANG: 'kurang',
    CUKUP: 'cukup',
    DRAFT: 'draft',
    MENUNGGU_PERSETUJUAN: 'menunggu persetujuan',
    DISETUJUI: 'disetujui',
    DITERIMA: 'diterima',
    DIBATALKAN: 'dibatalkan',
    DIRANCANG: 'dirancang',
    SUCCESS: 'berhasil',
    ERROR: 'gagal'
  };

  const tones = {
    AMAN: 'success',
    CUKUP: 'success',
    DITERIMA: 'success',
    SUCCESS: 'success',
    PERLU_DIBELI: 'warning',
    KURANG: 'warning',
    MENUNGGU_PERSETUJUAN: 'warning',
    DRAFT: 'neutral',
    DIRANCANG: 'info',
    DISETUJUI: 'info',
    DIBATALKAN: 'muted',
    ERROR: 'danger'
  };

  const tone = tones[status] ?? 'neutral';
  return `<span class="badge badge-${tone}">${escapeHtml(labels[status] ?? status)}</span>`;
}

function emptyRow(colspan, message) {
  return `<tr><td colspan="${colspan}"><div class="empty-state">${escapeHtml(message)}</div></td></tr>`;
}

function fieldInput({
  name,
  label,
  value = '',
  type = 'text',
  required = true,
  min = '',
  step = '',
  placeholder = ''
}) {
  const attributes = [
    `id="field-${escapeHtml(name)}"`,
    `name="${escapeHtml(name)}"`,
    `type="${escapeHtml(type)}"`,
    `value="${escapeHtml(value)}"`,
    required ? 'required' : '',
    min === '' ? '' : `min="${escapeHtml(min)}"`,
    step === '' ? '' : `step="${escapeHtml(step)}"`,
    placeholder ? `placeholder="${escapeHtml(placeholder)}"` : ''
  ].filter(Boolean).join(' ');

  return `<label class="field" for="field-${escapeHtml(name)}"><span>${escapeHtml(label)}</span><input ${attributes} /></label>`;
}

function fieldSelect({ name, label, options, selected = '', required = true }) {
  const optionMarkup = options.map((option) => {
    const value = String(option.value);
    const isSelected = value === String(selected) ? ' selected' : '';
    return `<option value="${escapeHtml(value)}"${isSelected}>${escapeHtml(option.label)}</option>`;
  }).join('');

  return `
    <label class="field" for="field-${escapeHtml(name)}">
      <span>${escapeHtml(label)}</span>
      <select id="field-${escapeHtml(name)}" name="${escapeHtml(name)}" ${required ? 'required' : ''}>
        ${optionMarkup}
      </select>
    </label>
  `;
}

function showToast(message, type = 'success') {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast toast-${type}`;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 4000);
}

function closeModal() {
  modal.hidden = true;
  modalBody.innerHTML = '';
  modalSubmitHandler = null;
  document.body.classList.remove('modal-open');
}

function openModal({ title, bodyHtml, submitLabel = 'Simpan', onSubmit, onOpen }) {
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHtml;
  modalSubmit.textContent = submitLabel;
  modalSubmitHandler = onSubmit;
  modal.hidden = false;
  document.body.classList.add('modal-open');

  if (typeof onOpen === 'function') {
    onOpen(modalForm);
  }

  const firstField = modalForm.querySelector('input, select, textarea');
  if (firstField) {
    firstField.focus();
  }
}

async function request(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  let response;

  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers
    });
  } catch {
    throw new Error('Tidak dapat terhubung ke server. Pastikan npm run dev berjalan di port 3000.');
  }

  let payload = null;

  try {
    payload = await response.json();
  } catch {
    throw new Error('Respons server tidak valid.');
  }

  if (!response.ok) {
    throw new Error(payload?.message ?? `Permintaan gagal (${response.status}).`);
  }

  return payload;
}

const api = {
  request,
  get(path, params = {}) {
    const query = new URLSearchParams();

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        query.set(key, String(value));
      }
    });

    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request(`${path}${suffix}`);
  },
  post(path, body) {
    return request(path, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  },
  put(path, body) {
    return request(path, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
  }
};

window.SmartBakery.api = api;
window.SmartBakery.utils = {
  escapeHtml,
  formatRupiah,
  formatNumber,
  datePlusDays,
  statusBadge,
  emptyRow,
  fieldInput,
  fieldSelect,
  showToast,
  openModal,
  closeModal,
  confirmAction(message) {
    return window.confirm(message);
  }
};

function closeSidebar() {
  sidebar.classList.remove('is-open');
  sidebarOverlay.hidden = true;
  sidebarToggle.setAttribute('aria-expanded', 'false');
}

function openSidebar() {
  sidebar.classList.add('is-open');
  sidebarOverlay.hidden = false;
  sidebarToggle.setAttribute('aria-expanded', 'true');
}

async function loadRoute(route) {
  const module = window.SmartBakery[route];
  const sequence = ++loadSequence;

  if (!module || typeof module.load !== 'function') {
    return;
  }

  try {
    await module.load();

    if (sequence !== loadSequence) {
      return;
    }
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function setRoute(route, updateHash = true) {
  const activeRoute = Object.hasOwn(routes, route) ? route : 'dashboard';

  sections.forEach((section) => {
    section.hidden = section.dataset.section !== activeRoute;
  });

  navItems.forEach((item) => {
    const isActive = item.dataset.route === activeRoute;
    item.classList.toggle('active', isActive);

    if (isActive) {
      item.setAttribute('aria-current', 'page');
    } else {
      item.removeAttribute('aria-current');
    }
  });

  pageTitle.textContent = routes[activeRoute].title;
  breadcrumb.textContent = routes[activeRoute].breadcrumb;

  if (updateHash && window.location.hash !== `#${activeRoute}`) {
    window.history.pushState(null, '', `#${activeRoute}`);
  }

  closeSidebar();
  loadRoute(activeRoute);
}

sidebarToggle.addEventListener('click', () => {
  if (sidebar.classList.contains('is-open')) {
    closeSidebar();
  } else {
    openSidebar();
  }
});

sidebarOverlay.addEventListener('click', closeSidebar);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!modal.hidden) {
      closeModal();
    } else {
      closeSidebar();
    }
  }
});

document.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-route]');

  if (!trigger) {
    return;
  }

  event.preventDefault();
  setRoute(trigger.dataset.route);
});

modalClose.addEventListener('click', closeModal);
modalCancel.addEventListener('click', closeModal);

modal.addEventListener('click', (event) => {
  if (event.target === modal) {
    closeModal();
  }
});

modalForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (typeof modalSubmitHandler !== 'function') {
    return;
  }

  const formData = Object.fromEntries(new FormData(modalForm).entries());
  modalSubmit.disabled = true;

  try {
    await modalSubmitHandler(formData, modalForm);
    closeModal();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    modalSubmit.disabled = false;
  }
});

window.addEventListener('popstate', () => {
  setRoute(window.location.hash.replace('#', ''), false);
});

window.addEventListener('hashchange', () => {
  setRoute(window.location.hash.replace('#', ''), false);
});

setRoute(window.location.hash.replace('#', ''), false);
