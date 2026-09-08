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

// Catálogo organizado por canal (categoria). Cada canal dá origem a um painel
// próprio: publica com  /loja categoria:<Canal>  no canal certo.
const CATALOG = [
  {
    category: null, // Produtos avulsos (sem canal)
    products: [
      { name: 'Painel SMS', priceCents: 100 },
      { name: 'Painel do 7', priceCents: 100 },
      { name: 'Método Ifood', priceCents: 120 },
      { name: 'Método internet grátis', priceCents: 110 },
      { name: 'Método banir insta', priceCents: 120 },
      { name: 'Modelo loja', priceCents: 100 },
    ],
  },
  {
    category: 'Impulsos',
    products: [
      { name: '2x impulsos', priceCents: 120 },
      { name: '6x impulsos', priceCents: 300 },
      { name: '8x impulsos', priceCents: 500 },
      { name: '14x impulsos', priceCents: 800 },
      { name: '14x impulsos trimensais', priceCents: 1000 },
    ],
  },
  {
    category: 'Nitradas',
    products: [
      { name: 'Nitrada Mensal', priceCents: 100 },
      { name: 'Nitrada Trimensal', priceCents: 250 },
      { name: 'Nitrada Anual', priceCents: 700 },
    ],
  },
  {
    category: 'Links',
    products: [
      { name: 'Nitro Link Mensal', priceCents: 80 },
      { name: 'Nitro Link Trimensal', priceCents: 200 },
      { name: 'Ativação do Nitro', priceCents: 100 },
    ],
  },
  {
    category: 'Trial',
    products: [{ name: 'Trial Nitro', priceCents: 80 }],
  },
];

function seed() {
  const existing = new Set(db.listActiveProducts().map((p) => p.name));
  let created = 0;
  let total = 0;

  for (const group of CATALOG) {
    console.log(`\n# Canal: ${group.category || '(avulsos)'}`);
    for (const p of group.products) {
      total += 1;
      if (existing.has(p.name)) {
        console.log(`  = já existe: ${p.name}`);
        continue;
      }
      const id = db.addProduct({
        name: p.name,
        description: p.description || '',
        priceCents: p.priceCents,
        currency,
        category: group.category,
      });
      created += 1;
      console.log(`  + criado #${id}: ${p.name} — ${formatPrice(p.priceCents, currency)}`);
    }
  }

  console.log(
    `\n${created} produto(s) criado(s), ${total - created} já existente(s). Moeda: ${currency.toUpperCase()}.`
  );
  console.log('Carrega as chaves com /chave-adicionar e publica cada canal com /loja categoria:<Canal>.');
}

seed();
