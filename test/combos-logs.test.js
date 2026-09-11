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
assert.strictEqual(bot.CATEGORIA_POR_COMANDO['loja-box'], 'box');
assert.strictEqual(bot.CATEGORIA_POR_COMANDO['loja-vps'], 'vps');
assert.strictEqual(bot.CATEGORIA_POR_COMANDO['loja-steam'], 'steam');
assert.strictEqual(bot.CATEGORIA_POR_COMANDO['loja-keys'], 'keys');
assert.strictEqual(bot.STATUS_BOT, '⏳ processando pagamento...');
assert.strictEqual(bot.STATUS_BOT_EMOJI.id, '1453368332622495775');
assert.strictEqual(bot.STATUS_BOT_EMOJI.name, '1192548293067165838');
assert.strictEqual(bot.STATUS_BOT_EMOJI.animated, true);
const presenca = bot.montarPresencaStatus();
assert.strictEqual(presenca.activities[0].state, '⏳ processando pagamento...');
assert.strictEqual(presenca.activities[0].emoji.id, '1453368332622495775');
assert.strictEqual(presenca.activities[0].emoji.name, '1192548293067165838');
assert.strictEqual(presenca.activities[0].emoji.animated, true);

assert.strictEqual(bot.PAINEL_TEXTOS.combos.titulo, 'Combos');
const painel = bot.PAINEL_TEXTOS.combos.descricao;
for (const trecho of [
  `${bot.EMOJI_PACK} Semanal ( sp00fer e Rock )`,
  `${bot.EMOJI_BOLINHA} 1x Sp00fer 1 Click Semanal`,
  `${bot.EMOJI_BOLINHA} 5x conta Rockst4r Novas.`,
  `${bot.EMOJI_PACK} Mensal ( sp00fer e Rock )`,
  `${bot.EMOJI_BOLINHA} 1x Sp00fer 1 Click Mensal`,
  `${bot.EMOJI_BOLINHA} 10x conta Rockst4r Novas.`,
]) {
  assert(painel.includes(trecho), `painel combos deveria incluir: ${trecho}`);
}
assert.strictEqual(bot.EMOJI_PACK, '<:1437199989053853806:1547957248498737263>');
assert.strictEqual(bot.EMOJI_BOLINHA, '<:1377885173747548252:1547957223890624522>');
assert.strictEqual(bot.EMOJI_TREVO, '<a:1263270455482122352:1453366951438061598>');
assert(painel.includes(`${bot.EMOJI_PACK} Lifetime ( sp00fer e Rock )`));
assert(painel.includes(`${bot.EMOJI_BOLINHA} 50x conta Rockst4r Novas.`));
assert(bot.PAINEL_TEXTOS.combos.imagemFile.endsWith('banner-combos.png'));
assert(bot.PAINEL_TEXTOS.spofer.imagemFile.endsWith('banner-spofer.png'));
assert(bot.PAINEL_TEXTOS.lifetime.imagemFile.endsWith('banner-lifetime.png'));
assert(bot.PAINEL_TEXTOS.box.imagemFile.endsWith('banner-box.png'));
assert(bot.PAINEL_TEXTOS.vps.imagemFile.endsWith('banner-vps.png'));
assert(bot.PAINEL_TEXTOS.steam.imagemFile.endsWith('banner-steam.png'));
assert(bot.PAINEL_TEXTOS.keys.imagemFile.endsWith('banner-keys.png'));
assert.strictEqual(bot.PAINEL_TEXTOS.keys.titulo, 'ST34M KEYS');
assert(bot.PAINEL_TEXTOS.keys.descricao.includes(`${bot.EMOJI_PACK} Steam Key Platina`));
assert(bot.PAINEL_TEXTOS.keys.descricao.includes(`${bot.EMOJI_BOLINHA} SEM JOGOS +18 e PODE CONTER JOGOS REPETIDOS.`));
assert(bot.PAINEL_TEXTOS.keys.descricao.includes(`${bot.EMOJI_PACK} Steam Key +R$100`));
assert(bot.PAINEL_TEXTOS.keys.descricao.includes(`${bot.EMOJI_BOLINHA} Steam key jogo de R$ 100 ou mais.`));
assert(bot.PAINEL_TEXTOS.keys.descricao.includes(`${bot.EMOJI_PACK} Steam Key +R$500`));
assert(bot.PAINEL_TEXTOS.keys.descricao.includes(`${bot.EMOJI_BOLINHA} Steam key jogo de R$ 500 ou mais.`));
assert(bot.PAINEL_TEXTOS.keys.descricao.includes(`${bot.EMOJI_PACK} Triple A`));
assert(bot.PAINEL_TEXTOS.keys.descricao.includes(`${bot.EMOJI_PACK} Key Deluxe`));
assert(bot.PAINEL_TEXTOS.keys.descricao.includes('Trocas somente com vídeo desde o recebimento.'));
assert(!bot.PAINEL_TEXTOS.keys.descricao.includes('€'));
assert.strictEqual(bot.PAINEL_TEXTOS.steam.titulo, 'C0nta Steam');
assert(bot.PAINEL_TEXTOS.steam.descricao.includes(`${bot.EMOJI_BOLINHA} C0nt4s Steam`));
assert(bot.PAINEL_TEXTOS.steam.descricao.includes(`${bot.EMOJI_BOLINHA} Full Acesso`));
assert(bot.PAINEL_TEXTOS.steam.descricao.includes(`${bot.EMOJI_BOLINHA} C0nt4s nova e só sua`));
assert(bot.PAINEL_TEXTOS.steam.descricao.includes(`${bot.EMOJI_BOLINHA} Assim que receber, troque tudo imediatamente`));
assert(!bot.PAINEL_TEXTOS.steam.descricao.includes('€'));
assert.strictEqual(bot.PAINEL_TEXTOS.vps.titulo, 'VPN IP VANISH NFA');
assert(bot.PAINEL_TEXTOS.vps.descricao.includes(`${bot.EMOJI_PACK} 5 Dias`));
assert(bot.PAINEL_TEXTOS.vps.descricao.includes(`${bot.EMOJI_BOLINHA} 1x Ip Vanish 5 Dias`));
assert(bot.PAINEL_TEXTOS.vps.descricao.includes(`${bot.EMOJI_PACK} 1 Mês`));
assert(bot.PAINEL_TEXTOS.vps.descricao.includes(`${bot.EMOJI_BOLINHA} 1x Ip Vanish 1 Mês`));
assert(bot.PAINEL_TEXTOS.vps.descricao.includes(`${bot.EMOJI_BOLINHA} Mais de 1 milhão de IPs brasileiros e mundiais à sua disposição.`));
assert(bot.PAINEL_TEXTOS.vps.descricao.includes(`${bot.EMOJI_BOLINHA} Tire seus ban por IPs (em cidades que permitem o uso de VPN)`));
assert(bot.PAINEL_TEXTOS.vps.descricao.includes(`${bot.EMOJI_BOLINHA} Melhor VPN`));
assert(bot.PAINEL_TEXTOS.vps.descricao.includes(`${bot.EMOJI_BOLINHA} Não compre mais de 1`));
assert(bot.PAINEL_TEXTOS.vps.descricao.includes(`${bot.EMOJI_BOLINHA} NFA`));
assert(!bot.PAINEL_TEXTOS.vps.descricao.includes('€'));
assert.strictEqual(bot.PAINEL_TEXTOS.box.titulo, 'Denver Box');
assert(bot.PAINEL_TEXTOS.box.descricao.includes(`${bot.EMOJI_PACK} Denver Box Gold`));
assert(bot.PAINEL_TEXTOS.box.descricao.includes(`${bot.EMOJI_PACK} Denver Box Platina`));
assert(bot.PAINEL_TEXTOS.box.descricao.includes(`${bot.EMOJI_PACK} Denver Box Diamante`));
assert(bot.PAINEL_TEXTOS.box.descricao.includes(`${bot.EMOJI_BOLINHA} Pode vir com diversos produtos, incluindo chaves diárias`));
assert(bot.PAINEL_TEXTOS.box.descricao.includes('chaves de 3 a 7 dias'));
assert(bot.PAINEL_TEXTOS.box.descricao.includes('chaves de 7 a 31 dias'));
assert(bot.PAINEL_TEXTOS.box.descricao.includes(`${bot.EMOJI_TREVO} Box mais caras oferecem maiores chances`));
assert(!bot.PAINEL_TEXTOS.box.descricao.includes('🍀'));
assert(!bot.PAINEL_TEXTOS.box.descricao.includes('€'));
assert(bot.PAINEL_TEXTOS.spofer.descricao.includes(`${bot.EMOJI_BOLINHA} Remove ban Global/HWID.`));
assert(bot.PAINEL_TEXTOS.spofer.descricao.includes(`${bot.EMOJI_BOLINHA} Sp00fer consta com tutorial.`));
assert(bot.PAINEL_TEXTOS.spofer.descricao.includes(`${bot.EMOJI_BOLINHA} Nvidia・100%`));
assert(bot.PAINEL_TEXTOS.spofer.descricao.includes(`${bot.EMOJI_BOLINHA} AMD・100%`));
assert(bot.PAINEL_TEXTOS.spofer.descricao.includes(`${bot.EMOJI_BOLINHA} Melhor sp00fer para remover B4N de cidades one click`));
assert(!bot.PAINEL_TEXTOS.spofer.descricao.includes('€'));
assert.strictEqual(bot.PAINEL_TEXTOS.lifetime.titulo, 'SP00FER 1 CLICK PERMANENTE');
assert(bot.PAINEL_TEXTOS.lifetime.descricao.includes(`${bot.EMOJI_BOLINHA} REMOVE O BANIMENTO PARA SEMPRE COM 1 CLICK`));
assert(bot.PAINEL_TEXTOS.lifetime.descricao.includes(`${bot.EMOJI_BOLINHA} NÃO PRECISA DAR FLASH NA BIOS`));
assert(bot.PAINEL_TEXTOS.lifetime.descricao.includes(`${bot.EMOJI_BOLINHA} PODE REINICIAR E DESLIGAR O COMPUTADOR QUE O BAN NÃO VOLTA`));
assert(bot.PAINEL_TEXTOS.lifetime.descricao.includes(`${bot.EMOJI_BOLINHA} AMD 100%`));
assert(bot.PAINEL_TEXTOS.lifetime.descricao.includes(`${bot.EMOJI_BOLINHA} NVIDIA 100%`));
assert(bot.PAINEL_TEXTOS.lifetime.descricao.includes(`${bot.EMOJI_BOLINHA} MELHOR SP00FER PARA REMOVER B4N GLOBAL`));
assert(!bot.PAINEL_TEXTOS.lifetime.descricao.includes('€'));
assert(!bot.PAINEL_TEXTOS.lifetime.descricao.includes('Lifetime ( sp00fer e Rock )'));
assert(!bot.PAINEL_TEXTOS.lifetime.descricao.includes('50x conta Rockst4r Novas.'));

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
assert.ok(semanal && mensal);
assert.strictEqual(semanal.price_cents, 1200);
assert.strictEqual(mensal.price_cents, 2000);
assert.strictEqual(semanal.category, 'combos');
assert.strictEqual(db.listActiveProductsByCategory('combos').length, 3);

const spoferHora = db.getProductByName('Sp00fer Hora');
const spoferDia = db.getProductByName('Sp00fer Diário');
const spoferSem = db.getProductByName('Sp00fer Semanal');
const spoferMen = db.getProductByName('Sp00fer Mensal');
const spoferLife = db.getProductByName('Sp00fer Lifetime');
const comboLife = db.getProductByName('Combo Lifetime (sp00fer e Rock)');
assert.ok(spoferHora && spoferDia && spoferSem && spoferMen && spoferLife && comboLife);
assert.strictEqual(spoferHora.category, 'spofer');
assert.strictEqual(spoferDia.category, 'spofer');
assert.strictEqual(spoferSem.category, 'spofer');
assert.strictEqual(spoferMen.category, 'spofer');
assert.strictEqual(spoferLife.category, 'spofer');
assert.strictEqual(comboLife.category, 'combos');
assert.strictEqual(comboLife.active, 1);
assert.strictEqual(spoferHora.price_cents, 200);
assert.strictEqual(spoferDia.price_cents, 500);
assert.strictEqual(spoferSem.price_cents, 1200);
assert.strictEqual(spoferMen.price_cents, 2000);
assert.strictEqual(spoferLife.price_cents, 5000);
assert.strictEqual(comboLife.price_cents, 5000);
assert.strictEqual(db.listActiveProductsByCategory('spofer').length, 5);

const permDia = db.getProductByName('Sp00fer Permanente Diário');
const permSem = db.getProductByName('Sp00fer Permanente Semanal');
const permMen = db.getProductByName('Sp00fer Permanente Mensal');
const permTri = db.getProductByName('Sp00fer Permanente Trimensal');
const permLife = db.getProductByName('Sp00fer Permanente Lifetime');
assert.ok(permDia && permSem && permMen && permTri && permLife);
assert.strictEqual(permDia.price_cents, 500);
assert.strictEqual(permSem.price_cents, 1500);
assert.strictEqual(permMen.price_cents, 2200);
assert.strictEqual(permTri.price_cents, 3299);
assert.strictEqual(permLife.price_cents, 5000);
assert.strictEqual(db.listActiveProductsByCategory('lifetime').length, 5);

const boxGold = db.getProductByName('Denver Box Gold');
const boxPlatina = db.getProductByName('Denver Box Platina');
const boxDiamante = db.getProductByName('Denver Box Diamante');
assert.ok(boxGold && boxPlatina && boxDiamante);
assert.strictEqual(boxGold.category, 'box');
assert.strictEqual(boxPlatina.category, 'box');
assert.strictEqual(boxDiamante.category, 'box');
assert.strictEqual(boxGold.price_cents, 500);
assert.strictEqual(boxPlatina.price_cents, 1000);
assert.strictEqual(boxDiamante.price_cents, 1500);
assert.strictEqual(db.listActiveProductsByCategory('box').length, 3);

const vanish5 = db.getProductByName('Ip Vanish 5 Dias');
const vanishMes = db.getProductByName('Ip Vanish 1 Mês');
assert.ok(vanish5 && vanishMes);
assert.strictEqual(vanish5.category, 'vps');
assert.strictEqual(vanishMes.category, 'vps');
assert.strictEqual(vanish5.price_cents, 300);
assert.strictEqual(vanishMes.price_cents, 1000);
assert.strictEqual(db.listActiveProductsByCategory('vps').length, 2);

const steamAcc = db.getProductByName('C0nta Steam');
assert.ok(steamAcc);
assert.strictEqual(steamAcc.category, 'steam');
assert.strictEqual(steamAcc.price_cents, 400);
assert.strictEqual(db.listActiveProductsByCategory('steam').length, 1);

const key18 = db.getProductByName('Steam Key +18');
const keyPlatina = db.getProductByName('Steam Key Platina');
const keyCartas = db.getProductByName('Steam Key Cartas');
const key100 = db.getProductByName('Steam Key +R$100');
const key500 = db.getProductByName('Steam Key +R$500');
assert.ok(key18 && keyPlatina && keyCartas && key100 && key500);
assert.strictEqual(key18.price_cents, 100);
assert.strictEqual(keyPlatina.price_cents, 200);
assert.strictEqual(keyCartas.price_cents, 300);
assert.strictEqual(key100.price_cents, 1000);
assert.strictEqual(key500.price_cents, 2000);
assert.strictEqual(db.listActiveProductsByCategory('keys').length, 5);

const idAntigo = db.addProduct({
  name: 'Sp00fer 1 Click Semanal',
  priceCents: 800,
  currency: 'eur',
  category: 'spofer',
});
bot.seedProdutosIniciais();
assert.strictEqual(db.getProduct(idAntigo).active, 0);
assert.strictEqual(db.getProductByName('Sp00fer Semanal').active, 1);
assert.strictEqual(db.listActiveProductsByCategory('spofer').length, 5);

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
assert(aberto.includes('Combos'));
assert(aberto.includes(`${bot.EMOJI_PACK} Semanal ( sp00fer e Rock )`));
assert(aberto.includes(`${bot.EMOJI_BOLINHA} 1x Sp00fer 1 Click Semanal`));
assert(aberto.includes('attachment://banner-combos.png'));
assert(aberto.includes('Preço:'));
assert(aberto.includes('12,00'));

const spoferPainel = JSON.stringify(bot.gerarPainelLoja(db.listActiveProductsByCategory('spofer'), 'spofer').payload);
assert(spoferPainel.includes('attachment://banner-spofer.png'));
assert(spoferPainel.includes('SPOOFER ONE CLICK'));
assert(spoferPainel.includes(`${bot.EMOJI_BOLINHA} Remove ban Global/HWID.`));
assert(spoferPainel.includes('Nvidia・100%'));
assert(spoferPainel.includes('cidades one click'));

const lifePainel = JSON.stringify(bot.gerarPainelLoja(db.listActiveProductsByCategory('lifetime'), 'lifetime').payload);
assert(lifePainel.includes('attachment://banner-lifetime.png'));
assert(lifePainel.includes('SP00FER 1 CLICK PERMANENTE'));
assert(lifePainel.includes(`${bot.EMOJI_BOLINHA} NÃO PRECISA DAR FLASH NA BIOS`));
assert(lifePainel.includes(`${bot.EMOJI_BOLINHA} MELHOR SP00FER PARA REMOVER B4N GLOBAL`));
assert(!lifePainel.includes('Lifetime ( sp00fer e Rock )'));
assert(aberto.includes(`${bot.EMOJI_PACK} Lifetime ( sp00fer e Rock )`));
assert(aberto.includes(`${bot.EMOJI_BOLINHA} 50x conta Rockst4r Novas.`));

const boxPainel = JSON.stringify(bot.gerarPainelLoja(db.listActiveProductsByCategory('box'), 'box').payload);
assert(boxPainel.includes('attachment://banner-box.png'));
assert(boxPainel.includes('Denver Box'));
assert(boxPainel.includes('Denver Box Gold'));
assert(boxPainel.includes('Denver Box Platina'));
assert(boxPainel.includes('Denver Box Diamante'));
assert(boxPainel.includes(bot.EMOJI_TREVO));
assert(!boxPainel.includes('🍀'));

const vpsPainel = JSON.stringify(bot.gerarPainelLoja(db.listActiveProductsByCategory('vps'), 'vps').payload);
assert(vpsPainel.includes('attachment://banner-vps.png'));
assert(vpsPainel.includes('VPN IP VANISH NFA'));
assert(vpsPainel.includes(`${bot.EMOJI_PACK} 5 Dias`));
assert(vpsPainel.includes(`${bot.EMOJI_BOLINHA} 1x Ip Vanish 1 Mês`));
assert(vpsPainel.includes('NFA'));

const steamPainel = JSON.stringify(bot.gerarPainelLoja(db.listActiveProductsByCategory('steam'), 'steam').payload);
assert(steamPainel.includes('attachment://banner-steam.png'));
assert(steamPainel.includes('C0nta Steam'));
assert(steamPainel.includes('C0nt4s Steam'));
assert(steamPainel.includes('Full Acesso'));
assert(steamPainel.includes('C0nt4s nova e só sua'));
assert(steamPainel.includes('Assim que receber, troque tudo imediatamente'));
assert(steamPainel.includes(bot.EMOJI_BOLINHA));

const keysPainel = JSON.stringify(bot.gerarPainelLoja(db.listActiveProductsByCategory('keys'), 'keys').payload);
assert(keysPainel.includes('attachment://banner-keys.png'));
assert(keysPainel.includes('ST34M KEYS'));
assert(keysPainel.includes('Steam Key Platina'));
assert(keysPainel.includes('Steam Key +R$500'));
assert(keysPainel.includes('Trocas somente com vídeo desde o recebimento.'));

function formatarPainelCombos() {
  const products = db.listActiveProductsByCategory('combos');
  const painelLoja = bot.gerarPainelLoja(products, 'combos');
  const texto = JSON.stringify(painelLoja.payload);
  if (!texto.includes(`${bot.EMOJI_PACK} Semanal ( sp00fer e Rock )`)) fail('painel V2 sem o texto dos combos');
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
