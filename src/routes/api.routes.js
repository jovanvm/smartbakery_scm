import { Router } from 'express';
import { db } from '../database/db.js';
import { HttpError } from '../middleware/error-handler.js';
import {
  calculateProductionRequirements,
  compareSupplierOffers,
  formatDateInput,
  getStockStatus
} from '../services/scm-calculation.service.js';
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  getPurchaseOrderDetail,
  getPurchaseOrders,
  receivePurchaseOrder
} from '../services/procurement.service.js';
import { runAgentChat } from '../services/openrouter.service.js';
import { getAgentLogs } from '../tools/scm-tools.js';
const router = Router();

function asyncHandler(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

const PRODUCTION_PLAN_STATUSES = new Set(['DIRANCANG', 'DRAFT']);

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, `${label} harus berupa objek.`);
  }

  return value;
}

function requireString(value, label, maxLength = 255) {
  const text = typeof value === 'string' ? value.trim() : '';

  if (!text || text.length > maxLength) {
    throw new HttpError(400, `${label} wajib diisi dan maksimal ${maxLength} karakter.`);
  }

  return text;
}

function requireOptionalString(value, label, maxLength = 255) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return requireString(value, label, maxLength);
}

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

function requireNonNegativeNumber(value, label) {
  const number = Number(value);

  if (value === '' || value === null || value === undefined || !Number.isFinite(number) || number < 0) {
    throw new HttpError(400, `${label} harus berupa angka minimal 0.`);
  }

  return number;
}

function requirePositiveNumber(value, label) {
  const number = Number(value);

  if (value === '' || value === null || value === undefined || !Number.isFinite(number) || number <= 0) {
    throw new HttpError(400, `${label} harus berupa angka lebih besar dari 0.`);
  }

  return number;
}

function requireBoolean(value, label) {
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  if (value === 1 || value === '1') {
    return 1;
  }

  if (value === 0 || value === '0') {
    return 0;
  }

  throw new HttpError(400, `${label} harus bernilai true/false atau 1/0.`);
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

function parseId(value, label) {
  return requirePositiveInteger(value, label);
}

function withMaterialStatus(row) {
  return {
    ...row,
    status: getStockStatus(row.current_stock, row.safety_stock)
  };
}

async function getMaterialById(id) {
  return db.prepare('SELECT * FROM materials WHERE id = ?').get(id);
}

async function getProductWithBom(id) {
  const product = await db.prepare('SELECT * FROM products WHERE id = ?').get(id);

  if (!product) {
    return null;
  }

  const bomItems = await db.prepare(`
    SELECT
      bom.id,
      bom.quantity_required,
      m.id AS material_id,
      m.code AS material_code,
      m.name AS material_name,
      m.unit
    FROM bom_items bom
    JOIN materials m ON m.id = bom.material_id
    WHERE bom.product_id = ?
    ORDER BY m.code
  `).all(id);

  return {
    ...product,
    bom_items: bomItems
  };
}

async function generatePlanNumber() {
  const prefix = `PP-${new Date().getFullYear()}-`;
  const row = await db.prepare('SELECT COUNT(*) AS total FROM production_plans WHERE plan_number LIKE ?').get(`${prefix}%`);
  return `${prefix}${String(row.total + 1).padStart(3, '0')}`;
}

router.get('/health', asyncHandler(async (request, response) => {
  await db.prepare('SELECT 1 AS ok').get();
  const seedResult = request.app.locals.seedResult ?? null;

  response.json({
    status: 'ok',
    application: 'SmartBakery SCM',
    studyCase: 'Roti Nusa',
    phase: 5,
    database: {
      ready: true,
      seeded: seedResult?.seeded ?? null,
      reason: seedResult?.reason ?? null
    },
    message: 'Server dan API berjalan.'
  });
}));

router.get('/dashboard', asyncHandler(async (_request, response) => {
  const totalMaterials = (await db.prepare('SELECT COUNT(*) AS total FROM materials').get()).total;
  const criticalMaterials = (await db.prepare(
    'SELECT COUNT(*) AS total FROM materials WHERE current_stock <= safety_stock'
  ).get()).total;
  const activePlans = (await db.prepare(
    "SELECT COUNT(*) AS total FROM production_plans WHERE status IN ('DRAFT', 'DIRANCANG')"
  ).get()).total;
  const pendingOrders = (await db.prepare(
    "SELECT COUNT(*) AS total FROM purchase_orders WHERE status IN ('DRAFT', 'MENUNGGU_PERSETUJUAN')"
  ).get()).total;

  const lowStockItems = (await db.prepare(`
    SELECT id, code, name, category, current_stock, safety_stock, unit, updated_at
    FROM materials
    WHERE current_stock <= safety_stock
    ORDER BY code
  `).all()).map(withMaterialStatus);

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

  const stockComparison = (await db.prepare(`
    SELECT id, code, name, current_stock, safety_stock, unit
    FROM materials
    ORDER BY code
  `).all()).map(withMaterialStatus);

  response.json({
    kpi: {
      total_materials: totalMaterials,
      critical_materials: criticalMaterials,
      active_production_plans: activePlans,
      pending_purchase_orders: pendingOrders
    },
    low_stock_items: lowStockItems,
    recent_purchase_orders: recentPurchaseOrders,
    stock_comparison: stockComparison
  });
}));

router.get('/materials', asyncHandler(async (request, response) => {
  const conditions = [];
  const parameters = {};
  const search = request.query.search === undefined ? '' : String(request.query.search).trim();
  const category = request.query.category === undefined ? '' : String(request.query.category).trim();
  const status = request.query.status === undefined ? '' : String(request.query.status).toUpperCase();

  if (search) {
    conditions.push('(code LIKE @search OR name LIKE @search)');
    parameters.search = `%${search}%`;
  }

  if (category) {
    conditions.push('category = @category');
    parameters.category = category;
  }

  if (status) {
    if (!['AMAN', 'PERLU_DIBELI'].includes(status)) {
      throw new HttpError(400, 'Status stok tidak dikenal.');
    }

    conditions.push(status === 'AMAN' ? 'current_stock > safety_stock' : 'current_stock <= safety_stock');
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const statement = db.prepare(`SELECT * FROM materials ${where} ORDER BY code`);
  const rows = conditions.length > 0 ? await statement.all(parameters) : await statement.all();

  response.json(rows.map(withMaterialStatus));
}));

router.post('/materials', asyncHandler(async (request, response) => {
  const body = requireObject(request.body, 'Body');
  const values = {
    code: requireString(body.code, 'Kode bahan', 50),
    name: requireString(body.name, 'Nama bahan'),
    category: requireString(body.category, 'Kategori'),
    currentStock: requireNonNegativeNumber(body.current_stock, 'Stok tersedia'),
    safetyStock: requireNonNegativeNumber(body.safety_stock, 'Stok pengaman'),
    unit: requireString(body.unit, 'Satuan', 20)
  };

  const result = await db.prepare(`
    INSERT INTO materials (code, name, category, current_stock, safety_stock, unit)
    VALUES (@code, @name, @category, @currentStock, @safetyStock, @unit)
  `).run(values);

  response.status(201).json(withMaterialStatus(await getMaterialById(Number(result.lastInsertRowid))));
}));

router.put('/materials/:id', asyncHandler(async (request, response) => {
  const id = parseId(request.params.id, 'ID bahan');

  if (!await getMaterialById(id)) {
    throw new HttpError(404, 'Bahan baku tidak ditemukan.');
  }

  const body = requireObject(request.body, 'Body');
  const values = {
    id,
    code: requireString(body.code, 'Kode bahan', 50),
    name: requireString(body.name, 'Nama bahan'),
    category: requireString(body.category, 'Kategori'),
    currentStock: requireNonNegativeNumber(body.current_stock, 'Stok tersedia'),
    safetyStock: requireNonNegativeNumber(body.safety_stock, 'Stok pengaman'),
    unit: requireString(body.unit, 'Satuan', 20)
  };

  await db.prepare(`
    UPDATE materials
    SET
      code = @code,
      name = @name,
      category = @category,
      current_stock = @currentStock,
      safety_stock = @safetyStock,
      unit = @unit,
      updated_at = NOW()
    WHERE id = @id
  `).run(values);

  response.json(withMaterialStatus(await getMaterialById(id)));
}));

router.get('/movements', asyncHandler(async (request, response) => {
  const parameters = [];
  let where = '';

  if (request.query.material_id !== undefined) {
    where = 'WHERE im.material_id = ?';
    parameters.push(parseId(request.query.material_id, 'ID bahan'));
  }

  const limit = request.query.limit === undefined
    ? 100
    : requirePositiveInteger(request.query.limit, 'Limit');
  parameters.push(limit);

  const rows = await db.prepare(`
    SELECT
      im.*,
      m.code AS material_code,
      m.name AS material_name
    FROM inventory_movements im
    JOIN materials m ON m.id = im.material_id
    ${where}
    ORDER BY im.created_at DESC, im.id DESC
    LIMIT ?
  `).all(...parameters);

  response.json(rows);
}));

router.get('/suppliers', asyncHandler(async (_request, response) => {
  const suppliers = await db.prepare('SELECT * FROM suppliers ORDER BY code').all();
  const offers = await db.prepare(`
    SELECT
      so.*,
      m.code AS material_code,
      m.name AS material_name,
      m.unit
    FROM supplier_offers so
    JOIN materials m ON m.id = so.material_id
    ORDER BY m.code
  `).all();

  response.json(
    suppliers.map((supplier) => ({
      ...supplier,
      is_active: Boolean(supplier.is_active),
      offers: offers.filter((offer) => offer.supplier_id === supplier.id)
    }))
  );
}));

router.post('/suppliers', asyncHandler(async (request, response) => {
  const body = requireObject(request.body, 'Body');
  const values = {
    code: requireString(body.code, 'Kode pemasok', 50),
    name: requireString(body.name, 'Nama pemasok'),
    contact: requireOptionalString(body.contact, 'Kontak'),
    address: requireOptionalString(body.address, 'Alamat'),
    isActive: body.is_active === undefined ? 1 : requireBoolean(body.is_active, 'Status aktif')
  };

  const result = await db.prepare(`
    INSERT INTO suppliers (code, name, contact, address, is_active)
    VALUES (@code, @name, @contact, @address, @isActive)
  `).run(values);

  const supplier = await db.prepare('SELECT * FROM suppliers WHERE id = ?').get(Number(result.lastInsertRowid));
  response.status(201).json({
    ...supplier,
    is_active: Boolean(supplier.is_active)
  });
}));

router.get('/supplier-offers/compare', asyncHandler(async (request, response) => {
  const materialId = parseId(request.query.material_id, 'ID bahan');
  const neededDays = request.query.needed_days === undefined
    ? 0
    : requireNonNegativeInteger(request.query.needed_days, 'Hari hingga kebutuhan');
  const quantity = request.query.quantity === undefined
    ? 0
    : requireNonNegativeNumber(request.query.quantity, 'Jumlah pembelian');

  response.json(await compareSupplierOffers({
    materialId,
    neededDays,
    netPurchaseQuantity: quantity
  }));
}));

router.post('/suppliers/:id/offers', asyncHandler(async (request, response) => {
  const supplierId = parseId(request.params.id, 'ID pemasok');

  if (!await db.prepare('SELECT id FROM suppliers WHERE id = ?').get(supplierId)) {
    throw new HttpError(404, 'Pemasok tidak ditemukan.');
  }

  const body = requireObject(request.body, 'Body');
  const values = {
    supplierId,
    materialId: requirePositiveInteger(body.material_id, 'ID bahan'),
    unitPrice: requireNonNegativeNumber(body.unit_price, 'Harga satuan'),
    leadTimeDays: requireNonNegativeInteger(body.lead_time_days, 'Lead time'),
    moq: body.moq === undefined ? 1 : requirePositiveInteger(body.moq, 'MOQ')
  };

  if (!await getMaterialById(values.materialId)) {
    throw new HttpError(404, 'Bahan baku tidak ditemukan.');
  }

  await db.prepare(`
    INSERT INTO supplier_offers (supplier_id, material_id, unit_price, lead_time_days, moq)
    VALUES (@supplierId, @materialId, @unitPrice, @leadTimeDays, @moq)
    ON DUPLICATE KEY UPDATE
      unit_price = VALUES(unit_price),
      lead_time_days = VALUES(lead_time_days),
      moq = VALUES(moq)
  `).run(values);

  const offer = await db.prepare(`
    SELECT
      so.*,
      m.code AS material_code,
      m.name AS material_name,
      m.unit
    FROM supplier_offers so
    JOIN materials m ON m.id = so.material_id
    WHERE so.supplier_id = ? AND so.material_id = ?
  `).get(supplierId, values.materialId);

  response.json(offer);
}));

router.get('/products', asyncHandler(async (_request, response) => {
  const products = await db.prepare('SELECT * FROM products ORDER BY code').all();
  response.json(await Promise.all(products.map((product) => getProductWithBom(product.id))));
}));

router.post('/products', asyncHandler(async (request, response) => {
  const body = requireObject(request.body, 'Body');
  const code = requireString(body.code, 'Kode produk', 50);
  const name = requireString(body.name, 'Nama produk');
  const batchSize = requirePositiveInteger(body.batch_size, 'Ukuran batch');
  const unit = requireString(body.unit, 'Satuan produk', 20);

  if (!Array.isArray(body.bom_items) || body.bom_items.length === 0) {
    throw new HttpError(400, 'Resep produk wajib memiliki minimal satu bahan.');
  }

  const bomItems = body.bom_items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new HttpError(400, `Bahan resep ke-${index + 1} tidak valid.`);
    }

    return {
      materialId: requirePositiveInteger(item.material_id, `ID bahan pada resep ke-${index + 1}`),
      quantityRequired: requirePositiveNumber(
        item.quantity_required,
        `Takaran pada resep ke-${index + 1}`
      )
    };
  });

  const save = db.transaction(async () => {
    const result = await db.prepare(`
      INSERT INTO products (code, name, batch_size, unit)
      VALUES (?, ?, ?, ?)
    `).run(code, name, batchSize, unit);

    const productId = Number(result.lastInsertRowid);
    const insertBom = db.prepare(`
      INSERT INTO bom_items (product_id, material_id, quantity_required)
      VALUES (?, ?, ?)
    `);

    for (const item of bomItems) {
      if (!await getMaterialById(item.materialId)) {
        throw new HttpError(404, `Bahan ID ${item.materialId} tidak ditemukan.`);
      }

      await insertBom.run(productId, item.materialId, item.quantityRequired);
    }

    return productId;
  });

  response.status(201).json(await getProductWithBom(await save()));
}));

router.get('/production-plans', asyncHandler(async (_request, response) => {
  const rows = await db.prepare(`
    SELECT
      pp.*,
      p.code AS product_code,
      p.name AS product_name
    FROM production_plans pp
    JOIN products p ON p.id = pp.product_id
    ORDER BY pp.created_at DESC, pp.id DESC
  `).all();

  response.json(rows);
}));

router.post('/production-plans', asyncHandler(async (request, response) => {
  const body = requireObject(request.body, 'Body');
  const productId = requirePositiveInteger(body.product_id, 'ID produk');
  const quantity = requirePositiveInteger(body.quantity, 'Jumlah produksi');
  const neededDate = requireDate(body.needed_date, 'Tanggal bahan dibutuhkan');
  const status = body.status === undefined ? 'DIRANCANG' : String(body.status).toUpperCase();

  if (!PRODUCTION_PLAN_STATUSES.has(status)) {
    throw new HttpError(400, 'Status rencana produksi tidak valid.');
  }

  if (!await db.prepare('SELECT id FROM products WHERE id = ?').get(productId)) {
    throw new HttpError(404, 'Produk tidak ditemukan.');
  }

  const planNumber = body.plan_number === undefined
    ? await generatePlanNumber()
    : requireString(body.plan_number, 'Nomor rencana', 50);

  const result = await db.prepare(`
    INSERT INTO production_plans (plan_number, product_id, quantity, needed_date, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(planNumber, productId, quantity, neededDate, status);

  const plan = await db.prepare(`
    SELECT
      pp.*,
      p.code AS product_code,
      p.name AS product_name
    FROM production_plans pp
    JOIN products p ON p.id = pp.product_id
    WHERE pp.id = ?
  `).get(Number(result.lastInsertRowid));

  response.status(201).json(plan);
}));

router.get('/production-plans/:id/requirements', asyncHandler(async (request, response) => {
  const productionPlanId = parseId(request.params.id, 'ID rencana produksi');
  response.json(await calculateProductionRequirements({ productionPlanId }));
}));

router.get('/purchase-orders', asyncHandler(async (request, response) => {
  response.json(await getPurchaseOrders(request.query.status ?? null));
}));

router.get('/purchase-orders/:id', asyncHandler(async (request, response) => {
  response.json(await getPurchaseOrderDetail(parseId(request.params.id, 'ID PO')));
}));

router.post('/purchase-orders/:id/approve', asyncHandler(async (request, response) => {
  response.json(await approvePurchaseOrder(parseId(request.params.id, 'ID PO')));
}));

router.post('/purchase-orders/:id/cancel', asyncHandler(async (request, response) => {
  response.json(await cancelPurchaseOrder(parseId(request.params.id, 'ID PO')));
}));

router.post('/purchase-orders/:id/receive', asyncHandler(async (request, response) => {
  response.json(await receivePurchaseOrder(parseId(request.params.id, 'ID PO')));
}));

router.post('/agent/chat', asyncHandler(async (request, response) => {
  const body = requireObject(request.body, 'Body');
  const result = await runAgentChat({
    message: body.message,
    history: body.history
  });

  response.json(result);
}));

router.get('/agent/logs', asyncHandler(async (request, response) => {
  const limit = request.query.limit === undefined
    ? 100
    : Math.min(requirePositiveInteger(request.query.limit, 'Limit'), 200);

  response.json(await getAgentLogs({
    limit,
    status: request.query.status ?? ''
  }));
}));

export default router;
