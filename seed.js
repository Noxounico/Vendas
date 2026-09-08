// seed.js
// Cria os produtos iniciais da loja. Idempotente: não duplica produtos já criados.
//
// Uso:   npm run seed
// Moeda: por omissão 'eur'. Para carregar noutra moeda (ex.: reais), define
//        SEED_CURRENCY antes de correr, p.ex.:  SEED_CURRENCY=brl npm run seed
//        (os valores numéricos são os mesmos; não há conversão automática).

const db = require('./db');
const { formatPrice } = require('./currency');

const currency = (process.env.SEED_CURRENCY || 'eur').toLowerCase();

const PRODUCTS = [
  { name: 'Painel SMS', priceCents: 100 },
  { name: 'Painel do 7', priceCents: 100 },
  { name: 'Método Ifood', priceCents: 120 },
  { name: 'Método internet grátis', priceCents: 110 },
  { name: 'Método banir insta', priceCents: 120 },
  { name: 'Modelo loja', priceCents: 100 },
];

function seed() {
  const existing = new Set(db.listActiveProducts().map((p) => p.name));
  let created = 0;

  for (const p of PRODUCTS) {
    if (existing.has(p.name)) {
      console.log(`= já existe: ${p.name}`);
      continue;
    }
    const id = db.addProduct({
      name: p.name,
      description: p.description || '',
      priceCents: p.priceCents,
      currency,
    });
    created += 1;
    console.log(`+ criado #${id}: ${p.name} — ${formatPrice(p.priceCents, currency)}`);
  }

  console.log(
    `\n${created} produto(s) criado(s), ${PRODUCTS.length - created} já existente(s). Moeda: ${currency.toUpperCase()}.`
  );
  console.log('Agora carrega as chaves com /chave-adicionar e publica a loja com /loja.');
}

seed();
