// db.js
// Base de dados local em SQLite (ficheiro loja.db criado automaticamente).
// Guarda: produtos (os teus jogos), chaves disponíveis por produto, e pedidos (compras).

const Database = require('better-sqlite3');
const db = new Database('loja.db');

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  price_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'eur',
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

// ---------- Produtos ----------
function addProduct({ name, description, priceCents, currency, roleId }) {
  const stmt = db.prepare(
    `INSERT INTO products (name, description, price_cents, currency, role_id) VALUES (?, ?, ?, ?, ?)`
  );
  const info = stmt.run(name, description || '', priceCents, currency || 'eur', roleId || null);
  return info.lastInsertRowid;
}

function listActiveProducts() {
  return db.prepare(`SELECT * FROM products WHERE active = 1 ORDER BY id DESC`).all();
}

function getProduct(id) {
  return db.prepare(`SELECT * FROM products WHERE id = ?`).get(id);
}

function countAvailableKeys(productId) {
  return db
    .prepare(`SELECT COUNT(*) AS n FROM keys WHERE product_id = ? AND used = 0`)
    .get(productId).n;
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

// ---------- Pedidos ----------
function createOrder({ productId, discordUserId }) {
  const info = db
    .prepare(`INSERT INTO orders (product_id, discord_user_id) VALUES (?, ?)`)
    .run(productId, discordUserId);
  return info.lastInsertRowid;
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

module.exports = {
  addProduct,
  listActiveProducts,
  getProduct,
  countAvailableKeys,
  addKeysBulk,
  allocateKeyTxn,
  getKeyValue,
  createOrder,
  attachStripeSession,
  getOrder,
  getOrderBySessionId,
  markOrderDelivered,
  markOrderStatus,
};
