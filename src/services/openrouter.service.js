import { HttpError } from '../middleware/error-handler.js';
import {
  ALLOWED_TOOLS,
  TOOL_DEFINITIONS,
  executeScmTool,
  recordToolCallError
} from '../tools/scm-tools.js';

const MAX_ITERATIONS = 6;
const MAX_HISTORY_ITEMS = 4;
const MAX_API_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1500;
const API_TIMEOUT_MS = 120000;
const MAX_TOOL_CONTENT_CHARS = 12000;
const MAX_HISTORY_TEXT_CHARS = 2000;
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'openai/gpt-4o-mini';

const SYSTEM_INSTRUCTION = `Kamu adalah SmartBakery Assistant, asisten operasional Supply Chain Management untuk UMKM Roti Nusa.

Aturan wajib:
- Gunakan data dari tools aplikasi sebagai satu-satunya sumber kebenaran.
- Dilarang mengarang angka stok, harga, lead time, nama pemasok, atau status pesanan. Jika data belum tersedia, katakan terus terang.
- Jangan menghitung total pembelian sendiri di teks. Gunakan hasil perhitungan backend dari tools.
- Sebelum membuat draf PO, hitung kebutuhan bahan dan bandingkan penawaran pemasok lebih dulu.
- Buat PO hanya sebagai draf berstatus MENUNGGU_PERSETUJUAN. Jangan pernah menyetujui, membatalkan, atau menerima PO.
- Jika beberapa bahan kurang berasal dari pemasok yang sama, gabungkan menjadi satu draf PO untuk pemasok itu.
- Jelaskan alasan pemilihan pemasok secara ringkas, terutama kesesuaian lead time dengan tenggat dan harga.
- Setelah draf PO dibuat, ingatkan pengguna untuk meninjau dan menyetujuinya di modul Pembelian.
- Tool yang tersedia: get_dashboard_summary, get_low_stock_items, get_inventory_list, get_production_requirements, get_supplier_offers, compare_supplier_offers, create_purchase_order_draft, get_open_purchase_orders, get_purchase_order_detail.
- Jangan memanggil tool di luar daftar tersebut.
- Kirim semua argumen numerik (ID, jumlah, hari) sebagai angka tanpa tanda kutip, bukan teks.
- Jawab dalam Bahasa Indonesia yang jelas, ringkas, dan ramah.`;

function getApiKey() {
  const apiKey = String(process.env.OPENROUTER_API_KEY ?? '').trim();

  if (!apiKey) {
    throw new HttpError(503, 'OPENROUTER_API_KEY belum diisi di file .env backend.');
  }

  return apiKey;
}

function getBaseUrl() {
  const configured = String(process.env.OPENROUTER_BASE_URL ?? '').trim() || DEFAULT_BASE_URL;
  const normalized = configured
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/, '');

  if (!/^https?:\/\//i.test(normalized)) {
    throw new HttpError(503, 'OPENROUTER_BASE_URL harus berupa URL http atau https.');
  }

  return normalized;
}

function getModelName() {
  return String(process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

function toJsonSchema(node) {
  if (Array.isArray(node)) {
    return node.map(toJsonSchema);
  }

  if (!node || typeof node !== 'object') {
    return node;
  }

  const converted = Object.fromEntries(Object.entries(node).map(([key, value]) => [
    key,
    key === 'type' && typeof value === 'string' ? value.toLowerCase() : toJsonSchema(value)
  ]));

  if (converted.type === 'object' && converted.additionalProperties === undefined) {
    converted.additionalProperties = false;
  }

  if (converted.type === 'number' || converted.type === 'integer') {
    const { type, ...rest } = converted;

    return {
      ...rest,
      anyOf: [{ type }, { type: 'string' }]
    };
  }

  return converted;
}

const OPENROUTER_TOOLS = TOOL_DEFINITIONS.map((tool) => ({
  type: 'function',
  function: {
    name: tool.name,
    description: tool.description,
    parameters: toJsonSchema(tool.parameters)
  }
}));

function normalizeHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history.slice(-MAX_HISTORY_ITEMS).flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }

    const text = String(item.text ?? item.content ?? item.message ?? '')
      .trim()
      .slice(0, MAX_HISTORY_TEXT_CHARS);
    const requestedRole = String(item.role ?? '').toLowerCase();
    const role = ['assistant', 'model', 'ai'].includes(requestedRole) ? 'assistant' : 'user';

    return text ? [{ role, content: text }] : [];
  });
}

function parseToolArguments(raw) {
  if (raw === undefined || raw === null) {
    return { args: {}, invalid: false };
  }

  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return { args: raw, invalid: false };
  }

  if (typeof raw !== 'string') {
    return { args: {}, invalid: true };
  }

  try {
    const parsed = JSON.parse(raw);

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { args: parsed, invalid: false };
    }

    return { args: {}, invalid: true };
  } catch {
    return { args: {}, invalid: true };
  }
}

function buildToolContent(payload) {
  const compact = { ...payload };

  if (compact.data !== undefined) {
    const serialized = JSON.stringify(compact.data);

    if (serialized.length > MAX_TOOL_CONTENT_CHARS) {
      compact.data = `${serialized.slice(0, MAX_TOOL_CONTENT_CHARS)}... [data dipotong]`;
    }
  }

  return JSON.stringify(compact);
}

function describeError(error) {
  const status = Number(error?.status ?? 0);
  const message = String(error?.message ?? error ?? '').trim();
  const lowered = message.toLowerCase();

  if (
    [401, 403].includes(status) ||
    lowered.includes('invalid api key') ||
    lowered.includes('authentication')
  ) {
    return `OPENROUTER_API_KEY tidak valid atau tidak memiliki akses${message ? ` (${message.slice(0, 120)})` : ''}. Periksa kembali API key di .env.`;
  }

  if (status === 402 || lowered.includes('insufficient') || lowered.includes('credit')) {
    return 'Kredit OpenRouter tidak mencukupi atau model tidak tersedia untuk akun ini.';
  }

  if (
    status === 429 ||
    lowered.includes('rate limit') ||
    lowered.includes('too many requests')
  ) {
    return 'Batas permintaan OpenRouter terlampaui. Coba lagi beberapa saat.';
  }

  if (status === 504 || lowered.includes('timeout') || lowered.includes('deadline')) {
    return 'OpenRouter timeout saat memproses permintaan. Coba lagi dengan prompt yang lebih singkat.';
  }

  if (
    [500, 502, 503].includes(status) ||
    lowered.includes('unavailable') ||
    lowered.includes('overloaded')
  ) {
    return 'Layanan OpenRouter sedang sibuk atau sementara tidak tersedia. Coba lagi beberapa saat.';
  }

  if (
    lowered.includes('fetch failed') ||
    lowered.includes('network') ||
    lowered.includes('aborted')
  ) {
    return 'Koneksi ke OpenRouter terputus. Periksa jaringan lalu coba lagi.';
  }

  return `Gagal memanggil OpenRouter: ${message.slice(0, 300) || 'kesalahan tidak diketahui'}`;
}

function isRetryableError(error) {
  const status = Number(error?.status ?? 0);

  if ([429, 500, 502, 503, 504].includes(status)) {
    return true;
  }

  const lowered = String(error?.message ?? error ?? '').toLowerCase();

  return [
    'timeout',
    'deadline',
    'aborted',
    'fetch failed',
    'network',
    'unavailable',
    'overloaded'
  ].some((marker) => lowered.includes(marker));
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function requestChatCompletion(payload) {
  const apiKey = getApiKey();
  const url = `${getBaseUrl()}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  let response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'SmartBakery SCM'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('OpenRouter timeout setelah 120 detik.');
      timeoutError.status = 504;
      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }

  let data;

  try {
    data = await response.json();
  } catch {
    const error = new Error(`Respons OpenRouter tidak valid (${response.status}).`);
    error.status = response.status;
    throw error;
  }

  if (!response.ok) {
    const detail = String(data?.error?.message ?? data?.message ?? '').slice(0, 300);
    const error = new Error(
      detail ? `OpenRouter ${response.status}: ${detail}` : `OpenRouter gagal (${response.status}).`
    );
    error.status = response.status;
    throw error;
  }

  return data;
}

export async function runAgentChat({ message, history = [] } = {}) {
  const userMessage = typeof message === 'string' ? message.trim() : '';

  if (!userMessage || userMessage.length > 4000) {
    throw new HttpError(400, 'Pesan wajib diisi dan maksimal 4000 karakter.');
  }

  const messages = [
    { role: 'system', content: SYSTEM_INSTRUCTION },
    ...normalizeHistory(history),
    { role: 'user', content: userMessage }
  ];
  const toolsCalled = [];
  const createdDraftPoIds = [];

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const payload = {
      model: getModelName(),
      messages,
      tools: OPENROUTER_TOOLS,
      tool_choice: 'auto',
      temperature: 0.2,
      max_tokens: 1200
    };
    let completion = null;

    for (let attempt = 0; attempt <= MAX_API_RETRIES; attempt += 1) {
      try {
        completion = await requestChatCompletion(payload);
        break;
      } catch (error) {
        if (!isRetryableError(error) || attempt === MAX_API_RETRIES) {
          throw new HttpError(502, describeError(error));
        }

        await wait(RETRY_BASE_DELAY_MS * (attempt + 1));
      }
    }

    const assistantMessage = completion?.choices?.[0]?.message;

    if (!assistantMessage) {
      throw new HttpError(502, 'OpenRouter tidak mengembalikan pesan assistant.');
    }

    const toolCalls = (Array.isArray(assistantMessage.tool_calls) ? assistantMessage.tool_calls : [])
      .filter((call) => call && typeof call === 'object' && !Array.isArray(call))
      .map((call, index) => ({
        id: String(call.id ?? `call_${iteration + 1}_${index + 1}`),
        type: 'function',
        function: {
          name: String(call.function?.name ?? call.name ?? '').trim().slice(0, 120),
          arguments: typeof call.function?.arguments === 'string'
            ? call.function.arguments
            : JSON.stringify(call.function?.arguments ?? {})
        }
      }));

    if (toolCalls.length === 0) {
      const reply = String(assistantMessage.content ?? '').trim();

      if (!reply) {
        throw new HttpError(502, 'OpenRouter tidak mengembalikan jawaban teks.');
      }

      return { reply, toolsCalled, createdDraftPoIds };
    }

    messages.push({
      role: 'assistant',
      content: assistantMessage.content ?? null,
      tool_calls: toolCalls
    });

    for (const call of toolCalls) {
      const name = call.function.name;
      const parsed = parseToolArguments(call.function.arguments);

      if (parsed.invalid || !name) {
        const summary = parsed.invalid
          ? 'Argumen tool tidak valid JSON.'
          : 'Nama tool tidak ditemukan.';

        await recordToolCallError({
          toolName: name || 'unknown',
          args: { raw: call.function.arguments },
          summary
        });
        toolsCalled.push({ name: name || 'unknown', status: 'ERROR', summary });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: buildToolContent({ status: 'ERROR', message: summary })
        });
        continue;
      }

      if (!ALLOWED_TOOLS.has(name)) {
        const summary = `Tool ${name} tidak dikenal atau tidak termasuk allowlist.`;

        await recordToolCallError({ toolName: name, args: parsed.args, summary });
        toolsCalled.push({ name, status: 'ERROR', summary });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: buildToolContent({ status: 'ERROR', message: summary })
        });
        continue;
      }

      try {
        const result = await executeScmTool(name, parsed.args);

        toolsCalled.push({
          name,
          status: 'SUCCESS',
          summary: result.summary
        });

        if (name === 'create_purchase_order_draft' && result.relatedPoId) {
          createdDraftPoIds.push(result.relatedPoId);
        }

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: buildToolContent({
            status: 'SUCCESS',
            summary: result.summary,
            data: result.data ?? {}
          })
        });
      } catch (error) {
        const summary = error instanceof HttpError
          ? error.message
          : `Tool ${name} gagal dijalankan.`;

        toolsCalled.push({
          name,
          status: 'ERROR',
          summary
        });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: buildToolContent({ status: 'ERROR', message: summary })
        });
      }
    }
  }

  throw new HttpError(500, 'Agent melebihi batas maksimal iterasi tool calling.');
}
