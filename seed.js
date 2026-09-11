// seed.js
// Configura os preços da loja. Idempotente: cria produtos novos e atualiza
// preço/moeda/categoria dos que já existem (não duplica).
//
// Uso:   npm run seed
// Moeda: por omissão 'eur' (€). Outra moeda:  SEED_CURRENCY=brl npm run seed

const db = require('./db');
const { formatPrice } = require('./currency');

const currency = (process.env.SEED_CURRENCY || 'eur').toLowerCase();

function cents(valor) {
  return Math.round(valor * 100);
}

// Catálogo organizado por canal (categoria). Os nomes têm de coincidir com os
// produtos do bot. Os preços das Nitradas:
//   Preço: De 5,00 € a 15,00 €
const CATALOG = [
  {
    category: 'Painéis & Métodos',
    products: [
      { name: 'Painel SMS', priceCents: cents(1) },
      { name: 'Painel do 7', priceCents: cents(1) },
      { name: 'Método Ifood', priceCents: cents(1.2) },
      { name: 'Método internet grátis', priceCents: cents(1.1) },
      { name: 'Método banir insta', priceCents: cents(1.2) },
      { name: 'Modelo loja', priceCents: cents(1) },
    ],
  },
  {
    category: 'Impulsos',
    products: [
      { name: '2x impulsos', priceCents: cents(3) },
      { name: '6x impulsos', priceCents: cents(6) },
      { name: '8x impulsos', priceCents: cents(8) },
      { name: '14x impulsos', priceCents: cents(10) },
      { name: '14x impulsos trimensais', priceCents: cents(15) },
    ],
  },
  {
    category: 'Nitradas',
    products: [
      { name: 'Nitrada Mensal', priceCents: cents(5) },
      { name: 'Nitrada Trimensal', priceCents: cents(9) },
      { name: 'Nitrada Anual', priceCents: cents(15) },
    ],
  },
  {
    category: 'Links',
    products: [
      { name: 'Nitro Link Mensal', priceCents: cents(3) },
      { name: 'Nitro Link Trimensal', priceCents: cents(6) },
      { name: 'Ativação do Nitro', priceCents: cents(4) },
    ],
  },
  {
    category: 'trial',
    products: [{ name: 'Trial Nitro', priceCents: cents(2) }],
  },
  {
    category: 'virgem',
    products: [{ name: 'Conta Virgem', priceCents: cents(4) }],
  },
  {
    category: 'aged',
    products: [
      { name: 'Conta 2016', priceCents: cents(20) },
      { name: 'Conta 2017', priceCents: cents(15) },
      { name: 'Conta 2018', priceCents: cents(10) },
      { name: 'Conta 2019', priceCents: cents(7) },
      { name: 'Conta 2020', priceCents: cents(5) },
      { name: 'Conta 2021', priceCents: cents(2.5) },
      { name: 'Conta 2022', priceCents: cents(2) },
    ],
  },
  {
    category: 'spotify',
    products: [
      { name: 'Conta Spotify Premium', priceCents: cents(4) },
      { name: 'Link Spotify Trimensal', priceCents: cents(0.5) },
    ],
  },
  {
    category: 'membros',
    products: [
      { name: '100x membros online', priceCents: cents(6) },
      { name: '100x membros offline', priceCents: cents(3) },
    ],
  },
  {
    category: 'trampo',
    products: [{ name: 'Trampo fazendo dinheiro', priceCents: cents(5) }],
  },
  {
    category: 'cloner',
    products: [{ name: 'Clonar site', priceCents: cents(5) }],
  },
  {
    category: 'roblox',
    products: [
      { name: '1000-2500 robux acc', priceCents: cents(6) },
      { name: '2500-5000 robux acc', priceCents: cents(8) },
      { name: '5000-10000 robux acc', priceCents: cents(12) },
      { name: '10000-15000 robux acc', priceCents: cents(16) },
      { name: '15000-25000 robux acc', priceCents: cents(20) },
      { name: '25000-50000 robux acc', priceCents: cents(25) },
    ],
  },
  {
    category: 'fortnite',
    products: [
      { name: '100-150 Skins', priceCents: cents(10) },
      { name: '150-250 Skins', priceCents: cents(15) },
      { name: '100-250 Tryhard Skins', priceCents: cents(20) },
      { name: '250-400 Skins', priceCents: cents(25) },
    ],
  },
  {
    category: 'rockstar',
    products: [
      { name: '1 Rockstar Acc', priceCents: cents(4) },
      { name: '20 Rockstar Acc', priceCents: cents(15) },
    ],
  },
  {
    category: 'combos',
    products: [
      {
        name: 'Combo Semanal (sp00fer e Rock)',
        priceCents: cents(12),
        description: '1x Sp00fer 1 Click Semanal + 5x conta Rockst4r Novas',
      },
      {
        name: 'Combo Mensal (sp00fer e Rock)',
        priceCents: cents(20),
        description: '1x Sp00fer 1 Click Mensal + 10x conta Rockst4r Novas',
      },
      {
        name: 'Combo Lifetime (sp00fer e Rock)',
        priceCents: cents(50),
        description: '1x Sp00fer 1 Click Lifetime + 50x conta Rockst4r Novas',
      },
    ],
  },
  {
    category: 'spofer',
    products: [
      { name: 'Sp00fer Hora', priceCents: cents(2) },
      { name: 'Sp00fer Diário', priceCents: cents(5) },
      { name: 'Sp00fer Semanal', priceCents: cents(12), antigoNome: 'Sp00fer 1 Click Semanal' },
      { name: 'Sp00fer Mensal', priceCents: cents(20), antigoNome: 'Sp00fer 1 Click Mensal' },
      { name: 'Sp00fer Lifetime', priceCents: cents(50), antigoNome: 'Sp00fer 1 Click Lifetime' },
    ],
  },
  {
    category: 'lifetime',
    products: [
      { name: 'Sp00fer Permanente Diário', priceCents: cents(5) },
      { name: 'Sp00fer Permanente Semanal', priceCents: cents(15) },
      { name: 'Sp00fer Permanente Mensal', priceCents: cents(22) },
      { name: 'Sp00fer Permanente Trimensal', priceCents: cents(32.99) },
      { name: 'Sp00fer Permanente Lifetime', priceCents: cents(50) },
    ],
  },
  {
    category: 'box',
    products: [
      {
        name: 'Stopped Box Gold',
        priceCents: cents(5),
        antigoNome: 'Box Gold',
        description: 'Pode vir com diversos produtos, incluindo chaves diárias dos nossos softwares.',
      },
      {
        name: 'Stopped Box Platina',
        priceCents: cents(10),
        antigoNome: 'Caixa Platina',
        description: 'Pode vir com diversos produtos, incluindo chaves de 3 a 7 dias dos nossos softwares.',
      },
      {
        name: 'Stopped Box Diamante',
        priceCents: cents(15),
        antigoNome: 'Caixa Diamond',
        description: 'Pode vir com diversos produtos, incluindo chaves de 7 a 31 dias dos nossos softwares.',
      },
    ],
  },
];

function seed() {
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let total = 0;

  for (const group of CATALOG) {
    console.log(`\n# Canal: ${group.category || '(avulsos)'}`);
    for (const p of group.products) {
      total += 1;
      const existente = db.getProductByName(p.name) || (p.antigoNome ? db.getProductByName(p.antigoNome) : null);
      if (existente) {
        const mesmoNome = existente.name === p.name;
        const mesmoPreco = existente.price_cents === p.priceCents;
        const mesmaMoeda = String(existente.currency || '').toLowerCase() === currency;
        const mesmaCategoria = existente.category === group.category;
        const mesmoAtivo = Boolean(existente.active);
        if (mesmoNome && mesmoPreco && mesmaMoeda && mesmaCategoria && mesmoAtivo) {
          unchanged += 1;
          console.log(`  = igual: ${p.name} — ${formatPrice(p.priceCents, currency)}`);
          continue;
        }
        db.updateProduct(existente.id, {
          name: p.name,
          priceCents: p.priceCents,
          currency,
          category: group.category,
          active: true,
        });
        updated += 1;
        console.log(
          `  ~ atualizado #${existente.id}: ${p.name} — ${formatPrice(p.priceCents, currency)}`
        );
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

  for (const group of CATALOG) {
    for (const p of group.products) {
      if (!p.antigoNome) continue;
      const velho = db.getProductByName(p.antigoNome);
      if (velho && velho.name !== p.name) db.setProductActive(velho.id, false);
    }
  }

  const nitradas = CATALOG.find((g) => g.category === 'Nitradas').products;
  const min = Math.min(...nitradas.map((p) => p.priceCents));
  const max = Math.max(...nitradas.map((p) => p.priceCents));
  const faixaNitradas =
    min === max
      ? formatPrice(min, currency)
      : `De ${formatPrice(min, currency)} a ${formatPrice(max, currency)}`;

  console.log(
    `\n${created} criado(s), ${updated} atualizado(s), ${unchanged} já certo(s) de ${total}. Moeda: ${currency.toUpperCase()}.`
  );
  console.log(`Painel Nitradas (print): Preço: ${faixaNitradas}`);
  console.log('Reinicia o bot e volta a publicar o painel (!loja-nitradas ou /loja-nitradas).');
}

seed();
