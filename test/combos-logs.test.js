'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDb = path.join(os.tmpdir(), `loja-combos-test-${Date.now()}.db`);
process.env.DATABASE_PATH = tmpDb;
delete process.env.LOG_CHANNEL_ID;
delete process.env.PEDIDOS_CHANNEL_ID;
delete process.env.LOGS_ENTREGA_CHANNEL_ID;
delete process.env.TICKETS_LOGS_CHANNEL_ID;

const db = require('../db');
const bot = require('../index');

const STAFF_ID = '1443307566921678968';

function fail(msg) {
  throw new Error(msg);
}

assert.strictEqual(bot.logsCanalId(), '1545391162305810463');
assert.strictEqual(bot.ticketsLogsCanalId(), '1318660945064755291');

process.env.LOG_CHANNEL_ID = '999999999999999999';
assert.strictEqual(
  bot.logsCanalId(),
  '1545391162305810463',
  'LOG_CHANNEL_ID antigo não pode desviar os logs de entrega'
);
delete process.env.LOG_CHANNEL_ID;

process.env.LOGS_ENTREGA_CHANNEL_ID = '111';
assert.strictEqual(bot.logsCanalId(), '111');
delete process.env.LOGS_ENTREGA_CHANNEL_ID;

assert.strictEqual(bot.CATEGORIA_POR_COMANDO['loja-combos'], 'combos');
assert.strictEqual(bot.CATEGORIA_POR_COMANDO['loja-spofer'], 'spofer');
assert.strictEqual(bot.CATEGORIA_POR_COMANDO['loja-lifetime'], 'lifetime');
assert.strictEqual(bot.STATUS_BOT, 'processando pagamento...');
assert.strictEqual(bot.STATUS_BOT_EMOJI.id, '1453368332622495775');
assert.strictEqual(bot.STATUS_BOT_EMOJI.name, '1192548293067165838');
assert.strictEqual(bot.STATUS_BOT_EMOJI.animated, true);
const presenca = bot.montarPresencaStatus();
assert.strictEqual(presenca.activities[0].state, 'processando pagamento...');
assert.strictEqual(presenca.activities[0].emoji.id, '1453368332622495775');
assert.strictEqual(presenca.activities[0].emoji.name, '1192548293067165838');
assert.strictEqual(presenca.activities[0].emoji.animated, true);

const painel = bot.PAINEL_TEXTOS.combos.descricao;
for (const trecho of [
  '💠 Semanal ( sp00fer e Rock )',
  '🔵 1x Sp00fer 1 Click Semanal',
  '🔵 5x conta Rockst4r Novas.',
  '💠 Mensal ( sp00fer e Rock )',
  '🔵 1x Sp00fer 1 Click Mensal',
  '🔵 10x conta Rockst4r Novas.',
  '💠 Lifetime ( sp00fer e Rock )',
  '🔵 1x Sp00fer 1 Click Lifetime',
  '🔵 50x conta Rockst4r Novas.',
]) {
  assert(painel.includes(trecho), `painel combos deveria incluir: ${trecho}`);
}
assert(bot.PAINEL_TEXTOS.combos.imagemFile.endsWith('banner-combos.png'));
assert(bot.PAINEL_TEXTOS.spofer.imagemFile.endsWith('banner-spofer.png'));
assert(bot.PAINEL_TEXTOS.lifetime.imagemFile.endsWith('banner-lifetime.png'));
assert(bot.PAINEL_TEXTOS.spofer.descricao.includes('Sp00fer 1 Click Semanal'));
assert(bot.PAINEL_TEXTOS.lifetime.descricao.includes('Sp00fer 1 Click Lifetime'));

const combosSeed = bot.PRODUTOS_SEED.filter((p) => p.categoria === 'combos');
assert.strictEqual(combosSeed.length, 3);
assert.deepStrictEqual(
  combosSeed.map((p) => [p.nome, p.preco]),
  [
    ['Combo Semanal (sp00fer e Rock)', 1200],
    ['Combo Mensal (sp00fer e Rock)', 2000],
    ['Combo Lifetime (sp00fer e Rock)', 5000],
  ]
);

bot.seedProdutosIniciais();
const semanal = db.getProductByName('Combo Semanal (sp00fer e Rock)');
const mensal = db.getProductByName('Combo Mensal (sp00fer e Rock)');
const lifetime = db.getProductByName('Combo Lifetime (sp00fer e Rock)');
assert.ok(semanal && mensal && lifetime);
assert.strictEqual(semanal.price_cents, 1200);
assert.strictEqual(mensal.price_cents, 2000);
assert.strictEqual(lifetime.price_cents, 5000);
assert.strictEqual(semanal.category, 'combos');

const spoferSem = db.getProductByName('Sp00fer 1 Click Semanal');
const spoferMen = db.getProductByName('Sp00fer 1 Click Mensal');
const spoferLife = db.getProductByName('Sp00fer 1 Click Lifetime');
assert.ok(spoferSem && spoferMen && spoferLife);
assert.strictEqual(spoferSem.category, 'spofer');
assert.strictEqual(spoferMen.category, 'spofer');
assert.strictEqual(spoferLife.category, 'lifetime');
assert.strictEqual(spoferSem.price_cents, 800);
assert.strictEqual(spoferMen.price_cents, 1500);
assert.strictEqual(spoferLife.price_cents, 3500);

const staffCache = {
  permissions: { has: () => false },
  roles: {
    cache: {
      has: (id) => id === STAFF_ID,
      keys() {
        return [STAFF_ID];
      },
    },
  },
};
const staffApi = {
  permissions: { has: () => false },
  roles: [STAFF_ID],
};
const cliente = {
  permissions: { has: () => false },
  roles: {
    cache: {
      has: () => false,
      keys() {
        return [];
      },
    },
  },
};

assert.strictEqual(bot.ehStaffTickets(staffCache), true);
assert.strictEqual(bot.ehStaffTickets(staffApi), true);
assert.strictEqual(bot.ehStaffTickets(cliente), false);
assert.strictEqual(bot.podeEntregarPedidos({ member: staffCache }), true);
assert.strictEqual(bot.podeEntregarPedidos({ member: staffApi }), true);
assert.strictEqual(
  bot.podeEntregarPedidos({
    member: cliente,
    memberPermissions: { has: () => false },
  }),
  false
);
assert.strictEqual(
  bot.podeEntregarPedidos({
    member: cliente,
    memberPermissions: { has: (bit) => String(bit) === String(8n) || bit === 8n },
  }),
  true
);

const t1 = db.saveTicket({ channelId: 'c1', openerId: 'u1', tipo: 'receber-produto' });
assert.strictEqual(t1.ticket_num, 1);
assert.strictEqual(db.saveTicket({ channelId: 'c1', openerId: 'u1' }).ticket_num, 1);
assert.strictEqual(db.saveTicket({ channelId: 'c2', openerId: 'u2' }).ticket_num, 2);
assert.strictEqual(db.claimTicket('c1', 'staff1').claimed_by, 'staff1');
assert.strictEqual(db.claimTicket('c1', 'staff2').claimed_by, 'staff1');
db.closeTicketRecord('c1', 'pago');
assert.strictEqual(db.getTicket('c1').close_reason, 'pago');

const embed = bot.montarEmbedTicketFechado({
  ticketNum: 17,
  openerId: '111',
  closerId: '222',
  claimedBy: '222',
  openedAt: new Date('2026-09-04T15:19:00.000Z'),
  reason: 'No reason specified',
});
const json = embed.toJSON();
assert.strictEqual(json.title, 'Ticket Closed');
assert.strictEqual(json.color, 0x2ecc71);
const byName = Object.fromEntries(json.fields.map((f) => [f.name, f.value]));
assert.strictEqual(byName['🎫 Ticket ID'], '17');
assert.strictEqual(byName['✅ Opened By'], '<@111>');
assert.strictEqual(byName['❌ Closed By'], '<@222>');
assert.strictEqual(byName['💜 Claimed By'], '<@222>');
assert.strictEqual(byName['ℹ️ Reason'], 'No reason specified');
assert.match(byName['🕐 Open Time'], /setembro de 2026/);
assert.match(byName['🕐 Open Time'], /às/);

const aberto = formatarPainelCombos();
assert(aberto.includes('💠 Semanal ( sp00fer e Rock )'));
assert(aberto.includes('attachment://banner-combos.png'));
assert(aberto.includes('Preço:'));
assert(aberto.includes('12,00'));

const spoferPainel = JSON.stringify(bot.gerarPainelLoja(db.listActiveProductsByCategory('spofer'), 'spofer').payload);
assert(spoferPainel.includes('attachment://banner-spofer.png'));
assert(spoferPainel.includes('SPOOFER ONE CLICK'));

const lifePainel = JSON.stringify(bot.gerarPainelLoja(db.listActiveProductsByCategory('lifetime'), 'lifetime').payload);
assert(lifePainel.includes('attachment://banner-lifetime.png'));
assert(lifePainel.includes('SPOOFER PERMANENTE'));

function formatarPainelCombos() {
  const products = db.listActiveProductsByCategory('combos');
  const painelLoja = bot.gerarPainelLoja(products, 'combos');
  const texto = JSON.stringify(painelLoja.payload);
  if (!texto.includes('💠 Semanal ( sp00fer e Rock )')) fail('painel V2 sem o texto dos combos');
  if (!texto.includes('attachment://banner-combos.png')) fail('painel V2 sem a imagem dos combos');
  return texto;
}

try {
  fs.unlinkSync(tmpDb);
  fs.unlinkSync(`${tmpDb}-wal`);
  fs.unlinkSync(`${tmpDb}-shm`);
} catch {
  /* tmp */
}

console.log('ok: combos, entregar staff, canais de logs e ticket closed');
