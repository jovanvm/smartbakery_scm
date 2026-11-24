import { db } from '../database/db.js';
import { HttpError } from '../middleware/error-handler.js';
import {
  calculateProductionRequirements,
  compareSupplierOffers,
  formatDateInput,
  getStockStatus
} from '../services/scm-calculation.service.js';
import {
  createPurchaseOrderDraft,
  getPurchaseOrderDetail,
  getPurchaseOrders
} from '../services/procurement.service.js';

const OPEN_PO_STATUSES = ['DRAFT', 'MENUNGGU_PERSETUJUAN', 'DISETUJUI'];

function requirePositiveInteger(value, label) {
  const number = Number(value);

  if (
    value === '' ||
    value === null ||
    value === undefined ||
    !Number.isInteger(number) ||
    number <= 0
  ) {
    throw new HttpError(400, `${label} harus berupa bilangan bulat positif.`);
  }

  return number;
}

function requireNonNegativeInteger(value, label) {
  const number = Number(value);

  if (
    value === '' ||
    value === null ||
    value === undefined ||
    !Number.isInteger(number) ||
    number < 0
  ) {
    throw new HttpError(400, `${label} harus berupa bilangan bulat minimal 0.`);
  }

  return number;
}

function requirePositiveNumber(value, label) {
  const number = Number(value);

  if (value === '' || value === null || value === undefined || !Number.isFinite(number) || number <= 0) {
    throw new HttpError(400, `${label} harus lebih besar dari 0.`);
  }

  return number;
}

function requireString(value, label, maxLength = 255) {
  const text = typeof value === 'string' ? value.trim() : '';

  if (!text || text.length > maxLength) {
    throw new HttpError(400, `${label} wajib diisi dan maksimal ${maxLength} karakter.`);
  }

  return text;
}

function requireDate(value, label) {
  const text = String(value ?? '');

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new HttpError(400, `${label} harus berformat YYYY-MM-DD.`);
  }

  const date = new Date(`${text}T00:00:00`);

  if (Number.isNaN(date.getTime()) || formatDateInput(date) !== text) {
    throw new HttpError(400, `${label} tidak valid.`);
  }

  return text;
}

function optionalValue(value) {
  return value !== undefined && value !== null && value !== '' ? value : undefined;
}

function defaultNeededDate() {
  const date = new Date();
  date.setDate(date.getDate() + 2);
  return formatDateInput(date);
}

function truncate(value, maximum) {
  const text = String(value ?? '');
  return text.length > maximum ? `${text.slice(0, maximum)}…` : text;
}

function parseArgumentsJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

async function logToolCall({ toolName, args, status, summary, relatedPoId = null }) {
  try {
    await db.prepare(`
      INSERT INTO agent_logs (
        triggered_by,
        tool_name,
        arguments_json,
        result_summary,
        status,
        related_po_id
      )
      VALUES ('AI Agent', ?, ?, ?, ?, ?)
    `).run(
      toolName,
      truncate(JSON.stringify(args ?? {}), 4000),
      truncate(summary, 800),
      status,
      relatedPoId
    );
  } catch (error) {
    console.error('[agent-log]', error.message);
  }
}

export async function recordToolCallError({ toolName, args, summary }) {
  await logToolCall({
    toolName: String(toolName ?? 'unknown'),
    args,
    status: 'ERROR',
    summary: String(summary ?? 'Tool gagal dijalankan.')
  });
}

async function getDashboardData() {
  const kpi = {
    total_materials: (await db.prepare('SELECT COUNT(*) AS total FROM materials').get()).total,
    critical_materials: (await db.prepare(
      'SELECT COUNT(*) AS total FROM materials WHERE current_stock <= safety_stock'
    ).get()).total,
    active_production_plans: (await db.prepare(
      "SELECT COUNT(*) AS total FROM production_plans WHERE status IN ('DRAFT', 'DIRANCANG')"
    ).get()).total,
    pending_purchase_orders: (await db.prepare(
      "SELECT COUNT(*) AS total FROM purchase_orders WHERE status IN ('DRAFT', 'MENUNGGU_PERSETUJUAN')"
    ).get()).total
  };

  const lowStockItems = (await db.prepare(`
    SELECT id, code, name, category, current_stock, safety_stock, unit
    FROM materials
    WHERE current_stock <= safety_stock
    ORDER BY code
  `).all()).map((row) => ({
    ...row,
    status: getStockStatus(row.current_stock, row.safety_stock)
  }));

  const recentPurchaseOrders = await db.prepare(`
    SELECT
      po.id,
      po.po_number,
      po.expected_arrival_date,
      po.status,
      po.total_amount,
      s.name AS supplier_name
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    ORDER BY po.created_at DESC, po.id DESC
    LIMIT 5
  `).all();

  return {
    kpi,
    low_stock_items: lowStockItems,
    recent_purchase_orders: recentPurchaseOrders
  };
}

const TOOL_HANDLERS = {
  get_dashboard_summary: {
    description: 'Mengambil ringkasan KPI dashboard, bahan stok kritis, dan PO terbaru dari database.',
    parameters: {
      type: 'OBJECT',
      properties: {},
      required: []
    },
    validate: () => ({}),
    execute: async () => {
      const data = await getDashboardData();
      return {
        data,
        summary: `Ringkasan: ${data.kpi.total_materials} bahan, ${data.kpi.critical_materials} kritis, ${data.kpi.pending_purchase_orders} PO menunggu persetujuan.`
      };
    }
  },

  get_low_stock_items: {
    description: 'Mengambil daftar bahan baku yang stoknya kurang dari atau sama dengan stok pengaman.',
    parameters: {
      type: 'OBJECT',
      properties: {},
      required: []
    },
    validate: () => ({}),
    execute: async () => {
      const items = (await db.prepare(`
        SELECT id, code, name, category, current_stock, safety_stock, unit
        FROM materials
        WHERE current_stock <= safety_stock
        ORDER BY code
      `).all()).map((row) => ({
        ...row,
        status: getStockStatus(row.current_stock, row.safety_stock)
      }));

      return {
        data: { items },
        summary: `Ditemukan ${items.length} bahan dengan stok kritis.`
      };
    }
  },

  get_inventory_list: {
    description: 'Mengambil seluruh daftar persediaan bahan baku, opsional difilter oleh teks pencarian.',
    parameters: {
      type: 'OBJECT',
      properties: {
        search: { type: 'STRING', description: 'Teks pencarian kode atau nama bahan.' }
      },
      required: []
    },
    validate: (args) => ({
      search: args.search === undefined ? '' : String(args.search).trim().slice(0, 255)
    }),
    execute: async (args) => {
      const items = (await db.prepare(`
        SELECT * FROM materials
        WHERE code LIKE ? OR name LIKE ?
        ORDER BY code
      `).all(`%${args.search}%`, `%${args.search}%`)).map((row) => ({
        ...row,
        status: getStockStatus(row.current_stock, row.safety_stock)
      }));

      return {
        data: { items },
        summary: `Daftar persediaan diambil: ${items.length} bahan.`
      };
    }
  },

  get_production_requirements: {
    description: 'Menghitung kebutuhan bahan baku dari BOM, stok tersedia, stok pengaman, dan PO masuk yang tepat waktu.',
    parameters: {
      type: 'OBJECT',
      properties: {
        production_plan_id: { type: 'NUMBER', description: 'ID rencana produksi yang sudah tersimpan.' },
        product_name: { type: 'STRING', description: 'Nama atau kode produk saat tidak memakai rencana produksi.' },
        quantity: { type: 'NUMBER', description: 'Jumlah produksi saat tidak memakai rencana produksi.' },
        needed_date: { type: 'STRING', description: 'Tanggal bahan dibutuhkan (YYYY-MM-DD).' }
      },
      required: []
    },
    validate: (args) => {
      const result = {};

      if (optionalValue(args.production_plan_id) !== undefined) {
        result.production_plan_id = requirePositiveInteger(args.production_plan_id, 'ID rencana produksi');
      }

      if (optionalValue(args.product_name) !== undefined) {
        result.product_name = requireString(args.product_name, 'Nama produk');
      }

      if (optionalValue(args.quantity) !== undefined) {
        result.quantity = requirePositiveInteger(args.quantity, 'Jumlah produksi');
      }

      if (optionalValue(args.needed_date) !== undefined) {
        result.needed_date = requireDate(args.needed_date, 'Tanggal kebutuhan');
      }

      return result;
    },
    execute: async (args) => {
      let data;

      if (args.production_plan_id) {
        data = await calculateProductionRequirements({ productionPlanId: args.production_plan_id });
      } else {
        let product = null;

        if (args.product_name) {
          product = await db.prepare(`
            SELECT * FROM products
            WHERE name LIKE ? OR code LIKE ?
            ORDER BY code
            LIMIT 1
          `).get(`%${args.product_name}%`, `%${args.product_name}%`);
        } else {
          product = await db.prepare('SELECT * FROM products ORDER BY code LIMIT 1').get();
        }

        if (!product) {
          throw new HttpError(404, 'Produk tidak ditemukan di database.');
        }

        data = await calculateProductionRequirements({
          productId: product.id,
          quantity: args.quantity ?? product.batch_size,
          neededDate: args.needed_date ?? defaultNeededDate()
        });
      }

      const shortageCount = data.materials.filter((item) => item.net_purchase_quantity > 0).length;

      return {
        data,
        summary: `Kebutuhan ${data.product.name} dihitung: ${shortageCount} bahan kurang, estimasi Rp${data.summary.estimated_total_cost}.`
      };
    }
  },

  get_supplier_offers: {
    description: 'Mengambil daftar penawaran pemasok aktif beserta harga satuan, lead time, dan MOQ.',
    parameters: {
      type: 'OBJECT',
      properties: {
        material_id: { type: 'NUMBER', description: 'ID bahan baku yang ingin dilihat penawarannya.' }
      },
      required: []
    },
    validate: (args) => ({
      material_id: optionalValue(args.material_id) === undefined
        ? undefined
        : requirePositiveInteger(args.material_id, 'ID bahan')
    }),
    execute: async (args) => {
      const parameters = [];
      let where = 'WHERE s.is_active = 1';

      if (args.material_id) {
        where += ' AND so.material_id = ?';
        parameters.push(args.material_id);
      }

      const offers = await db.prepare(`
        SELECT
          so.id,
          so.supplier_id,
          so.material_id,
          so.unit_price,
          so.lead_time_days,
          so.moq,
          s.code AS supplier_code,
          s.name AS supplier_name,
          m.code AS material_code,
          m.name AS material_name,
          m.unit
        FROM supplier_offers so
        JOIN suppliers s ON s.id = so.supplier_id
        JOIN materials m ON m.id = so.material_id
        ${where}
        ORDER BY m.code, so.unit_price, so.lead_time_days
      `).all(...parameters);

      return {
        data: { offers },
        summary: `Penawaran pemasok diambil: ${offers.length} penawaran.`
      };
    }
  },

  compare_supplier_offers: {
    description: 'Memfilter dan mengurutkan penawaran pemasok untuk satu bahan berdasarkan tenggat, harga, lalu lead time.',
    parameters: {
      type: 'OBJECT',
      properties: {
        material_id: { type: 'NUMBER', description: 'ID bahan baku yang akan dibandingkan.' },
        needed_days: { type: 'NUMBER', description: 'Jumlah hari hingga bahan dibutuhkan.' },
        quantity: { type: 'NUMBER', description: 'Perkiraan jumlah pembelian untuk estimasi subtotal.' }
      },
      required: ['material_id', 'needed_days']
    },
    validate: (args) => ({
      material_id: requirePositiveInteger(args.material_id, 'ID bahan'),
      needed_days: requireNonNegativeInteger(args.needed_days, 'Hari hingga kebutuhan'),
      quantity: optionalValue(args.quantity) === undefined
        ? 0
        : requireNonNegativeInteger(args.quantity, 'Jumlah pembelian')
    }),
    execute: async (args) => {
      const offers = await compareSupplierOffers({
        materialId: args.material_id,
        neededDays: args.needed_days,
        netPurchaseQuantity: args.quantity
      });
      const eligibleCount = offers.filter((offer) => offer.meets_deadline).length;

      return {
        data: { offers },
        summary: `Perbandingan selesai: ${offers.length} penawaran, ${eligibleCount} memenuhi tenggat.`
      };
    }
  },

  create_purchase_order_draft: {
    description: 'Membuat draf PO menunggu persetujuan. Harga dan total dihitung backend dari penawaran database. Jangan menyetujui PO.',
    parameters: {
      type: 'OBJECT',
      properties: {
        supplier_id: { type: 'NUMBER', description: 'ID pemasok terpilih.' },
        expected_arrival_date: { type: 'STRING', description: 'Estimasi tanggal tiba (YYYY-MM-DD).' },
        items: {
          type: 'ARRAY',
          description: 'Daftar bahan yang akan dipesan.',
          items: {
            type: 'OBJECT',
            properties: {
              material_id: { type: 'NUMBER', description: 'ID bahan baku.' },
              quantity: { type: 'NUMBER', description: 'Jumlah pesanan.' }
            },
            required: ['material_id', 'quantity']
          }
        }
      },
      required: ['supplier_id', 'expected_arrival_date', 'items']
    },
    validate: (args) => {
      if (!Array.isArray(args.items) || args.items.length === 0) {
        throw new HttpError(400, 'Items pesanan tidak boleh kosong.');
      }

      return {
        supplier_id: requirePositiveInteger(args.supplier_id, 'ID pemasok'),
        expected_arrival_date: requireDate(args.expected_arrival_date, 'Estimasi tanggal tiba'),
        items: args.items.map((item, index) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) {
            throw new HttpError(400, `Item ke-${index + 1} tidak valid.`);
          }

          return {
            material_id: requirePositiveInteger(item.material_id, `ID bahan item ke-${index + 1}`),
            quantity: requirePositiveNumber(item.quantity, `Jumlah item ke-${index + 1}`)
          };
        })
      };
    },
    execute: async (args) => {
      const order = await createPurchaseOrderDraft({
        supplierId: args.supplier_id,
        expectedArrivalDate: args.expected_arrival_date,
        items: args.items
      });

      return {
        data: { purchase_order: order },
        relatedPoId: order.id,
        summary: `Draf PO ${order.po_number} dibuat untuk ${order.supplier_name}, total Rp${order.total_amount}, ${order.items.length} item.`
      };
    }
  },

  get_open_purchase_orders: {
    description: 'Mengambil daftar PO yang belum selesai (DRAFT, MENUNGGU_PERSETUJUAN, DISETUJUI).',
    parameters: {
      type: 'OBJECT',
      properties: {},
      required: []
    },
    validate: () => ({}),
    execute: async () => {
      const groupedOrders = await Promise.all(OPEN_PO_STATUSES.map((status) => getPurchaseOrders(status)));
      const orders = groupedOrders.flat();
      orders.sort((left, right) => right.id - left.id);

      return {
        data: { orders },
        summary: `PO terbuka diambil: ${orders.length} purchase order.`
      };
    }
  },

  get_purchase_order_detail: {
    description: 'Mengambil rincian header dan item sebuah purchase order.',
    parameters: {
      type: 'OBJECT',
      properties: {
        purchase_order_id: { type: 'NUMBER', description: 'ID purchase order.' }
      },
      required: ['purchase_order_id']
    },
    validate: (args) => ({
      purchase_order_id: requirePositiveInteger(args.purchase_order_id, 'ID PO')
    }),
    execute: async (args) => {
      const order = await getPurchaseOrderDetail(args.purchase_order_id);

      return {
        data: { purchase_order: order },
        summary: `Detail ${order.po_number} diambil: ${order.items.length} item, total Rp${order.total_amount}.`
      };
    }
  }
};

export const TOOL_DEFINITIONS = Object.entries(TOOL_HANDLERS).map(([name, tool]) => ({
  name,
  description: tool.description,
  parameters: tool.parameters
}));

export const ALLOWED_TOOLS = new Set(Object.keys(TOOL_HANDLERS));

export async function executeScmTool(name, rawArgs = {}) {
  const tool = TOOL_HANDLERS[name];

  if (!tool) {
    await logToolCall({
      toolName: String(name),
      args: rawArgs,
      status: 'ERROR',
      summary: 'Tool tidak dikenal atau tidak termasuk allowlist.'
    });
    throw new HttpError(400, `Tool ${name} tidak dikenal.`);
  }

  try {
    const args = tool.validate(rawArgs ?? {});
    const result = await tool.execute(args);

    await logToolCall({
      toolName: name,
      args,
      status: 'SUCCESS',
      summary: result.summary,
      relatedPoId: result.relatedPoId ?? null
    });

    return { name, ...result };
  } catch (error) {
    await logToolCall({
      toolName: name,
      args: rawArgs,
      status: 'ERROR',
      summary: error.message
    });
    throw error;
  }
}

export async function getAgentLogs({ limit = 100, status = '' } = {}) {
  const normalizedStatus = status ? String(status).toUpperCase() : '';

  if (normalizedStatus && !['SUCCESS', 'ERROR'].includes(normalizedStatus)) {
    throw new HttpError(400, 'Status log tidak dikenal.');
  }

  const parameters = [];
  let where = '';

  if (normalizedStatus) {
    where = 'WHERE status = ?';
    parameters.push(normalizedStatus);
  }

  parameters.push(limit);

  const rows = await db.prepare(`
    SELECT
      id,
      triggered_by,
      tool_name,
      arguments_json,
      result_summary,
      status,
      related_po_id,
      created_at
    FROM agent_logs
    ${where}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(...parameters);

  return rows.map((row) => ({
    ...row,
    arguments: parseArgumentsJson(row.arguments_json)
  }));
}
