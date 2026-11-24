import { db } from '../database/db.js';
import { HttpError } from '../middleware/error-handler.js';
import { formatDateInput, roundQuantity } from './scm-calculation.service.js';

const PO_STATUSES = new Set([
  'DRAFT',
  'MENUNGGU_PERSETUJUAN',
  'DISETUJUI',
  'DITERIMA',
  'DIBATALKAN'
]);

const OPEN_STATUSES = new Set(['DRAFT', 'MENUNGGU_PERSETUJUAN', 'DISETUJUI']);

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

function requirePositiveQuantity(value, label) {
  const number = Number(value);

  if (value === '' || value === null || value === undefined || !Number.isFinite(number) || number <= 0) {
    throw new HttpError(400, `${label} harus lebih besar dari 0.`);
  }

  return number;
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

async function generatePoNumber() {
  const prefix = `PO-${formatDateInput(new Date()).replaceAll('-', '')}`;
  const row = await db.prepare('SELECT COUNT(*) AS total FROM purchase_orders WHERE po_number LIKE ?').get(`${prefix}-%`);
  return `${prefix}-${String(row.total + 1).padStart(3, '0')}`;
}

export async function getPurchaseOrders(status = null) {
  const resolvedStatus = status === undefined || status === null || status === '' ? null : String(status);

  if (resolvedStatus !== null && !PO_STATUSES.has(resolvedStatus)) {
    throw new HttpError(400, 'Status PO tidak ditemukan.');
  }

  let sql = `
    SELECT
      po.*,
      s.code AS supplier_code,
      s.name AS supplier_name
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
  `;
  const parameters = [];

  if (resolvedStatus !== null) {
    sql += ' WHERE po.status = ?';
    parameters.push(resolvedStatus);
  }

  sql += ' ORDER BY po.created_at DESC, po.id DESC';

  return db.prepare(sql).all(...parameters);
}

export async function getPurchaseOrderDetail(purchaseOrderId) {
  const id = requirePositiveInteger(purchaseOrderId, 'ID PO');
  const order = await db.prepare(`
    SELECT
      po.*,
      s.code AS supplier_code,
      s.name AS supplier_name
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.id = ?
  `).get(id);

  if (!order) {
    throw new HttpError(404, 'Purchase order tidak ditemukan.');
  }

  const items = await db.prepare(`
    SELECT
      poim.*,
      m.code AS material_code,
      m.name AS material_name,
      m.unit
    FROM purchase_order_items poim
    JOIN materials m ON m.id = poim.material_id
    WHERE poim.purchase_order_id = ?
    ORDER BY poim.id
  `).all(id);

  return {
    ...order,
    items
  };
}

export async function createPurchaseOrderDraft({ supplierId, expectedArrivalDate, items }) {
  const supplier = await db.prepare('SELECT * FROM suppliers WHERE id = ? AND is_active = 1').get(
    requirePositiveInteger(supplierId, 'ID pemasok')
  );

  if (!supplier) {
    throw new HttpError(400, 'Pemasok tidak ditemukan atau tidak aktif.');
  }

  const arrivalDate = requireDate(expectedArrivalDate, 'Tanggal estimasi tiba');

  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, 'Item PO tidak boleh kosong.');
  }

  const preparedItems = [];

  for (const [index, item] of items.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new HttpError(400, `Item PO ke-${index + 1} tidak valid.`);
    }

    const materialId = requirePositiveInteger(item.material_id, `ID bahan pada item ke-${index + 1}`);
    const quantity = roundQuantity(
      requirePositiveQuantity(item.quantity, `Jumlah pada item ke-${index + 1}`),
      3
    );
    const offer = await db.prepare(`
      SELECT
        so.unit_price,
        so.lead_time_days,
        so.moq,
        m.name AS material_name,
        m.unit
      FROM supplier_offers so
      JOIN materials m ON m.id = so.material_id
      WHERE so.supplier_id = ? AND so.material_id = ?
    `).get(supplier.id, materialId);

    if (!offer) {
      throw new HttpError(400, `Pemasok tidak memiliki penawaran untuk bahan ID ${materialId}.`);
    }

    if (quantity < offer.moq) {
      throw new HttpError(400, `Jumlah ${offer.material_name} harus minimal ${offer.moq} ${offer.unit}.`);
    }

    preparedItems.push({
      materialId,
      quantity,
      unitPrice: offer.unit_price,
      subtotal: Math.round(quantity * offer.unit_price)
    });
  }

  const totalAmount = preparedItems.reduce((total, item) => total + item.subtotal, 0);

  const purchaseOrderId = await db.transaction(async () => {
    const poNumber = await generatePoNumber();
    const result = await db.prepare(`
      INSERT INTO purchase_orders (
        po_number,
        supplier_id,
        expected_arrival_date,
        status,
        total_amount
      )
      VALUES (?, ?, ?, 'MENUNGGU_PERSETUJUAN', ?)
    `).run(poNumber, supplier.id, arrivalDate, totalAmount);

    const id = Number(result.lastInsertRowid);
    const insertItem = db.prepare(`
      INSERT INTO purchase_order_items (
        purchase_order_id,
        material_id,
        quantity,
        unit_price,
        subtotal
      )
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const item of preparedItems) {
      await insertItem.run(
        id,
        item.materialId,
        item.quantity,
        item.unitPrice,
        item.subtotal
      );
    }

    return id;
  });

  return getPurchaseOrderDetail(purchaseOrderId);
}

export async function approvePurchaseOrder(purchaseOrderId) {
  const id = requirePositiveInteger(purchaseOrderId, 'ID PO');

  await db.transaction(async () => {
    const order = await db.prepare('SELECT id, status FROM purchase_orders WHERE id = ? FOR UPDATE').get(id);

    if (!order) {
      throw new HttpError(404, 'Purchase order tidak ditemukan.');
    }

    if (!['DRAFT', 'MENUNGGU_PERSETUJUAN'].includes(order.status)) {
      throw new HttpError(409, `PO berstatus ${order.status} tidak dapat disetujui.`);
    }

    await db.prepare(`
      UPDATE purchase_orders
      SET status = 'DISETUJUI', approved_at = NOW()
      WHERE id = ?
    `).run(id);
  });

  return getPurchaseOrderDetail(id);
}

export async function cancelPurchaseOrder(purchaseOrderId) {
  const id = requirePositiveInteger(purchaseOrderId, 'ID PO');

  await db.transaction(async () => {
    const order = await db.prepare('SELECT id, status FROM purchase_orders WHERE id = ? FOR UPDATE').get(id);

    if (!order) {
      throw new HttpError(404, 'Purchase order tidak ditemukan.');
    }

    if (!OPEN_STATUSES.has(order.status)) {
      throw new HttpError(409, `PO berstatus ${order.status} tidak dapat dibatalkan.`);
    }

    await db.prepare(`
      UPDATE purchase_orders
      SET status = 'DIBATALKAN'
      WHERE id = ?
    `).run(id);
  });

  return getPurchaseOrderDetail(id);
}

export async function receivePurchaseOrder(purchaseOrderId) {
  const id = requirePositiveInteger(purchaseOrderId, 'ID PO');

  const receivedId = await db.transaction(async () => {
    const order = await db.prepare('SELECT * FROM purchase_orders WHERE id = ? FOR UPDATE').get(id);

    if (!order) {
      throw new HttpError(404, 'Purchase order tidak ditemukan.');
    }

    if (order.status !== 'DISETUJUI') {
      throw new HttpError(409, `PO berstatus ${order.status} tidak dapat diterima.`);
    }

    const items = await db.prepare(`
      SELECT * FROM purchase_order_items WHERE purchase_order_id = ?
    `).all(id);

    const updateStock = db.prepare(`
      UPDATE materials
      SET current_stock = current_stock + ?, updated_at = NOW()
      WHERE id = ?
    `);
    const insertMovement = db.prepare(`
      INSERT INTO inventory_movements (
        material_id,
        movement_type,
        quantity_change,
        reference_type,
        reference_id,
        notes
      )
      VALUES (?, 'MASUK', ?, 'PO', ?, ?)
    `);

    for (const item of items) {
      await updateStock.run(item.quantity, item.material_id);
      await insertMovement.run(
        item.material_id,
        item.quantity,
        id,
        `Penerimaan barang ${order.po_number}`
      );
    }

    await db.prepare(`
      UPDATE purchase_orders
      SET status = 'DITERIMA', received_at = NOW()
      WHERE id = ?
    `).run(id);

    return id;
  });

  return getPurchaseOrderDetail(receivedId);
}
