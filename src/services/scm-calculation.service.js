import { db } from '../database/db.js';
import { HttpError } from '../middleware/error-handler.js';

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export function roundQuantity(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function formatDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getStockStatus(currentStock, safetyStock) {
  return currentStock > safetyStock ? 'AMAN' : 'PERLU_DIBELI';
}

export function daysUntilDate(dateString) {
  const value = String(dateString ?? '');

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return 0;
  }

  const target = new Date(`${value}T00:00:00`);

  if (Number.isNaN(target.getTime())) {
    return 0;
  }

  const today = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return Math.max(0, Math.round((today - startOfToday) / DAY_IN_MS));
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

export async function getIncomingQuantityByMaterial(neededDate) {
  const rows = await db.prepare(`
    SELECT poim.material_id, COALESCE(SUM(poim.quantity), 0) AS incoming_quantity
    FROM purchase_order_items poim
    JOIN purchase_orders po ON po.id = poim.purchase_order_id
    WHERE po.status = 'DISETUJUI' AND po.expected_arrival_date <= ?
    GROUP BY poim.material_id
  `).all(neededDate);

  return new Map(rows.map((row) => [row.material_id, row.incoming_quantity]));
}

export async function compareSupplierOffers({
  materialId,
  neededDays,
  neededDate,
  netPurchaseQuantity = 0
} = {}) {
  const material = requirePositiveInteger(materialId, 'ID bahan');
  const net = Math.max(0, Number(netPurchaseQuantity) || 0);

  let deadline = Number(neededDays);

  if (!Number.isFinite(deadline) && neededDate) {
    deadline = daysUntilDate(neededDate);
  }

  if (!Number.isFinite(deadline)) {
    deadline = 0;
  }

  deadline = Math.max(0, Math.floor(deadline));

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
    WHERE so.material_id = ? AND s.is_active = 1
  `).all(material);

  return offers
    .map((offer) => {
      const meetsDeadline = offer.lead_time_days <= deadline;
      const suggestedOrderQuantity = net > 0 ? Math.max(roundQuantity(net, 3), offer.moq) : 0;

      return {
        offer_id: offer.id,
        supplier_id: offer.supplier_id,
        supplier_code: offer.supplier_code,
        supplier_name: offer.supplier_name,
        material_id: offer.material_id,
        material_code: offer.material_code,
        material_name: offer.material_name,
        unit: offer.unit,
        unit_price: offer.unit_price,
        lead_time_days: offer.lead_time_days,
        moq: offer.moq,
        needed_days: deadline,
        meets_deadline: meetsDeadline,
        suggested_order_quantity: roundQuantity(suggestedOrderQuantity, 3),
        estimated_subtotal: Math.round(suggestedOrderQuantity * offer.unit_price)
      };
    })
    .sort((left, right) => {
      if (left.meets_deadline !== right.meets_deadline) {
        return left.meets_deadline ? -1 : 1;
      }

      return (
        left.unit_price - right.unit_price ||
        left.lead_time_days - right.lead_time_days ||
        left.supplier_name.localeCompare(right.supplier_name, 'id')
      );
    });
}

export async function calculateProductionRequirements({
  productionPlanId,
  productId,
  quantity,
  neededDate
} = {}) {
  let plan = null;

  if (productionPlanId !== undefined) {
    const id = requirePositiveInteger(productionPlanId, 'ID rencana produksi');
    plan = await db.prepare('SELECT * FROM production_plans WHERE id = ?').get(id);

    if (!plan) {
      throw new HttpError(404, 'Rencana produksi tidak ditemukan.');
    }
  }

  const resolvedProductId = requirePositiveInteger(plan?.product_id ?? productId, 'ID produk');
  const resolvedQuantity = requirePositiveInteger(plan?.quantity ?? quantity, 'Jumlah produksi');
  const resolvedNeededDate = plan?.needed_date ?? neededDate;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(resolvedNeededDate ?? ''))) {
    throw new HttpError(400, 'Tanggal kebutuhan bahan harus berformat YYYY-MM-DD.');
  }

  const product = await db.prepare('SELECT * FROM products WHERE id = ?').get(resolvedProductId);

  if (!product) {
    throw new HttpError(404, 'Produk tidak ditemukan.');
  }

  const bomRows = await db.prepare(`
    SELECT
      bom.id AS bom_item_id,
      bom.quantity_required,
      m.id AS material_id,
      m.code,
      m.name,
      m.category,
      m.current_stock,
      m.safety_stock,
      m.unit
    FROM bom_items bom
    JOIN materials m ON m.id = bom.material_id
    WHERE bom.product_id = ?
    ORDER BY m.code
  `).all(resolvedProductId);

  if (bomRows.length === 0) {
    throw new HttpError(404, 'Resep produk belum tersedia.');
  }

  const incomingByMaterial = await getIncomingQuantityByMaterial(resolvedNeededDate);
  const neededDays = daysUntilDate(resolvedNeededDate);

  const materials = await Promise.all(bomRows.map(async (row) => {
    const productionRequirement = Math.ceil(
      roundQuantity((resolvedQuantity / product.batch_size) * row.quantity_required, 6)
    );
    const incomingQuantity = roundQuantity(incomingByMaterial.get(row.material_id) ?? 0, 3);
    const netPurchaseQuantity = roundQuantity(
      Math.max(0, productionRequirement + row.safety_stock - row.current_stock - incomingQuantity),
      3
    );
    const supplierRecommendations = await compareSupplierOffers({
      materialId: row.material_id,
      neededDays,
      netPurchaseQuantity
    });
    const recommendedSupplier = supplierRecommendations.find((offer) => offer.meets_deadline) ?? null;

    return {
      material_id: row.material_id,
      code: row.code,
      name: row.name,
      category: row.category,
      unit: row.unit,
      quantity_required_per_batch: row.quantity_required,
      production_requirement: productionRequirement,
      current_stock: roundQuantity(row.current_stock, 3),
      safety_stock: roundQuantity(row.safety_stock, 3),
      incoming_quantity: incomingQuantity,
      net_purchase_quantity: netPurchaseQuantity,
      status: netPurchaseQuantity > 0 ? 'KURANG' : 'CUKUP',
      supplier_recommendations: supplierRecommendations,
      recommended_supplier: recommendedSupplier,
      deadline_risk: netPurchaseQuantity > 0 && recommendedSupplier === null
    };
  }));

  const shortageCount = materials.filter((item) => item.net_purchase_quantity > 0).length;
  const estimatedTotalCost = materials.reduce(
    (total, item) => total + (item.recommended_supplier?.estimated_subtotal ?? 0),
    0
  );

  return {
    production_plan: plan
      ? {
          id: plan.id,
          plan_number: plan.plan_number,
          quantity: plan.quantity,
          needed_date: plan.needed_date,
          status: plan.status
        }
      : null,
    product: {
      id: product.id,
      code: product.code,
      name: product.name,
      batch_size: product.batch_size,
      unit: product.unit
    },
    needed_date: resolvedNeededDate,
    needed_days: neededDays,
    materials,
    summary: {
      total_materials: materials.length,
      shortage_materials: shortageCount,
      sufficient_materials: materials.length - shortageCount,
      estimated_total_cost: estimatedTotalCost,
      has_deadline_risk: materials.some((item) => item.deadline_risk)
    }
  };
}
