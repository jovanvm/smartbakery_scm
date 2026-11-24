import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDatabase, db } from './db.js';

const materials = [
  { code: 'BB001', name: 'Tepung terigu', category: 'Bahan kering', currentStock: 8, safetyStock: 3, unit: 'kg' },
  { code: 'BB002', name: 'Gula pasir', category: 'Bahan kering', currentStock: 4, safetyStock: 2, unit: 'kg' },
  { code: 'BB003', name: 'Telur', category: 'Bahan segar', currentStock: 40, safetyStock: 10, unit: 'butir' },
  { code: 'BB004', name: 'Mentega', category: 'Bahan dingin', currentStock: 1, safetyStock: 1, unit: 'kg' }
];

const suppliers = [
  { code: 'SUP001', name: 'Toko Sumber Pangan', contact: '0812-0000-1111', address: 'Jl. Pangan No. 11' },
  { code: 'SUP002', name: 'Grosir Makmur', contact: '0812-0000-2222', address: 'Jl. Makmur No. 22' }
];

const supplierOffers = [
  { supplierCode: 'SUP001', materialCode: 'BB001', unitPrice: 13000, leadTimeDays: 1, moq: 1 },
  { supplierCode: 'SUP001', materialCode: 'BB004', unitPrice: 28000, leadTimeDays: 2, moq: 1 },
  { supplierCode: 'SUP001', materialCode: 'BB002', unitPrice: 14500, leadTimeDays: 1, moq: 1 },
  { supplierCode: 'SUP002', materialCode: 'BB001', unitPrice: 12500, leadTimeDays: 3, moq: 1 },
  { supplierCode: 'SUP002', materialCode: 'BB004', unitPrice: 29000, leadTimeDays: 1, moq: 1 },
  { supplierCode: 'SUP002', materialCode: 'BB003', unitPrice: 2000, leadTimeDays: 1, moq: 10 }
];

const bomItems = [
  { materialCode: 'BB001', quantityRequired: 10 },
  { materialCode: 'BB002', quantityRequired: 2 },
  { materialCode: 'BB003', quantityRequired: 30 },
  { materialCode: 'BB004', quantityRequired: 2 }
];

const RESET_TABLES = [
  'agent_logs',
  'inventory_movements',
  'purchase_order_items',
  'purchase_orders',
  'production_plans',
  'bom_items',
  'products',
  'supplier_offers',
  'suppliers',
  'materials'
];

function formatDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function getTableCounts() {
  const tables = ['materials', 'suppliers', 'supplier_offers', 'products', 'bom_items', 'production_plans'];
  const entries = await Promise.all(
    tables.map(async (table) => {
      const row = await db.get(`SELECT COUNT(*) AS total FROM ${table}`);
      return [table, Number(row.total)];
    })
  );

  return Object.fromEntries(entries);
}

export async function seedDatabase() {
  const counts = await getTableCounts();

  if (Object.values(counts).some((total) => total > 0)) {
    return {
      seeded: false,
      reason: 'Data simulasi sudah ada; seed dilewati.',
      counts
    };
  }

  const neededDate = new Date();
  neededDate.setDate(neededDate.getDate() + 2);

  return db.transaction(async () => {
    const materialIds = new Map();
    for (const material of materials) {
      const result = await db.prepare(`
        INSERT INTO materials (code, name, category, current_stock, safety_stock, unit)
        VALUES (@code, @name, @category, @currentStock, @safetyStock, @unit)
      `).run(material);
      materialIds.set(material.code, Number(result.lastInsertRowid));
    }

    const supplierIds = new Map();
    for (const supplier of suppliers) {
      const result = await db.prepare(`
        INSERT INTO suppliers (code, name, contact, address, is_active)
        VALUES (@code, @name, @contact, @address, 1)
      `).run(supplier);
      supplierIds.set(supplier.code, Number(result.lastInsertRowid));
    }

    for (const offer of supplierOffers) {
      await db.prepare(`
        INSERT INTO supplier_offers (supplier_id, material_id, unit_price, lead_time_days, moq)
        VALUES (@supplierId, @materialId, @unitPrice, @leadTimeDays, @moq)
      `).run({
        supplierId: supplierIds.get(offer.supplierCode),
        materialId: materialIds.get(offer.materialCode),
        unitPrice: offer.unitPrice,
        leadTimeDays: offer.leadTimeDays,
        moq: offer.moq
      });
    }

    const productResult = await db.prepare(`
      INSERT INTO products (code, name, batch_size, unit)
      VALUES (@code, @name, @batchSize, @unit)
    `).run({
      code: 'PRD001',
      name: 'Roti Manis',
      batchSize: 100,
      unit: 'roti'
    });
    const productId = Number(productResult.lastInsertRowid);

    for (const item of bomItems) {
      await db.prepare(`
        INSERT INTO bom_items (product_id, material_id, quantity_required)
        VALUES (@productId, @materialId, @quantityRequired)
      `).run({
        productId,
        materialId: materialIds.get(item.materialCode),
        quantityRequired: item.quantityRequired
      });
    }

    await db.prepare(`
      INSERT INTO production_plans (plan_number, product_id, quantity, needed_date, status)
      VALUES (@planNumber, @productId, @quantity, @neededDate, @status)
    `).run({
      planNumber: 'PP-2026-001',
      productId,
      quantity: 100,
      neededDate: formatDateInput(neededDate),
      status: 'DIRANCANG'
    });

    return {
      seeded: true,
      neededDate: formatDateInput(neededDate),
      counts: await getTableCounts()
    };
  });
}

export async function resetDatabase() {
  const connection = await db.pool.getConnection();

  try {
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');

    for (const table of RESET_TABLES) {
      await connection.query(`TRUNCATE TABLE \`${table}\``);
    }
  } finally {
    try {
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    } finally {
      connection.release();
    }
  }

  return seedDatabase();
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const result = process.argv.includes('--reset') ? await resetDatabase() : await seedDatabase();
  console.log(JSON.stringify(result, null, 2));
  await closeDatabase();
}
