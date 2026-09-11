// db.js
// Base de dados local em SQLite (ficheiro loja.db criado automaticamente).
// Guarda: produtos (os teus jogos), chaves disponíveis por produto, e pedidos (compras).

const Database = require('better-sqlite3');

// Caminho da base de dados configurável (para usar um volume no Railway e não
// perder produtos/chaves a cada deploy). Ex.: DATABASE_PATH=/data/loja.db
const DB_PATH = process.env.DATABASE_PATH || 'loja.db';
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  price_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'eur',
  category TEXT,
  role_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  key_value TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  used_by TEXT,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  discord_user_id TEXT NOT NULL,
  stripe_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | paid | delivered | expired
  key_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

function temColuna(tabela, coluna) {
  return db
    .prepare(`PRAGMA table_info(${tabela})`)
    .all()
    .some((col) => col.name === coluna);
}

// Migrações para bases de dados antigas.
if (!temColuna('products', 'category')) {
  db.exec(`ALTER TABLE products ADD COLUMN category TEXT`);
}
if (!temColuna('products', 'stock_qty')) {
  db.exec(`ALTER TABLE products ADD COLUMN stock_qty INTEGER NOT NULL DEFAULT 10`);
}
if (!temColuna('orders', 'quantity')) {
  db.exec(`ALTER TABLE orders ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1`);
}

db.exec(`
CREATE TABLE IF NOT EXISTS tickets (
  channel_id TEXT PRIMARY KEY,
  ticket_num INTEGER UNIQUE,
  opener_id TEXT NOT NULL,
  claimed_by TEXT,
  tipo TEXT,
  created_at TEXT NOT NULL,
  closed_at TEXT,
  close_reason TEXT
);
`);

// ---------- Produtos ----------
function addProduct({ name, description, priceCents, currency, category, roleId, stockQty }) {
  const stmt = db.prepare(
    `INSERT INTO products (name, description, price_cents, currency, category, role_id, stock_qty) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const info = stmt.run(
    name,
    description || '',
    priceCents,
    currency || 'eur',
    category || null,
    roleId || null,
    stockQty == null ? 10 : Math.max(0, Math.round(Number(stockQty) || 0))
  );
  return info.lastInsertRowid;
}

function listActiveProducts() {
  return db.prepare(`SELECT * FROM products WHERE active = 1 ORDER BY id DESC`).all();
}

function listActiveProductsByCategory(category) {
  return db
    .prepare(`SELECT * FROM products WHERE active = 1 AND category = ? ORDER BY id ASC`)
    .all(category);
}

function listCategories() {
  return db
    .prepare(
      `SELECT category FROM products WHERE active = 1 AND category IS NOT NULL AND category <> ''
       GROUP BY category ORDER BY MIN(id) ASC`
    )
    .all()
    .map((row) => row.category);
}

function getProduct(id) {
  return db.prepare(`SELECT * FROM products WHERE id = ?`).get(id);
}

function getProductByName(name) {
  return db.prepare(`SELECT * FROM products WHERE lower(name) = lower(?)`).get(name);
}

function updateProduct(id, { priceCents, currency, category }) {
  const product = getProduct(id);
  if (!product) return false;
  db.prepare(
    `UPDATE products SET price_cents = ?, currency = ?, category = ? WHERE id = ?`
  ).run(
    priceCents ?? product.price_cents,
    currency ?? product.currency,
    category !== undefined ? category : product.category,
    id
  );
  return true;
}

function countAvailableKeys(productId) {
  return db
    .prepare(`SELECT COUNT(*) AS n FROM keys WHERE product_id = ? AND used = 0`)
    .get(productId).n;
}

function getStock(productId) {
  const row = db.prepare(`SELECT stock_qty FROM products WHERE id = ?`).get(productId);
  return row ? Number(row.stock_qty) || 0 : 0;
}

function setStock(productId, qty) {
  const n = Math.max(0, Math.round(Number(qty) || 0));
  const info = db.prepare(`UPDATE products SET stock_qty = ? WHERE id = ?`).run(n, productId);
  return info.changes > 0 ? n : null;
}

function addStock(productId, delta) {
  return db.transaction(() => {
    const row = db.prepare(`SELECT stock_qty FROM products WHERE id = ?`).get(productId);
    if (!row) return null;
    const next = Math.max(0, (Number(row.stock_qty) || 0) + delta);
    db.prepare(`UPDATE products SET stock_qty = ? WHERE id = ?`).run(next, productId);
    return next;
  })();
}

// ---------- Chaves ----------
function addKeysBulk(productId, keyList) {
  const insert = db.prepare(`INSERT INTO keys (product_id, key_value) VALUES (?, ?)`);
  const insertMany = db.transaction((keys) => {
    for (const k of keys) {
      const clean = k.trim();
      if (clean.length > 0) insert.run(productId, clean);
    }
  });
  insertMany(keyList);
  return keyList.filter((k) => k.trim().length > 0).length;
}

// Reserva atomicamente uma chave livre para um pedido (evita duas pessoas
// receberem a mesma chave em compras simultâneas).
const allocateKeyTxn = db.transaction((productId, discordUserId) => {
  const key = db
    .prepare(`SELECT id FROM keys WHERE product_id = ? AND used = 0 LIMIT 1`)
    .get(productId);
  if (!key) return null;
  db.prepare(
    `UPDATE keys SET used = 1, used_by = ?, used_at = datetime('now') WHERE id = ?`
  ).run(discordUserId, key.id);
  return key.id;
});

function getKeyValue(keyId) {
  return db.prepare(`SELECT key_value FROM keys WHERE id = ?`).get(keyId)?.key_value;
}

function allocateKeys(productId, discordUserId, quantity) {
  const qty = Math.max(1, Math.round(Number(quantity) || 1));
  const ids = [];
  for (let i = 0; i < qty; i++) {
    const id = allocateKeyTxn(productId, discordUserId);
    if (!id) break;
    ids.push(id);
  }
  return ids;
}

// ---------- Pedidos ----------
function createOrder({ productId, discordUserId, quantity = 1 }) {
  const qty = Math.max(1, Math.round(Number(quantity) || 1));
  return db.transaction(() => {
    const row = db.prepare(`SELECT stock_qty FROM products WHERE id = ?`).get(productId);
    if (!row || (Number(row.stock_qty) || 0) < qty) return null;
    db.prepare(`UPDATE products SET stock_qty = stock_qty - ? WHERE id = ?`).run(qty, productId);
    const info = db
      .prepare(`INSERT INTO orders (product_id, discord_user_id, quantity) VALUES (?, ?, ?)`)
      .run(productId, discordUserId, qty);
    return info.lastInsertRowid;
  })();
}

function attachStripeSession(orderId, sessionId) {
  db.prepare(`UPDATE orders SET stripe_session_id = ? WHERE id = ?`).run(sessionId, orderId);
}

function getOrder(orderId) {
  return db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
}

function getOrderBySessionId(sessionId) {
  return db.prepare(`SELECT * FROM orders WHERE stripe_session_id = ?`).get(sessionId);
}

function markOrderDelivered(orderId, keyId) {
  db.prepare(`UPDATE orders SET status = 'delivered', key_id = ? WHERE id = ?`).run(keyId, orderId);
}

function markOrderStatus(orderId, status) {
  db.prepare(`UPDATE orders SET status = ? WHERE id = ?`).run(status, orderId);
}

function listPendingOrdersByUser(discordUserId) {
  return db
    .prepare(
      `SELECT o.*, p.name AS product_name, p.price_cents, p.currency
       FROM orders o
       JOIN products p ON p.id = o.product_id
       WHERE o.discord_user_id = ? AND o.status = 'pending'
       ORDER BY o.id DESC`
    )
    .all(discordUserId);
}

// ---------- Tickets ----------
function getTicket(channelId) {
  return db.prepare(`SELECT * FROM tickets WHERE channel_id = ?`).get(channelId);
}

const saveTicketTxn = db.transaction(({ channelId, openerId, tipo, claimedBy }) => {
  const existing = getTicket(channelId);
  if (existing) return existing;
  const num = db.prepare(`SELECT COALESCE(MAX(ticket_num), 0) + 1 AS n FROM tickets`).get().n;
  db.prepare(
    `INSERT INTO tickets (channel_id, ticket_num, opener_id, claimed_by, tipo, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`
  ).run(channelId, num, openerId, claimedBy || null, tipo || null);
  return getTicket(channelId);
});

function saveTicket({ channelId, openerId, tipo, claimedBy }) {
  return saveTicketTxn({ channelId, openerId, tipo, claimedBy });
}

function claimTicket(channelId, userId) {
  if (!channelId || !userId) return getTicket(channelId);
  const t = getTicket(channelId);
  if (!t) return null;
  if (t.claimed_by) return t;
  db.prepare(`UPDATE tickets SET claimed_by = ? WHERE channel_id = ?`).run(userId, channelId);
  return getTicket(channelId);
}

function closeTicketRecord(channelId, reason) {
  if (!channelId) return null;
  db.prepare(
    `UPDATE tickets SET closed_at = datetime('now'), close_reason = ? WHERE channel_id = ?`
  ).run(reason || null, channelId);
  return getTicket(channelId);
}

module.exports = {
  addProduct,
  listActiveProducts,
  listActiveProductsByCategory,
  listCategories,
  getProduct,
  getProductByName,
  updateProduct,
  countAvailableKeys,
  getStock,
  setStock,
  addStock,
  addKeysBulk,
  allocateKeyTxn,
  allocateKeys,
  getKeyValue,
  createOrder,
  attachStripeSession,
  getOrder,
  getOrderBySessionId,
  markOrderDelivered,
  markOrderStatus,
  listPendingOrdersByUser,
  getTicket,
  saveTicket,
  claimTicket,
  closeTicketRecord,
};
