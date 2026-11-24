CREATE TABLE IF NOT EXISTS materials (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL,
  current_stock DECIMAL(12,3) NOT NULL CHECK (current_stock >= 0),
  safety_stock DECIMAL(12,3) NOT NULL CHECK (safety_stock >= 0),
  unit VARCHAR(20) NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS suppliers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  contact VARCHAR(100) NULL,
  address VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS supplier_offers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT NOT NULL,
  material_id INT NOT NULL,
  unit_price INT NOT NULL CHECK (unit_price >= 0),
  lead_time_days INT NOT NULL CHECK (lead_time_days >= 0),
  moq INT NOT NULL DEFAULT 1 CHECK (moq >= 1),
  UNIQUE KEY uq_supplier_offer (supplier_id, material_id),
  KEY idx_supplier_offers_material (material_id),
  KEY idx_supplier_offers_supplier (supplier_id),
  CONSTRAINT fk_supplier_offers_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
  CONSTRAINT fk_supplier_offers_material FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  batch_size INT NOT NULL CHECK (batch_size > 0),
  unit VARCHAR(20) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bom_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  material_id INT NOT NULL,
  quantity_required DECIMAL(12,3) NOT NULL CHECK (quantity_required > 0),
  UNIQUE KEY uq_bom_item (product_id, material_id),
  KEY idx_bom_items_product (product_id),
  CONSTRAINT fk_bom_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_bom_items_material FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS production_plans (
  id INT AUTO_INCREMENT PRIMARY KEY,
  plan_number VARCHAR(50) NOT NULL UNIQUE,
  product_id INT NOT NULL,
  quantity INT NOT NULL CHECK (quantity > 0),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  needed_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DIRANCANG' CHECK (status IN ('DIRANCANG', 'DRAFT', 'SELESAI', 'DIBATALKAN')),
  KEY idx_production_plans_status (status),
  CONSTRAINT fk_production_plans_product FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS purchase_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  po_number VARCHAR(50) NOT NULL UNIQUE,
  supplier_id INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expected_arrival_date DATE NOT NULL,
  status VARCHAR(25) NOT NULL DEFAULT 'MENUNGGU_PERSETUJUAN' CHECK (status IN ('DRAFT', 'MENUNGGU_PERSETUJUAN', 'DISETUJUI', 'DITERIMA', 'DIBATALKAN')),
  total_amount INT NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  approved_at DATETIME NULL,
  received_at DATETIME NULL,
  KEY idx_purchase_orders_status (status),
  CONSTRAINT fk_purchase_orders_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  purchase_order_id INT NOT NULL,
  material_id INT NOT NULL,
  quantity DECIMAL(12,3) NOT NULL CHECK (quantity > 0),
  unit_price INT NOT NULL CHECK (unit_price >= 0),
  subtotal INT NOT NULL CHECK (subtotal >= 0),
  CONSTRAINT fk_po_items_order FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_po_items_material FOREIGN KEY (material_id) REFERENCES materials(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventory_movements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  material_id INT NOT NULL,
  movement_type VARCHAR(20) NOT NULL CHECK (movement_type IN ('MASUK', 'KELUAR', 'PENYESUAIAN')),
  quantity_change DECIMAL(12,3) NOT NULL,
  reference_type VARCHAR(50) NULL,
  reference_id INT NULL,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_inventory_movements_material (material_id),
  CONSTRAINT fk_inventory_movements_material FOREIGN KEY (material_id) REFERENCES materials(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  triggered_by VARCHAR(100) NOT NULL DEFAULT 'AI Agent',
  tool_name VARCHAR(100) NOT NULL,
  arguments_json TEXT NOT NULL,
  result_summary TEXT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('SUCCESS', 'ERROR')),
  related_po_id INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_agent_logs_created_at (created_at),
  CONSTRAINT fk_agent_logs_po FOREIGN KEY (related_po_id) REFERENCES purchase_orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
