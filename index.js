// index.js
// Corre o bot com: npm start
// Os comandos do bot usam o prefixo ! (ex.: !loja-rockstar, !verificacao).
// Bot de vendas com pagamento MANUAL: o cliente compra, um admin confirma o
// pagamento (botão "Entregar" ou !entregar) e a chave é enviada por DM.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SectionBuilder,
  Events,
  Partials,
  ActivityType,
} = require('discord.js');
// Canvas é opcional (só se algum painel antigo ainda gerar imagem).
// Se o pacote falhar no servidor, o bot continua a ligar na mesma.
let createCanvas;
let loadImage;
try {
  ({ createCanvas, loadImage } = require('@napi-rs/canvas'));
} catch (err) {
  console.warn('Canvas indisponível (os painéis V2 não precisam):', err.message);
}

const db = require('./db');
const { formatPrice } = require('./currency');

// ---------------------------------------------------------------------------
// Geração dos painéis como IMAGEM ÚNICA (banner sempre por cima do texto,
// sem nenhum espaço — é tudo a mesma imagem, não vários embeds do Discord).
// ---------------------------------------------------------------------------

// Quebra um texto em várias linhas para caber em maxWidth (usa o ctx só para
// medir o tamanho do texto com a fonte atual).
function quebrarLinhas(ctx, texto, maxWidth) {
  const palavras = texto.split(' ');
  const linhas = [];
  let atual = '';
  for (const palavra of palavras) {
    const teste = atual ? `${atual} ${palavra}` : palavra;
    if (atual && ctx.measureText(teste).width > maxWidth) {
      linhas.push(atual);
      atual = palavra;
    } else {
      atual = teste;
    }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

// Desenha um retângulo com cantos arredondados (caminho — ainda precisas de
// chamar .fill()/.stroke()/.clip() a seguir).
function desenharRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// A maioria dos servidores Linux não tem fonte de emoji a cores instalada —
// sem ela, o emoji aparece como um quadrado vazio na imagem. Para não
// arriscar isso, tira-se o emoji do texto ANTES de desenhar na imagem (o
// texto dos botões/menus do Discord, esses sim, continuam com emoji certo,
// porque são renderizados pelo próprio Discord, não pela imagem).
function removerEmojis(texto) {
  return texto
    .replace(/[\u{1F1E6}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\uFE0F]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Gera a imagem final (PNG) do painel: banner + título + bullets +
// (opcional) caixa de entrega + (opcional) preço/instrução.
// cor: número hex (ex.: 0x9b59b6), igual ao que se passa ao EmbedBuilder.
async function gerarImagemPainel({ imagemUrl, titulo, bullets, entrega, precoTexto, instrucao, cor }) {
  if (!createCanvas || !loadImage) {
    throw new Error('Canvas não está instalado neste servidor.');
  }
  const LARGURA = 880;
  const PAD = 32;
  const corAccent = '#' + (cor ?? 0x9b59b6).toString(16).padStart(6, '0');
  titulo = removerEmojis(titulo);
  entrega = entrega ? removerEmojis(entrega) : entrega;
  precoTexto = precoTexto ? removerEmojis(precoTexto) : precoTexto;
  instrucao = instrucao ? removerEmojis(instrucao) : instrucao;
  bullets = bullets.map((b) => removerEmojis(b));

  // Carregar o banner (se falhar a descarregar, segue sem banner).
  let banner = null;
  if (imagemUrl) {
    try {
      const res = await fetch(imagemUrl);
      const buf = Buffer.from(await res.arrayBuffer());
      banner = await loadImage(buf);
    } catch (err) {
      console.error('Falha ao carregar o banner do painel:', err.message);
    }
  }

  const larguraUtil = LARGURA - PAD * 2;
  const alturaBanner = banner ? Math.round(larguraUtil * (banner.height / banner.width)) : 0;

  // Medir o texto num canvas temporário para saber quantas linhas vai ter.
  const medidor = createCanvas(10, 10).getContext('2d');
  medidor.font = '400 19px sans-serif';
  const linhasBullets = [];
  for (const linha of bullets) {
    linhasBullets.push(...quebrarLinhas(medidor, linha, larguraUtil));
  }

  let alturaTexto = 46; // título
  alturaTexto += linhasBullets.length * 27 + 14;
  if (entrega) alturaTexto += 58;
  if (precoTexto) alturaTexto += 30;
  if (instrucao) alturaTexto += 24;

  const alturaTotal = PAD + (banner ? alturaBanner + 22 : 0) + alturaTexto + PAD;

  const canvas = createCanvas(LARGURA, alturaTotal);
  const ctx = canvas.getContext('2d');

  // Fundo do cartão (cantos arredondados).
  desenharRect(ctx, 0, 0, LARGURA, alturaTotal, 20);
  ctx.fillStyle = '#140c0e';
  ctx.fill();

  let y = PAD;

  // Banner (cantos arredondados, encostado ao topo).
  if (banner) {
    ctx.save();
    desenharRect(ctx, PAD, y, larguraUtil, alturaBanner, 14);
    ctx.clip();
    ctx.drawImage(banner, PAD, y, larguraUtil, alturaBanner);
    ctx.restore();
    y += alturaBanner + 22;
  }

  // Título.
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 30px sans-serif';
  ctx.fillText(titulo, PAD, y + 26);
  y += 46;

  // Bullets.
  ctx.font = '400 19px sans-serif';
  ctx.fillStyle = '#d8d0d2';
  for (const linha of linhasBullets) {
    ctx.fillText(linha, PAD, y + 16);
    y += 27;
  }
  y += 8;

  // Caixa de entrega (fundo ligeiramente diferente + borda discreta).
  if (entrega) {
    const alturaCaixa = 48;
    desenharRect(ctx, PAD, y, larguraUtil, alturaCaixa, 10);
    ctx.fillStyle = '#1e1518';
    ctx.fill();
    desenharRect(ctx, PAD, y, larguraUtil, alturaCaixa, 10);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#57f287';
    ctx.font = '600 18px sans-serif';
    ctx.fillText(entrega, PAD + 16, y + 30);
    y += alturaCaixa + 18;
  }

  // Preço (label "Preço:" destacado + valor).
  if (precoTexto) {
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 18px sans-serif';
    ctx.fillText('Preço:', PAD, y + 16);
    const larguraLabel = ctx.measureText('Preço: ').width;
    ctx.fillStyle = corAccent;
    ctx.font = '600 18px sans-serif';
    ctx.fillText(precoTexto, PAD + larguraLabel, y + 16);
    y += 30;
  }

  // Instrução final.
  if (instrucao) {
    ctx.font = '400 16px sans-serif';
    ctx.fillStyle = '#a89fa1';
    ctx.fillText(instrucao, PAD, y + 14);
  }

  return canvas.toBuffer('image/png');
}

// Nota sobre o banner "colado" ao texto: tentar juntar banner+texto em dois
// embeds da MESMA mensagem com o mesmo `url` não funciona bem — o Discord
// trata-os como uma galeria e chega a esconder o título/descrição do segundo
// embed (foi o que aconteceu). A forma que realmente funciona é mandar o
// banner e a caixa de texto como DUAS MENSAGENS seguidas do bot — o Discord
// agrupa mensagens consecutivas do mesmo autor sem repetir o avatar/nome,
// ficando visualmente colado. Ver enviarPainel() mais abaixo.

// Banner por defeito de TODOS os painéis da loja — troca por env var LOJA_BANNER_URL
// se quiseres outra imagem sem tocar no código.
// ⚠️ Atenção: links do Discord CDN com "?ex=" EXPIRAM (normalmente em 24h).
// Para um banner permanente, o melhor é subir a imagem para um serviço como
// imgur/Cloudinary/GitHub e usar esse link — ou passar sempre `anexo:` no
// comando /loja, que reenvia o ficheiro para o Discord de cada vez.
const LOJA_BANNER_URL_PADRAO =
  process.env.LOJA_BANNER_URL ||
  'https://media.discordapp.net/attachments/1545383446208315422/1545780646473891962/banner-loja.jpg?ex=6aa3fb69&is=6aa2a9e9&hm=f77d4ddcfd49941ea186279776ed50c55ae6aa81d83dc49780ab3ed45926712e&=&format=webp';

const BANNER_COMBOS_URL =
  'https://cdn.discordapp.com/attachments/1534183602764648579/1547949937151578182/content.png?ex=6aa54838&is=6aa3f6b8&hm=20bd72596ffcca5e54cb0ed3510e99a9d9a67baf05708616021fb405ed471ff4&';
const BANNER_SPOFER_URL =
  'https://cdn.discordapp.com/attachments/1534183602764648579/1547950195021586452/content.png?ex=6aa54876&is=6aa3f6f6&hm=2c899811f264a2347c1041590138c8cad71fa01575ee99a9a4bc979b61318275&';
const BANNER_LIFETIME_URL =
  'https://media.discordapp.net/attachments/1534183602764648579/1547950463414960308/content.png?ex=6aa548b6&is=6aa3f736&hm=7c34120d21fdc8bcdd7e8fa380c412c7c18f50326a8c4d26324bad293ca893a1&=&format=webp&quality=lossless&width=1804&height=603';
const BANNER_BOX_URL =
  'https://media.discordapp.net/attachments/1534183602764648579/1547951234336555098/content.png?ex=6aa5496d&is=6aa3f7ed&hm=8c04a4198746df91b5545122502d3f9926fa798d1ad7488175bd9c540e3e1e58&=&format=webp&quality=lossless&width=1804&height=603';
const BANNER_COMBOS_FILE = path.join(__dirname, 'assets', 'banner-combos.png');
const BANNER_SPOFER_FILE = path.join(__dirname, 'assets', 'banner-spofer.png');
const BANNER_LIFETIME_FILE = path.join(__dirname, 'assets', 'banner-lifetime.png');
const BANNER_BOX_FILE = path.join(__dirname, 'assets', 'banner-box.png');
const EMOJI_PACK = '<:1437199989053853806:1547957248498737263>';
const EMOJI_BOLINHA = '<:1377885173747548252:1547957223890624522>';
const EMOJI_TREVO = '<a:1263270455482122352:1453366951438061598>';
const STATUS_BOT = '⏳ processando pagamento...';
// <a:1192548293067165838:1453368332622495775>
const STATUS_BOT_EMOJI = {
  name: '1192548293067165838',
  id: '1453368332622495775',
  animated: true,
};
const STATUS_BOT_EMOJI_ID = STATUS_BOT_EMOJI.id;

// Tickets: categoria, cargos da staff e banner por defeito (env var sobrepõe).
const TICKETS_CATEGORIA_ID_PADRAO = '1322700826912882779';
const TICKETS_CARGOS_STAFF_PADRAO = ['1443307566921678968', '1318653141453111368'];
const TICKETS_BANNER_URL_PADRAO =
  'https://media.discordapp.net/attachments/1534183602764648579/1547711353840738425/image.png?ex=6aa46a05&is=6aa31885&hm=add46c54857977892ae15441df5b3e5ac8423cbc068029e98d4b4fdca43cabb4&=&format=webp&quality=lossless&width=1479&height=832';
const VERIFY_ROLE_ID_PADRAO = '1178495316132110336';
const LOGS_ENTREGA_CANAL_ID_PADRAO = '1545391162305810463';
const TICKETS_LOGS_CANAL_ID_PADRAO = '1318660945064755291';

function ticketsCategoriaId() {
  return process.env.TICKETS_CATEGORIA_ID || TICKETS_CATEGORIA_ID_PADRAO;
}

function ticketsCargosStaffIds() {
  const extra = (process.env.TICKETS_CARGO_STAFF_ID || '')
    .split(/[,\s]+/)
    .filter(Boolean);
  return [...new Set([...TICKETS_CARGOS_STAFF_PADRAO, ...extra])];
}

function ticketsStaffMencoes() {
  return ticketsCargosStaffIds()
    .map((id) => `<@&${id}>`)
    .join(' ');
}

function idsCargosDoMembro(membro) {
  if (!membro) return [];
  const cache = membro.roles?.cache;
  if (cache) {
    if (typeof cache.keys === 'function') return [...cache.keys()].map(String);
    if (typeof cache.has === 'function') {
      return ticketsCargosStaffIds().filter((id) => cache.has(id));
    }
  }
  if (Array.isArray(membro.roles)) return membro.roles.map(String);
  if (Array.isArray(membro._roles)) return membro._roles.map(String);
  return [];
}

function ehStaffTickets(membro) {
  if (!membro) return false;
  if (membro.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  const cargos = idsCargosDoMembro(membro);
  return ticketsCargosStaffIds().some((id) => cargos.includes(id));
}

function podeEntregarPedidos(interaction) {
  if (ehStaffTickets(interaction?.member)) return true;
  const perms = interaction?.memberPermissions ?? interaction?.member?.permissions;
  return Boolean(perms?.has?.(PermissionFlagsBits.Administrator));
}

function ticketsBannerUrl() {
  return process.env.TICKETS_BANNER_URL || TICKETS_BANNER_URL_PADRAO;
}

function logsCanalId() {
  return (
    process.env.LOGS_ENTREGA_CHANNEL_ID ||
    process.env.PEDIDOS_CHANNEL_ID ||
    LOGS_ENTREGA_CANAL_ID_PADRAO
  );
}

function ticketsLogsCanalId() {
  return process.env.TICKETS_LOGS_CHANNEL_ID || TICKETS_LOGS_CANAL_ID_PADRAO;
}

function cargoVerificacaoId() {
  return process.env.VERIFY_ROLE_ID || VERIFY_ROLE_ID_PADRAO;
}

// "trial" -> "Trial", "link spotify tri" -> "Link Spotify Tri"
function capitalizar(str) {
  return str
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function criarCliente() {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
  });
}

let client = criarCliente();
let jaArrancou = false;
let aLigar = false;
let ultimoOk = Date.now();
let falhasSeguidas = 0;

const CODIGOS_SEM_RECONNECT = new Set([4004, 4010, 4011, 4013, 4014]);

// Prefixo dos comandos de texto — alternativa aos slash commands, para o caso
// de os slash commands não aparecerem/funcionarem no teu Discord.
// Ex.: escreve "!loja-trial" ou "!loja spotify" num canal.
const PREFIXO = '!';

// ---------------------------------------------------------------------------
// Produtos iniciais da loja — criados automaticamente quando o bot liga,
// já organizados por categoria/canal (usa estes nomes em /loja categoria:"...")
// Preço em euros -> cêntimos (1,20€ = 120).
// ---------------------------------------------------------------------------

function eur(valor) {
  return Math.round(valor * 100);
}

const PRODUTOS_SEED = [
  // --- Painéis & Métodos (nome de categoria por confirmar) ---
  { nome: 'Painel SMS', preco: eur(1), categoria: 'Painéis & Métodos' },
  { nome: 'Painel do 7', preco: eur(1), categoria: 'Painéis & Métodos' },
  { nome: 'Método Ifood', preco: eur(1.2), categoria: 'Painéis & Métodos' },
  { nome: 'Método internet grátis', preco: eur(1.1), categoria: 'Painéis & Métodos' },
  { nome: 'Método banir insta', preco: eur(1.2), categoria: 'Painéis & Métodos' },
  { nome: 'Modelo loja', preco: eur(1), categoria: 'Painéis & Métodos' },

  // --- Canal de impulsos ---
  { nome: '2x impulsos', preco: eur(3), categoria: 'Impulsos' },
  { nome: '6x impulsos', preco: eur(6), categoria: 'Impulsos' },
  { nome: '8x impulsos', preco: eur(8), categoria: 'Impulsos' },
  { nome: '14x impulsos', preco: eur(10), categoria: 'Impulsos' },
  { nome: '14x impulsos trimensais', preco: eur(15), categoria: 'Impulsos' },

  // --- Canal de nitradas ---
  { nome: 'Nitrada Mensal', preco: eur(5), categoria: 'Nitradas' },
  { nome: 'Nitrada Trimensal', preco: eur(9), categoria: 'Nitradas' },
  { nome: 'Nitrada Anual', preco: eur(15), categoria: 'Nitradas' },

  // --- Canal de links ---
  { nome: 'Nitro Link Mensal', preco: eur(3), categoria: 'Links' },
  { nome: 'Nitro Link Trimensal', preco: eur(6), categoria: 'Links' },
  { nome: 'Ativação do Nitro', preco: eur(4), categoria: 'Links' },

  // --- Canal de trial ---
  { nome: 'Trial Nitro', preco: eur(2), categoria: 'trial' },

  // --- Canal virgem ---
  { nome: 'Conta Virgem', preco: eur(4), categoria: 'virgem' },

  // --- Canal aged ---
  { nome: 'Conta 2016', preco: eur(20), categoria: 'aged' },
  { nome: 'Conta 2017', preco: eur(15), categoria: 'aged' },
  { nome: 'Conta 2018', preco: eur(10), categoria: 'aged' },
  { nome: 'Conta 2019', preco: eur(7), categoria: 'aged' },
  { nome: 'Conta 2020', preco: eur(5), categoria: 'aged' },
  { nome: 'Conta 2021', preco: eur(2.5), categoria: 'aged' },
  { nome: 'Conta 2022', preco: eur(2), categoria: 'aged' },

  // --- Canal Spotify + Canal link Spotify Tri (mesma categoria "spotify") ---
  { nome: 'Conta Spotify Premium', preco: eur(4), categoria: 'spotify' },
  { nome: 'Link Spotify Trimensal', preco: eur(0.5), categoria: 'spotify' },

  // --- Canal membros ---
  { nome: '100x membros online', preco: eur(6), categoria: 'membros' },
  { nome: '100x membros offline', preco: eur(3), categoria: 'membros' },

  // --- Canal trampo ---
  { nome: 'Trampo fazendo dinheiro', preco: eur(5), categoria: 'trampo' },

  // --- Canal clonar site ---
  { nome: 'Clonar site', preco: eur(5), categoria: 'cloner' },

  // --- Canal Roblox ACC'S ---
  { nome: '1000-2500 robux acc', preco: eur(6), categoria: 'roblox' },
  { nome: '2500-5000 robux acc', preco: eur(8), categoria: 'roblox' },
  { nome: '5000-10000 robux acc', preco: eur(12), categoria: 'roblox' },
  { nome: '10000-15000 robux acc', preco: eur(16), categoria: 'roblox' },
  { nome: '15000-25000 robux acc', preco: eur(20), categoria: 'roblox' },
  { nome: '25000-50000 robux acc', preco: eur(25), categoria: 'roblox' },

  // --- Canal Fortnite ACC'S ---
  { nome: '100-150 Skins', preco: eur(10), categoria: 'fortnite' },
  { nome: '150-250 Skins', preco: eur(15), categoria: 'fortnite' },
  { nome: '100-250 Tryhard Skins', preco: eur(20), categoria: 'fortnite' },
  { nome: '250-400 Skins', preco: eur(25), categoria: 'fortnite' },

  // --- Canal Rockstar ACC'S ---
  { nome: '1 Rockstar Acc', preco: eur(4), categoria: 'rockstar' },
  { nome: '20 Rockstar Acc', preco: eur(15), categoria: 'rockstar' },

  // --- Canal Combos (sp00fer e Rock) ---
  {
    nome: 'Combo Semanal (sp00fer e Rock)',
    preco: eur(12),
    categoria: 'combos',
    descricao: '1x Sp00fer 1 Click Semanal + 5x conta Rockst4r Novas',
  },
  {
    nome: 'Combo Mensal (sp00fer e Rock)',
    preco: eur(20),
    categoria: 'combos',
    descricao: '1x Sp00fer 1 Click Mensal + 10x conta Rockst4r Novas',
  },
  {
    nome: 'Combo Lifetime (sp00fer e Rock)',
    preco: eur(50),
    categoria: 'combos',
    descricao: '1x Sp00fer 1 Click Lifetime + 50x conta Rockst4r Novas',
  },

  // --- Canal Sp00fer 1 Click ---
  { nome: 'Sp00fer Hora', preco: eur(2), categoria: 'spofer' },
  { nome: 'Sp00fer Diário', preco: eur(5), categoria: 'spofer' },
  {
    nome: 'Sp00fer Semanal',
    preco: eur(12),
    categoria: 'spofer',
    antigoNome: 'Sp00fer 1 Click Semanal',
  },
  {
    nome: 'Sp00fer Mensal',
    preco: eur(20),
    categoria: 'spofer',
    antigoNome: 'Sp00fer 1 Click Mensal',
  },
  {
    nome: 'Sp00fer Lifetime',
    preco: eur(50),
    categoria: 'spofer',
    antigoNome: 'Sp00fer 1 Click Lifetime',
  },

  // --- Canal Sp00fer Permanente ---
  { nome: 'Sp00fer Permanente Diário', preco: eur(5), categoria: 'lifetime' },
  { nome: 'Sp00fer Permanente Semanal', preco: eur(15), categoria: 'lifetime' },
  { nome: 'Sp00fer Permanente Mensal', preco: eur(22), categoria: 'lifetime' },
  { nome: 'Sp00fer Permanente Trimensal', preco: eur(32.99), categoria: 'lifetime' },
  { nome: 'Sp00fer Permanente Lifetime', preco: eur(50), categoria: 'lifetime' },

  // --- Canal Stopped Box ---
  {
    nome: 'Stopped Box Gold',
    preco: eur(5),
    categoria: 'box',
    antigoNome: 'Box Gold',
    descricao: 'Pode vir com diversos produtos, incluindo chaves diárias dos nossos softwares.',
  },
  {
    nome: 'Stopped Box Platina',
    preco: eur(10),
    categoria: 'box',
    antigoNome: 'Caixa Platina',
    descricao: 'Pode vir com diversos produtos, incluindo chaves de 3 a 7 dias dos nossos softwares.',
  },
  {
    nome: 'Stopped Box Diamante',
    preco: eur(15),
    categoria: 'box',
    antigoNome: 'Caixa Diamond',
    descricao: 'Pode vir com diversos produtos, incluindo chaves de 7 a 31 dias dos nossos softwares.',
  },
];

// Cria produtos em falta, atualiza preço/categoria e renomeia os antigos.
function seedProdutosIniciais() {
  let criados = 0;
  let atualizados = 0;
  for (const p of PRODUTOS_SEED) {
    const existente = db.getProductByName(p.nome) || (p.antigoNome ? db.getProductByName(p.antigoNome) : null);
    if (!existente) {
      const id = db.addProduct({
        name: p.nome,
        description: p.descricao || '',
        priceCents: p.preco,
        currency: 'eur',
        category: p.categoria,
        roleId: p.roleId || undefined,
      });
      console.log(`✅ produto criado #${id}: ${p.nome} — ${formatPrice(p.preco, 'eur')} [${p.categoria}]`);
      criados++;
      continue;
    }

    const mesmoNome = existente.name === p.nome;
    const mesmoPreco = existente.price_cents === p.preco;
    const mesmaMoeda = String(existente.currency || '').toLowerCase() === 'eur';
    const mesmaCategoria = existente.category === p.categoria;
    const mesmoAtivo = Boolean(existente.active);
    if (mesmoNome && mesmoPreco && mesmaMoeda && mesmaCategoria && mesmoAtivo) continue;

    db.updateProduct(existente.id, {
      name: p.nome,
      priceCents: p.preco,
      currency: 'eur',
      category: p.categoria,
      active: true,
    });
    console.log(
      `~ preço atualizado #${existente.id}: ${p.nome} — ${formatPrice(p.preco, 'eur')}`
    );
    atualizados++;
  }

  for (const p of PRODUTOS_SEED) {
    if (!p.antigoNome) continue;
    const velho = db.getProductByName(p.antigoNome);
    if (velho && velho.name !== p.nome) db.setProductActive(velho.id, false);
  }

  if (criados > 0) {
    console.log(`🌱 ${criados} produto(s) novo(s) criado(s).`);
  }
  if (atualizados > 0) {
    console.log(`🌱 ${atualizados} preço(s) atualizado(s).`);
  }
  if (criados === 0 && atualizados === 0) {
    console.log('🌱 Produtos e preços já estavam em dia.');
  }
}

// Categoria fixa de cada comando !loja-XXX — não precisas de escrever nada,
// só escolher o comando certo na lista do Discord.
const CATEGORIA_POR_COMANDO = {
  'loja-paineis': 'Painéis & Métodos',
  'loja-impulsos': 'Impulsos',
  'loja-nitradas': 'Nitradas',
  'loja-links': 'Links',
  'loja-trial': 'trial',
  'loja-virgem': 'virgem',
  'loja-aged': 'aged',
  'loja-spotify': 'spotify',
  'loja-membros': 'membros',
  'loja-trampo': 'trampo',
  'loja-cloner': 'cloner',
  'loja-roblox': 'roblox',
  'loja-fortnite': 'fortnite',
  'loja-rockstar': 'rockstar',
  'loja-combos': 'combos',
  'loja-spofer': 'spofer',
  'loja-lifetime': 'lifetime',
  'loja-box': 'box',
};

// Acrescenta as opções comuns de personalização do painel a um comando
// (imagem, título, bullets, texto de entrega, emoji/texto do botão, cor).
function addOpcoesPainel(builder) {
  return builder
    .addAttachmentOption((opt) =>
      opt.setName('anexo').setDescription('Imagem/banner do painel (opcional)').setRequired(false)
    )
    .addStringOption((opt) =>
      opt.setName('imagem').setDescription('URL do banner (opcional, alternativa ao anexo)').setRequired(false)
    )
    .addStringOption((opt) =>
      opt.setName('titulo').setDescription('Título do painel (opcional)').setRequired(false)
    )
    .addStringOption((opt) =>
      opt.setName('descricao').setDescription('Bullets do painel (opcional, usa \\n para nova linha)').setRequired(false)
    )
    .addStringOption((opt) =>
      opt.setName('entrega').setDescription('Texto da caixa de entrega (opcional, ex.: "⚡ Entrega Automática!")').setRequired(false)
    )
    .addStringOption((opt) =>
      opt.setName('botao_emoji').setDescription('Emoji do botão de compra (opcional, ex.: 🛒)').setRequired(false)
    )
    .addStringOption((opt) =>
      opt.setName('botao_texto').setDescription('Texto do botão de compra (opcional, ex.: Comprar)').setRequired(false)
    )
    .addStringOption((opt) =>
      opt.setName('cor').setDescription('Cor do embed em hex (opcional, ex.: #8B1E1E)').setRequired(false)
    );
}

// ---------------------------------------------------------------------------
// Slash commands — registados no Discord quando o bot liga
// ---------------------------------------------------------------------------

const slashCommands = [
  new SlashCommandBuilder()
    .setName('produto-criar')
    .setDescription('Cria um novo produto na loja')
    .addStringOption((opt) =>
      opt.setName('nome').setDescription('Nome do produto').setRequired(true)
    )
    .addNumberOption((opt) =>
      opt.setName('preco').setDescription('Preço do produto').setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('descricao').setDescription('Descrição do produto').setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('moeda')
        .setDescription('Moeda (eur, brl, usd, gbp, ...)')
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('categoria')
        .setDescription('Canal/categoria da loja (ex.: Impulsos, Nitradas, Links, Trial)')
        .setRequired(false)
    )
    .addRoleOption((opt) =>
      opt
        .setName('cargo')
        .setDescription('Cargo atribuído após a compra')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('chave-adicionar')
    .setDescription('Adiciona chaves em massa a um produto a partir de um ficheiro .txt')
    .addIntegerOption((opt) =>
      opt.setName('produto_id').setDescription('ID do produto').setRequired(true)
    )
    .addAttachmentOption((opt) =>
      opt
        .setName('ficheiro')
        .setDescription('Ficheiro .txt com uma chave por linha')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('produtos')
    .setDescription('Lista os produtos ativos e o stock atual')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  addOpcoesPainel(
    new SlashCommandBuilder()
      .setName('loja')
      .setDescription('Publica a loja neste canal')
      .addStringOption((opt) =>
        opt
          .setName('categoria')
          .setDescription('Publica só o painel deste canal (ex.: Impulsos). Sem isto, publica tudo.')
          .setRequired(false)
          .setAutocomplete(true)
      )
  ),

  // Comandos fixos por categoria — nada para escrever, só escolher o comando.
  ...Object.keys(CATEGORIA_POR_COMANDO).map((cmdName) =>
    addOpcoesPainel(
      new SlashCommandBuilder()
        .setName(cmdName)
        .setDescription(`Publica o painel de "${CATEGORIA_POR_COMANDO[cmdName]}" neste canal`)
    ).setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  ),

  new SlashCommandBuilder()
    .setName('entregar')
    .setDescription('Confirma o pagamento e entrega a chave de um pedido (admin)')
    .addIntegerOption((opt) =>
      opt.setName('pedido_id').setDescription('ID do pedido a entregar').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('tickets')
    .setDescription('Publica o painel de tickets neste canal')
    .addAttachmentOption((opt) =>
      opt.setName('anexo').setDescription('Imagem/banner do painel (opcional)').setRequired(false)
    )
    .addStringOption((opt) =>
      opt.setName('imagem').setDescription('URL do banner (opcional, alternativa ao anexo)').setRequired(false)
    )
    .addStringOption((opt) =>
      opt.setName('titulo').setDescription('Título do painel (opcional)').setRequired(false)
    )
    .addStringOption((opt) =>
      opt.setName('descricao').setDescription('Texto do painel (opcional)').setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('verificacao')
    .setDescription('Publica um painel de verificação neste canal')
    .addRoleOption((opt) =>
      opt
        .setName('cargo')
        .setDescription('Cargo dado a quem se verificar (senão usa a variável VERIFY_ROLE_ID)')
        .setRequired(false)
    )
    .addAttachmentOption((opt) =>
      opt.setName('anexo').setDescription('Imagem/banner do painel (opcional)').setRequired(false)
    )
    .addStringOption((opt) =>
      opt.setName('imagem').setDescription('URL do banner (opcional, alternativa ao anexo)').setRequired(false)
    )
    .addStringOption((opt) =>
      opt.setName('titulo').setDescription('Título do painel (opcional)').setRequired(false)
    )
    .addStringOption((opt) =>
      opt.setName('descricao').setDescription('Texto do painel (opcional)').setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('comandos')
    .setDescription('Lista todos os comandos do bot'),

  new SlashCommandBuilder()
    .setName('fechar')
    .setDescription('Fecha o ticket deste canal'),
].map((cmd) => cmd.toJSON());

async function registerSlashCommands() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.CLIENT_ID || process.env.DISCORD_CLIENT_ID;

  if (!token) {
    console.error('❌ Falta DISCORD_TOKEN no .env.');
    return;
  }
  if (!clientId) {
    console.error(
      '❌ Falta CLIENT_ID no .env — vai ao Developer Portal > General Information.'
    );
    return;
  }

  const rest = new REST({ version: '10' }).setToken(token);

  // O bot passou a usar só comandos com ! — limpa os slash (/) antigos.
  await rest.put(Routes.applicationCommands(clientId), { body: [] });
  if (process.env.GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(clientId, process.env.GUILD_ID), {
      body: [],
    });
  }
  console.log('✅ Slash commands removidos. Usa !comandos');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function logToChannel(text, extras = {}) {
  const channelId = logsCanalId();
  if (!channelId) return;
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel?.isTextBased()) await channel.send({ content: text, ...extras });
  } catch (err) {
    console.error('Falha ao escrever no canal de logs:', err.message);
  }
}

function parseSqliteDate(valor) {
  if (!valor) return new Date();
  if (valor instanceof Date) return valor;
  const raw = String(valor);
  const iso = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function formatarDataPt(date) {
  const d = date instanceof Date ? date : parseSqliteDate(date);
  const texto = new Intl.DateTimeFormat('pt-PT', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/Lisbon',
  }).format(d);
  return texto.replace(/,?\s+(\d{1,2}:\d{2})$/, ' às $1');
}

function mencaoOuDesconhecido(userId) {
  return userId ? `<@${userId}>` : 'Desconhecido';
}

function montarEmbedTicketFechado({
  ticketNum,
  openerId,
  closerId,
  claimedBy,
  openedAt,
  reason,
}) {
  return new EmbedBuilder()
    .setTitle('Ticket Closed')
    .setColor(0x2ecc71)
    .addFields(
      { name: '🎫 Ticket ID', value: String(ticketNum ?? '—'), inline: true },
      { name: '✅ Opened By', value: mencaoOuDesconhecido(openerId), inline: true },
      { name: '❌ Closed By', value: mencaoOuDesconhecido(closerId), inline: true },
      { name: '🕐 Open Time', value: formatarDataPt(openedAt), inline: true },
      { name: '💜 Claimed By', value: mencaoOuDesconhecido(claimedBy || closerId), inline: true },
      { name: 'ℹ️ Reason', value: reason || 'No reason specified', inline: false }
    )
    .setTimestamp();
}

// Devolve "De X a Y" (ou só X se for um único preço), no estilo da print.
function faixaPrecos(products) {
  if (products.length === 0) return null;
  const precos = products.map((p) => p.price_cents);
  const min = Math.min(...precos);
  const max = Math.max(...precos);
  const moeda = products[0].currency;
  return min === max
    ? formatPrice(min, moeda)
    : `De ${formatPrice(min, moeda)} a ${formatPrice(max, moeda)}`;
}

function stockDoProduto(product) {
  if (!product) return 0;
  if (product.stock_qty != null) return Math.max(0, Number(product.stock_qty) || 0);
  return db.getStock(product.id);
}

function textoStock(n) {
  return n <= 0 ? 'Esgotado' : String(n);
}

const SINONIMOS_STOCK = {
  impulso: 'impulsos',
  impulsos: 'impulsos',
  trimensal: 'trimestral',
  trimensais: 'trimestral',
  trimestral: 'trimestral',
  nitrada: 'nitrada',
  nitradas: 'nitrada',
  nitro: 'nitro',
  link: 'link',
  links: 'link',
  ativacao: 'ativacao',
  activacao: 'ativacao',
  ativar: 'ativacao',
  virgem: 'virgem',
  trial: 'trial',
  spotify: 'spotify',
  conta: 'conta',
  contas: 'conta',
  membro: 'membros',
  membros: 'membros',
  online: 'online',
  offline: 'offline',
  trampo: 'trampo',
  mensal: 'mensal',
  anual: 'anual',
};

function normalizarTextoProduto(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9x]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokensProduto(texto) {
  return normalizarTextoProduto(texto)
    .split(' ')
    .filter(Boolean)
    .map((t) => SINONIMOS_STOCK[t] || t);
}

function tokenCoincide(a, b) {
  if (a === b) return true;
  const numA = a.match(/^(\d+)x?$/);
  const numB = b.match(/^(\d+)x?$/);
  if (numA && numB) return numA[1] === numB[1];
  if (/^\d/.test(a) || /^\d/.test(b)) return a === b;
  return a.startsWith(b) || b.startsWith(a);
}

function pontuarProduto(produto, query) {
  const qNorm = normalizarTextoProduto(query);
  const nNorm = normalizarTextoProduto(produto.name);
  if (!qNorm) return 0;
  if (nNorm === qNorm) return 1000;

  const qTokens = tokensProduto(query);
  const nTokens = tokensProduto(produto.name);
  if (qTokens.length === 0) return 0;
  if (qTokens.length === 1 && nTokens.includes(qTokens[0]) && qTokens[0] === nTokens[nTokens.length - 1]) {
    return 350 - (nTokens.length - 1) * 20;
  }

  let hits = 0;
  for (const qt of qTokens) {
    const ok = nTokens.some((nt) => tokenCoincide(nt, qt));
    if (ok) hits += 1;
    else return 0;
  }

  const extra = nTokens.filter((nt) => !qTokens.some((qt) => tokenCoincide(nt, qt))).length;
  return hits * 60 - extra * 25;
}

function encontrarProdutoPorTexto(query) {
  const texto = String(query || '').trim();
  if (!texto) return { produto: null, ambiguos: [] };
  if (/^\d+$/.test(texto)) {
    const porId = db.getProduct(Number(texto));
    if (porId) return { produto: porId, ambiguos: [] };
  }

  const direto = db.getProductByName(texto);
  if (direto) return { produto: direto, ambiguos: [] };

  const alias = {
    spotify: 'Conta Spotify Premium',
    contas: 'Conta Spotify Premium',
    'conta spotify': 'Conta Spotify Premium',
  }[normalizarTextoProduto(texto)];
  if (alias) {
    const alvo = db.getProductByName(alias);
    if (alvo) return { produto: alvo, ambiguos: [] };
  }

  const candidatos = db
    .listActiveProducts()
    .map((p) => ({ p, score: pontuarProduto(p, texto) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (candidatos.length === 0) return { produto: null, ambiguos: [] };
  if (candidatos.length === 1 || candidatos[0].score >= (candidatos[1]?.score || 0) + 20) {
    return { produto: candidatos[0].p, ambiguos: [] };
  }
  return {
    produto: null,
    ambiguos: candidatos.slice(0, 5).map((x) => x.p),
  };
}

// Constrói o menu de seleção com os produtos da categoria — mostra o preço e o
// stock em cada opção (mesmo quando esgotado), tal como no exemplo que mandaste.
function buildSelectRow(products) {
  const options = products.slice(0, 25).map((p) => {
    const stock = stockDoProduto(p);
    return {
      label: p.name,
      description: `Valor: ${formatPrice(p.price_cents, p.currency)} · 📦 Estoque: ${textoStock(stock)}`,
      value: String(p.id),
      emoji: '⭐',
    };
  });

  if (options.length === 0) return null;

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('comprar_select')
      .setPlaceholder('Selecione uma opção para continuar...')
      .addOptions(options)
  );
}

// Converte "#e02424" ou "e02424" no número que o EmbedBuilder.setColor espera.
function corParaHex(cor) {
  if (!cor) return null;
  const n = parseInt(String(cor).replace('#', ''), 16);
  return Number.isNaN(n) ? null : n;
}

// Textos/estilo específicos por categoria — cada painel tem a sua mensagem.
function textoPainel(titulo, bullets, extras = {}) {
  return {
    titulo,
    descricao: bullets.map((b) => (b.startsWith('•') ? b : `• ${b}`)).join('\n'),
    entrega: extras.entrega || '⚡ Entrega Automática!',
    cor: extras.cor ?? 0x2b2d31,
  };
}

const PAINEL_TEXTOS = {
  'Painéis & Métodos': textoPainel('Painéis & Métodos', [
    'Recebe o painel ou método pronto a usar.',
    'SMS, Ifood, internet e outros métodos.',
    'Melhor qualidade.',
    'Entrega automática no privado.',
  ]),
  Impulsos: textoPainel('Impulsos', [
    'Impulso para o teu servidor Discord.',
    'Ativação rápida.',
    'Melhor qualidade.',
    'Sem partilhar a tua conta.',
  ]),
  Nitradas: textoPainel('Nitradas', [
    'Recebe uma conta Full Acesso.',
    'Contas com Nitro Gaming.',
    'Melhor qualidade.',
    'Muda e-mail, senha, etc.',
  ]),
  Links: textoPainel('Nitro Links', [
    'Nitro Link Mensal e Trimensal.',
    'Ativação do Nitro incluída.',
    'Melhor qualidade.',
    'Só clicar em resgatar.',
  ]),
  trial: textoPainel('Trial Nitro', [
    'Trial Nitro para testar a conta.',
    'Ativação simples, só resgatar.',
    'Melhor qualidade.',
    'Entrega automática no privado.',
  ]),
  virgem: textoPainel('Conta Virgem', [
    'Recebe uma conta Full Acesso.',
    'Contas virgens, nunca usadas.',
    'Sem histórico de Nitro ou tickets.',
    'Melhor qualidade.',
  ]),
  aged: textoPainel('Contas Aged', [
    'Recebe uma conta Full Acesso.',
    'Contas antigas (2016 a 2022).',
    'Melhor qualidade.',
    'Mais confiança e histórico.',
  ]),
  spotify: textoPainel('Spotify Premium', [
    'Recebe uma conta Full Acesso.',
    'Obrigatório a Troca de Dados.',
    'Melhor qualidade.',
    'Garantia de duração.',
    'Troca apenas com prova.',
    'site: clique aqui',
  ]),
  membros: textoPainel('Membros', [
    'Membros para o teu servidor.',
    'Packs de 100 online ou 100 offline.',
    'Melhor qualidade.',
    'Entrega automática.',
  ]),
  trampo: textoPainel('Trampo', [
    'Recebe o trampo pronto a usar.',
    'Melhor qualidade.',
    'Pronto pra começar.',
    'Suporte após a compra.',
  ]),
  cloner: textoPainel(
    'Clonar Site',
    [
      'Clonagem de site sob pedido.',
      'Layout igual ao original.',
      'Melhor qualidade.',
      'Entrega combinada no ticket.',
    ],
    { entrega: '🎫 Entrega via ticket' }
  ),
  roblox: textoPainel('ROBLOX ACC\'S', [
    'Recebe uma conta Full Acesso.',
    'Valor = Robux do inventário.',
    'ALL FULL ACCESS.',
    'Melhor qualidade.',
  ]),
  fortnite: textoPainel('FORTNITE ACC\'S', [
    'Recebe uma conta Full Acesso.',
    'OG, rare e tryhard skins.',
    'ALL FULL ACCESS.',
    'Melhor qualidade.',
  ]),
  rockstar: textoPainel('ROCKSTAR ACC\'S', [
    'Recebe uma conta Full Acesso.',
    'ALL FULL ACCESS.',
    'Melhor qualidade.',
    'Entrega automática no privado.',
  ]),
  combos: {
    titulo: 'Stopped Combos',
    descricao:
      `${EMOJI_PACK} Semanal ( sp00fer e Rock )\n` +
      `${EMOJI_BOLINHA} 1x Sp00fer 1 Click Semanal\n` +
      `${EMOJI_BOLINHA} 5x conta Rockst4r Novas.\n` +
      '\n' +
      `${EMOJI_PACK} Mensal ( sp00fer e Rock )\n` +
      `${EMOJI_BOLINHA} 1x Sp00fer 1 Click Mensal\n` +
      `${EMOJI_BOLINHA} 10x conta Rockst4r Novas.\n` +
      '\n' +
      `${EMOJI_PACK} Lifetime ( sp00fer e Rock )\n` +
      `${EMOJI_BOLINHA} 1x Sp00fer 1 Click Lifetime\n` +
      `${EMOJI_BOLINHA} 50x conta Rockst4r Novas.`,
    entrega: '⚡ Entrega Automática!',
    cor: 0x2b2d31,
    imagem: BANNER_COMBOS_URL,
    imagemFile: BANNER_COMBOS_FILE,
  },
  spofer: {
    titulo: 'SPOOFER ONE CLICK',
    descricao:
      `${EMOJI_PACK} Hora\n` +
      `${EMOJI_BOLINHA} 1x Sp00fer Hora\n` +
      '\n' +
      `${EMOJI_PACK} Diário\n` +
      `${EMOJI_BOLINHA} 1x Sp00fer Diário\n` +
      '\n' +
      `${EMOJI_PACK} Semanal\n` +
      `${EMOJI_BOLINHA} 1x Sp00fer Semanal\n` +
      '\n' +
      `${EMOJI_PACK} Mensal\n` +
      `${EMOJI_BOLINHA} 1x Sp00fer Mensal\n` +
      '\n' +
      `${EMOJI_PACK} Lifetime\n` +
      `${EMOJI_BOLINHA} 1x Sp00fer Lifetime`,
    entrega: '⚡ Entrega Automática!',
    cor: 0x2b2d31,
    imagem: BANNER_SPOFER_URL,
    imagemFile: BANNER_SPOFER_FILE,
  },
  lifetime: {
    titulo: 'SPOOFER PERMANENTE',
    descricao:
      `${EMOJI_PACK} Diário\n` +
      `${EMOJI_BOLINHA} 1x Sp00fer Permanente Diário\n` +
      '\n' +
      `${EMOJI_PACK} Semanal\n` +
      `${EMOJI_BOLINHA} 1x Sp00fer Permanente Semanal\n` +
      '\n' +
      `${EMOJI_PACK} Mensal\n` +
      `${EMOJI_BOLINHA} 1x Sp00fer Permanente Mensal\n` +
      '\n' +
      `${EMOJI_PACK} Trimensal\n` +
      `${EMOJI_BOLINHA} 1x Sp00fer Permanente Trimensal\n` +
      '\n' +
      `${EMOJI_PACK} Lifetime\n` +
      `${EMOJI_BOLINHA} 1x Sp00fer Permanente Lifetime`,
    entrega: '⚡ Entrega Automática!',
    cor: 0x2b2d31,
    imagem: BANNER_LIFETIME_URL,
    imagemFile: BANNER_LIFETIME_FILE,
  },
  box: {
    titulo: 'Stopped Box',
    descricao:
      '• Ganhe produtos da nossa loja!\n' +
      '• Teste sua sorte agora e receba recompensas exclusivas!\n' +
      '• Você tem até 10 minutos para resgatar seu prêmio\n' +
      '• Leia os Termos antes de comprar.\n' +
      '\n' +
      `${EMOJI_PACK} Tipos de Box:\n` +
      '\n' +
      `${EMOJI_PACK} Stopped Box Gold\n` +
      `${EMOJI_BOLINHA} Pode vir com diversos produtos, incluindo chaves diárias dos nossos softwares.\n` +
      '\n' +
      `${EMOJI_PACK} Stopped Box Platina\n` +
      `${EMOJI_BOLINHA} Pode vir com diversos produtos, incluindo chaves de 3 a 7 dias dos nossos softwares.\n` +
      '\n' +
      `${EMOJI_PACK} Stopped Box Diamante\n` +
      `${EMOJI_BOLINHA} Pode vir com diversos produtos, incluindo chaves de 7 a 31 dias dos nossos softwares.\n` +
      '\n' +
      `${EMOJI_TREVO} Box mais caras oferecem maiores chances de obter produtos melhores, com mais quantidade e maior tempo!`,
    entrega: '⚡ Entrega Automática!',
    cor: 0x2b2d31,
    imagem: BANNER_BOX_URL,
    imagemFile: BANNER_BOX_FILE,
  },
};

function textosDaCategoria(categoryName) {
  if (!categoryName) return {};
  if (PAINEL_TEXTOS[categoryName]) return PAINEL_TEXTOS[categoryName];
  const key = Object.keys(PAINEL_TEXTOS).find(
    (k) => k.toLowerCase() === String(categoryName).toLowerCase()
  );
  return key ? PAINEL_TEXTOS[key] : {};
}

// Junta as opções passadas no comando com os defaults da categoria e os
// defaults genéricos — usado tanto pelo painel da loja como (parcialmente)
// pelo dos tickets.
function resolverTextosLoja(products, categoryName, opts = {}) {
  const { imagem, titulo, descricao, entrega, botaoEmoji, botaoTexto, cor } = opts;
  const defaults = textosDaCategoria(categoryName);

  const tituloFinal = titulo || defaults.titulo || (categoryName ? capitalizar(categoryName) : 'Loja');
  const faixa = faixaPrecos(products);
  const imagemFile = imagem ? null : defaults.imagemFile || null;
  const imagemFinal = imagem || defaults.imagem || LOJA_BANNER_URL_PADRAO;
  const corFinal = corParaHex(cor) ?? defaults.cor ?? 0x2b2d31;
  const bulletsTexto =
    descricao ||
    defaults.descricao ||
    '• Produtos de qualidade, com stock verificado antes da compra.\n' +
      '• Preços justos, sempre pensados para o teu bolso.\n' +
      '• Compra rápida, simples e segura — só um clique.';
  const entregaFinal = entrega || defaults.entrega || '⚡ Entrega Automática!';
  const botaoEmojiFinal = botaoEmoji || defaults.botaoEmoji || '🛒';
  const botaoTextoFinal = botaoTexto || defaults.botaoTexto || 'Comprar';

  return {
    tituloFinal,
    bulletsLinhas: bulletsTexto.replace(/\n+$/, '').split('\n'),
    entregaFinal,
    imagemFinal,
    imagemFile,
    corFinal,
    faixa,
    botaoEmojiFinal,
    botaoTextoFinal,
  };
}

// Cartão V2 igual à print: banner no topo, texto, caixa verde, rodapé + botão
// à direita (ou menu em baixo, no caso dos tickets).
function montarPainelV2({ imagemUrl, imagemPath, accentColor, texto, rodape, accessory, extraRows = [] }) {
  const container = new ContainerBuilder().setAccentColor(accentColor ?? 0x2b2d31);
  const files = [];

  if (imagemPath && fs.existsSync(imagemPath)) {
    const nome = path.basename(imagemPath);
    files.push({ attachment: imagemPath, name: nome });
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${nome}`))
    );
  } else if (imagemUrl && /^https?:\/\//i.test(imagemUrl)) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(imagemUrl))
    );
  }

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(texto));

  if (rodape && accessory) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(rodape))
        .setButtonAccessory(accessory)
    );
  } else if (rodape) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(rodape));
  }

  for (const row of extraRows) {
    container.addActionRowComponents(row);
  }

  return {
    payload: {
      flags: MessageFlags.IsComponentsV2,
      components: [container],
      ...(files.length ? { files } : {}),
    },
  };
}

function gerarPainelLoja(products, categoryName, opts = {}) {
  const t = resolverTextosLoja(products, categoryName, opts);
  const texto =
    `## ${t.tituloFinal}\n` +
    t.bulletsLinhas.join('\n') +
    `\n\n\`\`\`ansi\n\u001b[2;32m${t.entregaFinal}\u001b[0m\n\`\`\``;

  const rodape = t.faixa
    ? `Preço: **${t.faixa}**\nClique no botão **"${t.botaoTextoFinal}"**`
    : 'Não há produtos disponíveis de momento.';

  const botao = new ButtonBuilder()
    .setLabel(t.botaoTextoFinal)
    .setEmoji(t.botaoEmojiFinal)
    .setStyle(ButtonStyle.Secondary)
    .setCustomId(`abrir_${encodeURIComponent(categoryName || '')}`)
    .setDisabled(products.length === 0);

  return montarPainelV2({
    imagemUrl: t.imagemFinal,
    imagemPath: t.imagemFile,
    accentColor: t.corFinal,
    texto,
    rodape,
    accessory: botao,
  });
}

// Manda o painel da loja (Components V2) ou o dos tickets (imagem + botões).
async function enviarPainel(channel, painel) {
  if (painel.payload) return channel.send(painel.payload);
  return channel.send({
    files: [{ attachment: painel.buffer, name: 'painel.png' }],
    components: painel.rows,
  });
}

// Publica o painel de uma categoria (chamado por !loja <categoria>
// e pelos comandos fixos !loja-trial, !loja-spotify, etc.)
async function publicarLoja(interaction, categoria) {
  const products = categoria ? db.listActiveProductsByCategory(categoria) : db.listActiveProducts();

  if (categoria && products.length === 0) {
    return interaction.reply({
      content: `Não há produtos no canal **${categoria}**. Categorias disponíveis: ${
        db.listCategories().join(', ') || '(nenhuma)'
      }.`,
      ephemeral: true,
    });
  }

  const anexo = interaction.options.getAttachment('anexo');
  const imagem = anexo?.url || interaction.options.getString('imagem') || null;
  const titulo = interaction.options.getString('titulo') || null;
  const descricaoOpt = interaction.options.getString('descricao') || null;
  const entrega = interaction.options.getString('entrega') || null;
  const botaoEmoji = interaction.options.getString('botao_emoji') || null;
  const botaoTexto = interaction.options.getString('botao_texto') || null;
  const cor = interaction.options.getString('cor') || null;

  const painel = gerarPainelLoja(products, categoria, {
    imagem,
    titulo,
    descricao: descricaoOpt,
    entrega,
    botaoEmoji,
    botaoTexto,
    cor,
  });
  await enviarPainel(interaction.channel, painel);
  await interaction.reply({
    content: categoria ? `Painel do canal **${categoria}** publicado!` : 'Loja publicada!',
    ephemeral: true,
  });
}

// Versão do publicarLoja para comandos de texto (!loja-trial, !loja spotify).
// Sem opções de anexo/título/descrição — usa sempre o banner e os bullets
// por defeito. Apaga a própria mensagem do comando para o canal ficar limpo.
async function publicarLojaTexto(message, categoria) {
  const products = categoria ? db.listActiveProductsByCategory(categoria) : db.listActiveProducts();

  if (categoria && products.length === 0) {
    return message.reply(
      `Não há produtos no canal **${categoria}**. Categorias disponíveis: ${
        db.listCategories().join(', ') || '(nenhuma)'
      }.`
    );
  }

  const painel = gerarPainelLoja(products, categoria, {});
  await enviarPainel(message.channel, painel);
  try {
    await message.delete();
  } catch {
    /* o bot pode não ter permissão para apagar — não é grave */
  }
}

// ---------------------------------------------------------------------------
// Sistema de tickets ("!tickets") — painel com banner + regras + menu para
// escolher o tipo de atendimento; cada escolha cria um canal privado
// (ticket) com botões para Adicionar Membro / Criar Call / Pedir Gank /
// Renomear Ticket.
//
// Configuração (env var sobrepõe o valor por defeito):
//   TICKETS_CATEGORIA_ID  -> categoria onde os canais de ticket são criados
//   TICKETS_CARGO_STAFF_ID -> cargo da staff (vê os tickets, é chamado no "Pedir Gank")
//   TICKETS_BANNER_URL    -> imagem do painel e do canal de ticket
// ---------------------------------------------------------------------------

const TIPOS_TICKET = {
  suporte: { label: 'Suporte', emoji: '📞', descricao: 'Abra um ticket de suporte' },
  'receber-produto': {
    label: 'Receber Produto',
    emoji: '🛒',
    descricao: 'Abra um ticket para receber o seu produto',
  },
  duvidas: { label: 'Duvidas', emoji: '👥', descricao: 'Abra um ticket para tirar a sua Duvida' },
};

function gerarSufixoTicket() {
  return Math.random().toString(36).slice(2, 7); // ex.: "cn3xl"
}

function gerarPainelTickets(opts = {}) {
  const { imagem, titulo, descricao, cor } = opts;
  const tituloFinal = titulo || 'Central de Atendimento';
  const bulletsTexto =
    descricao ||
    '• Após solicitar atendimento, aguarde até que um integrante da equipe responda.\n' +
      '• O atendimento é privado: só tu e a staff autorizada vêem o que for partilhado.\n' +
      '• A equipe não está disponível 24 horas, mas dentro do horário vamos atender-te.';

  const texto =
    `## ${tituloFinal}\n` +
    bulletsTexto.split('\n').filter(Boolean).join('\n') +
    '\n\n```ansi\n\u001b[2;32m🎫 Abra um ticket agora\u001b[0m\n```';

  const select = new StringSelectMenuBuilder()
    .setCustomId('ticket_tipo_select')
    .setPlaceholder('Selecione o tipo de atendimento')
    .addOptions(
      Object.entries(TIPOS_TICKET).map(([value, info]) => ({
        label: info.label,
        description: info.descricao,
        emoji: info.emoji,
        value,
      }))
    );

  return montarPainelV2({
    imagemUrl: imagem || ticketsBannerUrl(),
    accentColor: corParaHex(cor) ?? 0x2b2d31,
    texto,
    rodape: 'Escolha o tipo de atendimento\nClique no menu abaixo',
    extraRows: [new ActionRowBuilder().addComponents(select)],
  });
}

// Botões de gestão que aparecem dentro de cada canal de ticket.
function buildBotoesTicket(channelId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Adicionar Membro')
      .setEmoji('👤')
      .setStyle(ButtonStyle.Secondary)
      .setCustomId(`ticket_addmember_${channelId}`),
    new ButtonBuilder()
      .setLabel('Criar Call')
      .setEmoji('🔔')
      .setStyle(ButtonStyle.Secondary)
      .setCustomId(`ticket_call_${channelId}`),
    new ButtonBuilder()
      .setLabel('Pedir Gank')
      .setEmoji('❗')
      .setStyle(ButtonStyle.Danger)
      .setCustomId(`ticket_gank_${channelId}`),
    new ButtonBuilder()
      .setLabel('Renomear Ticket')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Secondary)
      .setCustomId(`ticket_rename_${channelId}`),
    new ButtonBuilder()
      .setLabel('Fechar Ticket')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger)
      .setCustomId(`ticket_fechar_${channelId}`)
  );
}

function textoComandos() {
  const paineis = Object.keys(CATEGORIA_POR_COMANDO)
    .map((cmd) => `\`!${cmd}\``)
    .join('\n');

  return (
    '## Comandos do bot\n' +
    '**Loja**\n' +
    '`!loja` — publica todos os painéis (ou `!loja <categoria>`)\n' +
    `${paineis}\n\n` +
    '**Tickets**\n' +
    '`!tickets` — publica o painel de tickets\n' +
    '`!fechar` / `!close` — fecha o ticket deste canal\n' +
    'Dentro do ticket: Adicionar Membro · Criar Call · Pedir Gank · Renomear · Fechar\n\n' +
    '**Geral**\n' +
    '`!comandos` — esta lista\n' +
    '`!verificacao` — painel de verificação (escolhe o código certo)\n\n' +
    '**Admin**\n' +
    '`!produtos` — lista produtos e stock\n' +
    '`!stock adicionar 2x impulso 4` — acrescenta stock pelo nome\n' +
    '`!stock` — lista o stock\n' +
    '`!produto-criar <preco> <categoria> <nome>`\n' +
    '`!chave-adicionar <id>` + ficheiro .txt (opcional)\n' +
    '`!entregar <pedido_id>`'
  );
}

function ehCanalTicket(canal) {
  if (!canal) return false;
  return canal.parentId === ticketsCategoriaId() || /^(suporte|receber-produto|duvidas)-/i.test(canal.name);
}

function podeGerirTicket(membro, canal) {
  if (!membro) return false;
  if (ehStaffTickets(membro)) return true;
  const overwrite = canal?.permissionOverwrites?.cache?.get(membro.id);
  if (overwrite?.allow?.has(PermissionFlagsBits.ViewChannel)) return true;
  return false;
}

async function fecharTicket(canal, closer, motivo) {
  const closerId = closer?.id || null;
  const autorTag = closerId ? `<@${closerId}>` : String(closer || 'staff');
  try {
    await enviarLogTicketFechado(canal, closer, motivo);
  } catch (err) {
    console.error('Falha ao enviar log de ticket fechado:', err.message);
  }
  const aviso =
    `🔒 Ticket fechado por ${autorTag}. Este canal será apagado em 5 segundos.\n\n` +
    textoComandos();
  try {
    await canal.send({ content: aviso });
  } catch {
    /* canal já pode estar sem permissões */
  }
  setTimeout(() => {
    canal.delete('Ticket fechado').catch((err) => {
      console.error('Falha ao apagar ticket:', err.message);
    });
  }, 5000);
}

function openerDoCanalTicket(canal) {
  const gravado = db.getTicket(canal.id);
  if (gravado?.opener_id) return gravado.opener_id;
  const overwrite = canal.permissionOverwrites?.cache?.find((o) => {
    return (
      Number(o.type) === 1 &&
      o.id !== canal.client?.user?.id &&
      o.allow?.has?.(PermissionFlagsBits.ViewChannel)
    );
  });
  return overwrite?.id || null;
}

async function enviarLogTicketFechado(canal, closer, motivo) {
  if (!canal?.guild) return;
  const dest = await canal.guild.channels.fetch(ticketsLogsCanalId()).catch(() => null);
  if (!dest?.isTextBased()) {
    console.error(`Canal de logs de tickets não encontrado: ${ticketsLogsCanalId()}`);
    return;
  }

  let ticket = db.getTicket(canal.id);
  if (!ticket) {
    ticket = db.saveTicket({
      channelId: canal.id,
      openerId: openerDoCanalTicket(canal) || closer?.id || '0',
      tipo: canal.name?.startsWith('receber-produto') ? 'receber-produto' : 'suporte',
    });
  }
  if (!ticket?.claimed_by && closer?.id) {
    ticket = db.claimTicket(canal.id, closer.id) || ticket;
  }

  const embed = montarEmbedTicketFechado({
    ticketNum: ticket?.ticket_num,
    openerId: ticket?.opener_id || openerDoCanalTicket(canal),
    closerId: closer?.id,
    claimedBy: ticket?.claimed_by || closer?.id,
    openedAt: canal.createdAt || parseSqliteDate(ticket?.created_at),
    reason: (motivo && String(motivo).trim()) || 'No reason specified',
  });
  await dest.send({ embeds: [embed] });
  db.closeTicketRecord(canal.id, motivo);
}

function gravarTicketAberto(canal, openerId, tipo) {
  if (!canal?.id || !openerId) return null;
  try {
    return db.saveTicket({ channelId: canal.id, openerId, tipo });
  } catch (err) {
    console.error('Falha ao gravar ticket:', err.message);
    return null;
  }
}

function marcarTicketClaimed(canal, userId) {
  if (!canal?.id || !userId) return;
  try {
    db.claimTicket(canal.id, userId);
  } catch (err) {
    console.error('Falha ao marcar ticket claimed:', err.message);
  }
}

async function criarCanalTicket(guild, userId, tipoKey, nomeExtra) {
  const tipo = TIPOS_TICKET[tipoKey];
  if (!tipo || !guild) return null;

  const categoriaId = ticketsCategoriaId();
  const staffRoleIds = ticketsCargosStaffIds();
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: userId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
    {
      id: client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageRoles,
      ],
    },
  ];
  for (const staffRoleId of staffRoleIds) {
    overwrites.push({
      id: staffRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }

  const base = nomeExtra || `${tipoKey}-${gerarSufixoTicket()}`;
  const nome = String(base)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 90);

  const canal = await guild.channels.create({
    name: nome,
    type: ChannelType.GuildText,
    parent: categoriaId || undefined,
    permissionOverwrites: overwrites,
  });
  gravarTicketAberto(canal, userId, tipoKey);
  return canal;
}

async function enviarMensagemTicket(canal, { userId, texto, extraRows = [] }) {
  const painelTicket = montarPainelV2({
    imagemUrl: ticketsBannerUrl(),
    accentColor: 0x2b2d31,
    texto,
    extraRows: [buildBotoesTicket(canal.id), ...extraRows],
  });
  await canal.send({
    ...painelTicket.payload,
    allowedMentions: {
      users: userId ? [userId] : [],
      roles: ticketsCargosStaffIds(),
    },
  });
}

async function criarTicket(interaction, tipoKey) {
  const tipo = TIPOS_TICKET[tipoKey];
  if (!tipo) return;

  let canal;
  try {
    canal = await criarCanalTicket(interaction.guild, interaction.user.id, tipoKey);
  } catch (err) {
    console.error('Falha ao criar canal de ticket:', err.message);
    return interaction.reply({
      content:
        'Não consegui criar o canal do ticket. Confirma que o bot tem a permissão **Gerir Canais** ' +
        'e que a categoria de tickets existe.',
      ephemeral: true,
    });
  }

  await enviarMensagemTicket(canal, {
    userId: interaction.user.id,
    texto:
      `Olá <@${interaction.user.id}>! Ticket de **${tipo.label}** aberto — em breve alguém da equipa vai responder. ` +
      ticketsStaffMencoes(),
  });

  await interaction.reply({
    content: `✅ Ticket criado: <#${canal.id}>`,
    ephemeral: true,
  });
}

function textoPedidoCliente(orderId, product, quantidade) {
  const totalCents = product.price_cents * quantidade;
  const instrucoes =
    process.env.PAYMENT_INFO ||
    'Contacta um administrador para efetuares o pagamento. Assim que for confirmado, a staff entrega-te o produto.';
  return (
    `🧾 Pedido **#${orderId}** criado — **${quantidade}x ${product.name}** por ${formatPrice(
      totalCents,
      product.currency
    )}.\n\n` +
    `**Como pagar:** ${instrucoes}\n\n` +
    `Depois de pagares, **envia uma foto do comprovante** neste ticket (ou por DM ao bot). ` +
    `O bot reconhece a imagem e manda à staff.\n\n` +
    `Assim que um admin confirmar, a staff entrega-te o produto. 📩`
  );
}

async function abrirTicketPedido(interaction, { orderId, product, quantidade }) {
  if (!interaction.guild) return null;
  try {
    const canal = await criarCanalTicket(
      interaction.guild,
      interaction.user.id,
      'receber-produto',
      `receber-produto-${orderId}`
    );
    const rowPedido = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Entregar')
        .setStyle(ButtonStyle.Success)
        .setCustomId(`entregar_${orderId}`),
      new ButtonBuilder()
        .setLabel('Cancelar')
        .setStyle(ButtonStyle.Danger)
        .setCustomId(`cancelar_${orderId}`)
    );
    await enviarMensagemTicket(canal, {
      userId: interaction.user.id,
      texto:
        `Olá <@${interaction.user.id}>! Ticket de **Receber Produto**.\n\n` +
        `${textoPedidoCliente(orderId, product, quantidade)}\n\n` +
        ticketsStaffMencoes(),
    });
    await canal.send({
      content: 'Staff: confirma o pagamento e clica **Entregar**.',
      components: [rowPedido],
    });
    return canal;
  } catch (err) {
    console.error('Falha ao criar ticket do pedido:', err.message);
    return null;
  }
}

// "Adicionar Membro" — mostra um seletor de utilizador (ephemeral).
async function abrirSeletorMembro(interaction, channelId) {
  const select = new UserSelectMenuBuilder()
    .setCustomId(`ticket_addmember_select_${channelId}`)
    .setPlaceholder('Escolhe o membro a adicionar')
    .setMinValues(1)
    .setMaxValues(1);

  await interaction.reply({
    content: 'Quem queres adicionar a este ticket?',
    components: [new ActionRowBuilder().addComponents(select)],
    ephemeral: true,
  });
}

async function adicionarMembroAoTicket(interaction, channelId) {
  const canal = await interaction.guild.channels.fetch(channelId).catch(() => null);
  const membro = interaction.users.first();
  if (!canal || !membro) {
    return interaction.update({ content: 'Não foi possível adicionar esse membro.', components: [] });
  }

  await canal.permissionOverwrites.edit(membro.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
  });

  await canal.send(`👤 <@${membro.id}> foi adicionado ao ticket por <@${interaction.user.id}>.`);
  await interaction.update({ content: `✅ <@${membro.id}> adicionado ao ticket.`, components: [] });
}

// "Criar Call" — canal de voz temporário com os mesmos acessos do ticket.
async function criarCallTicket(interaction, channelId) {
  const canalTexto = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!canalTexto) {
    return interaction.reply({ content: 'Não encontrei o canal deste ticket.', ephemeral: true });
  }

  try {
    const canalVoz = await interaction.guild.channels.create({
      name: `call-${canalTexto.name}`,
      type: ChannelType.GuildVoice,
      parent: canalTexto.parentId || undefined,
      permissionOverwrites: canalTexto.permissionOverwrites.cache.map((o) => ({
        id: o.id,
        allow: o.allow,
        deny: o.deny,
      })),
    });
    await interaction.reply({ content: `🔔 Call criada: <#${canalVoz.id}>`, ephemeral: false });
  } catch (err) {
    console.error('Falha ao criar call do ticket:', err.message);
    await interaction.reply({
      content: 'Não consegui criar o canal de voz — confirma que o bot tem a permissão **Gerir Canais**.',
      ephemeral: true,
    });
  }
}

// "Pedir Gank" — chama a staff para este ticket.
async function pedirGankTicket(interaction) {
  await interaction.reply({
    content: `❗ ${ticketsStaffMencoes()} — <@${interaction.user.id}> precisa de ajuda neste ticket!`,
  });
}

async function pedirFecharTicket(interaction, channelId) {
  const canal = channelId
    ? await interaction.guild.channels.fetch(channelId).catch(() => null)
    : interaction.channel;

  if (!canal || !ehCanalTicket(canal)) {
    return interaction.reply({
      content: 'Este comando só funciona dentro de um ticket.',
      ephemeral: true,
    });
  }

  if (!podeGerirTicket(interaction.member, canal)) {
    return interaction.reply({
      content: 'Não tens permissão para fechar este ticket.',
      ephemeral: true,
    });
  }

  await interaction.reply({ content: 'A fechar o ticket…', ephemeral: true });
  await fecharTicket(canal, interaction.user);
}

// "Renomear Ticket" — abre um modal a pedir o novo nome.
async function abrirModalRenomear(interaction, channelId) {
  const modal = new ModalBuilder()
    .setCustomId(`ticket_rename_modal_${channelId}`)
    .setTitle('Renomear ticket');

  const input = new TextInputBuilder()
    .setCustomId('novo_nome')
    .setLabel('Novo nome do canal')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(90)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

async function renomearTicket(interaction, channelId) {
  const novoNome = interaction.fields.getTextInputValue('novo_nome');
  const canal = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!canal) {
    return interaction.reply({ content: 'Não encontrei este canal.', ephemeral: true });
  }
  try {
    await canal.setName(novoNome);
    await interaction.reply({ content: `✏️ Ticket renomeado para **${novoNome}**.`, ephemeral: true });
  } catch (err) {
    console.error('Falha ao renomear ticket:', err.message);
    await interaction.reply({
      content: 'Não consegui renomear (nome inválido ou sem permissão **Gerir Canais**).',
      ephemeral: true,
    });
  }
}

// ---------------------------------------------------------------------------
// Compra (pagamento manual): cria o pedido, mostra as instruções de pagamento
// ao cliente e avisa os admins com um botão para entregar.
// ---------------------------------------------------------------------------

async function iniciarCompra(interaction, productId) {
  const product = db.getProduct(productId);
  if (!product || !product.active) {
    return interaction.reply({ content: 'Este produto já não está disponível.', ephemeral: true });
  }

  const stock = stockDoProduto(product);
  if (stock <= 0) {
    return interaction.reply({ content: 'Este produto está esgotado no momento.', ephemeral: true });
  }

  const modal = new ModalBuilder()
    .setCustomId(`comprar_qty_${product.id}`)
    .setTitle('Quantidade');

  const input = new TextInputBuilder()
    .setCustomId('quantidade')
    .setLabel(`Quantos queres? (1 a ${Math.min(stock, 99)})`)
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(3)
    .setValue('1')
    .setRequired(true)
    .setPlaceholder('1');

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

async function confirmarCompraComQuantidade(interaction, productId) {
  const product = db.getProduct(productId);
  if (!product || !product.active) {
    return interaction.reply({ content: 'Este produto já não está disponível.', ephemeral: true });
  }

  const raw = (interaction.fields.getTextInputValue('quantidade') || '').trim();
  const quantidade = parseInt(raw, 10);
  const stock = stockDoProduto(product);
  if (!Number.isFinite(quantidade) || quantidade < 1) {
    return interaction.reply({ content: 'Quantidade inválida. Usa um número maior que 0.', ephemeral: true });
  }
  if (quantidade > stock) {
    return interaction.reply({
      content: `Só há **${stock}** em stock de **${product.name}**.`,
      ephemeral: true,
    });
  }

  const orderId = db.createOrder({
    productId: product.id,
    discordUserId: interaction.user.id,
    quantity: quantidade,
  });
  if (!orderId) {
    return interaction.reply({ content: 'Este produto está esgotado no momento.', ephemeral: true });
  }

  const canalPedido = await abrirTicketPedido(interaction, { orderId, product, quantidade });

  if (canalPedido) {
    await interaction.reply({
      content: `✅ Pedido **#${orderId}** criado. Continua no ticket de receber produto: <#${canalPedido.id}>`,
      ephemeral: true,
    });
  } else {
    await interaction.reply({
      content: textoPedidoCliente(orderId, product, quantidade),
      ephemeral: true,
    });
  }

  await notificarPedidoAdmins(interaction, orderId, product, quantidade);
}

// Publica o pedido no canal de logs de entrega (LOGS_ENTREGA_CHANNEL_ID)
// com os botões "Entregar" e "Cancelar".
async function notificarPedidoAdmins(interaction, orderId, product, quantidade = 1) {
  const channelId = logsCanalId();
  if (!channelId) return;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) return;

    const qty = Math.max(1, Number(quantidade) || 1);
    const embed = new EmbedBuilder()
      .setTitle(`🛒 Novo pedido #${orderId}`)
      .setColor(0xfaa61a)
      .addFields(
        {
          name: 'Produto',
          value: `${qty}x ${product.name} — ${formatPrice(product.price_cents * qty, product.currency)}`,
        },
        { name: 'Cliente', value: `<@${interaction.user.id}>` },
        { name: 'Estado', value: 'Aguarda confirmação de pagamento (a staff entrega à mão)' }
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Entregar')
        .setStyle(ButtonStyle.Success)
        .setCustomId(`entregar_${orderId}`),
      new ButtonBuilder()
        .setLabel('Cancelar')
        .setStyle(ButtonStyle.Danger)
        .setCustomId(`cancelar_${orderId}`)
    );

    await channel.send({ embeds: [embed], components: [row] });
  } catch (err) {
    console.error('Falha ao notificar admins do pedido:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Confirmação manual pelo admin: entrega a chave e envia por DM ao cliente.
// ---------------------------------------------------------------------------

async function entregarPorAdmin(interaction, orderId) {
  if (!podeEntregarPedidos(interaction)) {
    return interaction.reply({
      content: 'Só a staff pode entregar pedidos.',
      ephemeral: true,
    });
  }

  const order = db.getOrder(orderId);
  if (!order) {
    return interaction.reply({ content: `Não existe o pedido #${orderId}.`, ephemeral: true });
  }
  if (order.status === 'delivered') {
    return interaction.reply({ content: `O pedido #${orderId} já foi entregue.`, ephemeral: true });
  }

  marcarTicketClaimed(interaction.channel, interaction.user.id);
  await entregarPedido(orderId, { deliveredBy: interaction.user.id });
  const entregue = db.getOrder(orderId).status === 'delivered';

  await interaction.reply({
    content: entregue
      ? `✅ Pedido #${orderId} marcado como entregue. Se havia chaves, foram enviadas por DM; senão a staff entrega à mão.`
      : `⚠️ Pedido #${orderId}: não consegui concluir a entrega.`,
    ephemeral: true,
  });

  if (entregue && interaction.message) {
    try {
      await interaction.message.edit({ components: [] });
    } catch {
      /* mensagem pode não ser editável */
    }
  }
}

async function cancelarPedido(interaction, orderId) {
  if (!podeEntregarPedidos(interaction)) {
    return interaction.reply({
      content: 'Só a staff pode cancelar pedidos.',
      ephemeral: true,
    });
  }
  const order = db.getOrder(orderId);
  if (order && order.status === 'pending') {
    db.addStock(order.product_id, order.quantity || 1);
  }
  db.markOrderStatus(orderId, 'expired');
  await interaction.reply({ content: `Pedido #${orderId} cancelado. Stock devolvido.`, ephemeral: true });
  if (interaction.message) {
    try {
      await interaction.message.edit({ components: [] });
    } catch {
      /* ignora */
    }
  }
}

// ---------------------------------------------------------------------------
// Entrega: aloca uma chave livre e envia-a por DM ao cliente.
// ---------------------------------------------------------------------------

async function entregarPedido(orderId, opts = {}) {
  const order = db.getOrder(orderId);
  if (!order || order.status === 'delivered') return; // já entregue, evita duplicar

  const product = db.getProduct(order.product_id);
  const quantidade = Math.max(1, Number(order.quantity) || 1);
  const keyIds = db.allocateKeys(order.product_id, order.discord_user_id, quantidade);
  const chaves = keyIds.map((id) => db.getKeyValue(id)).filter(Boolean);

  db.markOrderDelivered(order.id, keyIds[0] || null);

  try {
    const user = await client.users.fetch(order.discord_user_id);
    if (chaves.length > 0) {
      const bloco = chaves.map((k) => `\`${k}\``).join('\n');
      await user.send(
        `✅ Pagamento confirmado! Aqui ${chaves.length === 1 ? 'está a tua chave' : 'estão as tuas chaves'} de **${quantidade}x ${product.name}**:\n${bloco}\nObrigado pela compra!`
      );
    } else {
      await user.send(
        `✅ Pagamento confirmado! A staff vai entregar-te **${quantidade}x ${product.name}**. Obrigado pela compra!`
      );
    }
  } catch (err) {
    await logToChannel(
      `⚠️ Pedido #${order.id}: pagamento confirmado mas não consegui enviar DM a <@${order.discord_user_id}> (tem as DMs fechadas?).` +
        (chaves.length ? ` Chaves: ${chaves.map((k) => `\`${k}\``).join(', ')}` : ' Entrega à mão.')
    );
  }

  // Atribuir cargo de cliente, se o produto tiver um definido
  if (product.role_id) {
    try {
      const guild = await client.guilds.fetch(process.env.GUILD_ID);
      const member = await guild.members.fetch(order.discord_user_id);
      await member.roles.add(product.role_id);
    } catch (err) {
      console.error('Falha ao atribuir cargo:', err.message);
    }
  }

  await logToChannel(
    `💰 Venda concluída: **${quantidade}x ${product.name}** para <@${order.discord_user_id}> (pedido #${order.id})` +
      (opts.deliveredBy ? ` — entregue por <@${opts.deliveredBy}>` : '') +
      '.'
  );
}

// ---------------------------------------------------------------------------
// Verificação: painel + captcha (3 códigos, só um é o certo, ex. BVC-DGD).
// ---------------------------------------------------------------------------

const captchasPendentes = new Map();
const LETRAS_CAPTCHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function blocoCaptcha(tamanho) {
  let out = '';
  for (let i = 0; i < tamanho; i++) {
    out += LETRAS_CAPTCHA[Math.floor(Math.random() * LETRAS_CAPTCHA.length)];
  }
  return out;
}

function gerarCodigoCaptcha() {
  return `${blocoCaptcha(3)}-${blocoCaptcha(3)}`;
}

function gerarOpcoesCaptcha() {
  const certo = gerarCodigoCaptcha();
  const opcoes = new Set([certo]);
  while (opcoes.size < 3) opcoes.add(gerarCodigoCaptcha());
  return { certo, lista: [...opcoes].sort(() => Math.random() - 0.5) };
}

function bannerVerificacaoPadrao() {
  return (
    process.env.VERIFY_BANNER_URL ||
    'https://media.discordapp.net/attachments/1545383446208315422/1545780693550891009/banner.png?ex=6aa15874&is=6aa006f4&hm=56751429c4ad74e1edd9ded35491d91681dfed9e4c5e8c0bac13f9039c16369b&=&format=webp&quality=lossless&width=1521&height=856'
  );
}

async function publicarVerificacaoNoCanal(channel, opts = {}) {
  const roleId = opts.roleId || cargoVerificacaoId();
  const imagem = opts.imagem || bannerVerificacaoPadrao();
  const titulo = opts.titulo || 'VERIFICAÇÃO';
  const bullets =
    opts.descricao ||
    '• Clique no botão para se verificar\n' +
      '• Escolhe o código certo (3 opções, só uma é válida)\n' +
      '• Libera o acesso aos canais do servidor';

  const texto =
    `## ${titulo}\n` +
    bullets.split('\n').filter(Boolean).join('\n') +
    '\n\n```ansi\n\u001b[2;32m✅ Verifique-se agora!\u001b[0m\n```';

  const botao = new ButtonBuilder()
    .setLabel('Verificar')
    .setEmoji('✅')
    .setStyle(ButtonStyle.Success)
    .setCustomId(`verificar_${roleId}`);

  const painel = montarPainelV2({
    imagemUrl: imagem,
    accentColor: 0x2b2d31,
    texto,
    rodape: 'Acesso ao servidor\nClique no botão **"Verificar"**',
    accessory: botao,
  });

  await enviarPainel(channel, painel);
}

async function publicarVerificacao(interaction) {
  const cargo = interaction.options.getRole('cargo');
  const roleId = cargo?.id || cargoVerificacaoId();
  const anexo = interaction.options.getAttachment('anexo');
  const imagem = anexo?.url || interaction.options.getString('imagem') || bannerVerificacaoPadrao();
  const titulo = interaction.options.getString('titulo') || 'VERIFICAÇÃO';
  const descricao = interaction.options.getString('descricao') || null;

  try {
    await publicarVerificacaoNoCanal(interaction.channel, { roleId, imagem, titulo, descricao });
  } catch (err) {
    console.error('Falha ao publicar verificação:', err);
    return interaction.reply({
      content:
        `Não consegui publicar o painel neste canal (${err.message}).\n` +
        'Confirma que o bot tem, **neste canal**, as permissões **Ver Canal**, ' +
        '**Enviar Mensagens** e **Inserir Links/Embeds**.',
      ephemeral: true,
    });
  }

  await interaction.reply({ content: 'Painel de verificação publicado! ✅', ephemeral: true });
}

async function pedirCaptchaVerificacao(interaction, roleId) {
  const member = interaction.member;
  if (member?.roles?.cache?.has(roleId)) {
    return interaction.reply({ content: '✅ Já estás verificado!', ephemeral: true });
  }

  const { certo, lista } = gerarOpcoesCaptcha();
  captchasPendentes.set(interaction.user.id, {
    roleId,
    certo,
    expira: Date.now() + 2 * 60 * 1000,
  });

  const row = new ActionRowBuilder().addComponents(
    lista.map((codigo) =>
      new ButtonBuilder()
        .setLabel(codigo)
        .setStyle(ButtonStyle.Secondary)
        .setCustomId(`vcap_${roleId}_${codigo}`)
    )
  );

  await interaction.reply({
    content: `Para te verificares, escolhe o código **${certo}**:`,
    components: [row],
    ephemeral: true,
  });
}

async function resolverCaptchaVerificacao(interaction, roleId, codigo) {
  const pend = captchasPendentes.get(interaction.user.id);
  if (!pend || pend.roleId !== roleId || Date.now() > pend.expira) {
    return interaction.update({
      content: 'Captcha expirado. Clica em **Verificar** outra vez.',
      components: [],
    });
  }

  if (codigo !== pend.certo) {
    captchasPendentes.delete(interaction.user.id);
    return interaction.update({
      content: '❌ Código errado. Clica em **Verificar** e tenta outra vez.',
      components: [],
    });
  }

  captchasPendentes.delete(interaction.user.id);
  await verificarMembro(interaction, roleId, { viaUpdate: true });
}

async function verificarMembro(interaction, roleId, opts = {}) {
  const member = interaction.member;
  const responder = (payload) =>
    opts.viaUpdate ? interaction.update(payload) : interaction.reply({ ...payload, ephemeral: true });

  if (member?.roles?.cache?.has(roleId)) {
    return responder({ content: '✅ Já estás verificado!', components: [] });
  }
  try {
    await member.roles.add(roleId);
    await responder({
      content: '✅ Verificado! Já tens acesso ao servidor.',
      components: [],
    });
    await logToChannel(`✅ <@${interaction.user.id}> verificou-se (cargo <@&${roleId}>).`);
  } catch (err) {
    console.error('Falha ao verificar membro:', err.message);
    await responder({
      content:
        'Não consegui dar-te o cargo. Um admin precisa de dar ao bot a permissão **Gerir Cargos** ' +
        'e de colocar o cargo do bot **acima** do cargo de verificação.',
      components: [],
    });
  }
}

// ---------------------------------------------------------------------------
// Slash commands e interações
// ---------------------------------------------------------------------------

async function aoInteracao(interaction) {
  try {
    // Autocomplete do campo "categoria" do /loja — mostra as categorias que
    // já existem (trial, virgem, spotify, ...) para escolheres por lista em
    // vez de teres de escrever o nome certo à mão.
    if (interaction.isAutocomplete()) {
      const focused = interaction.options.getFocused(true);
      if (interaction.commandName === 'loja' && focused.name === 'categoria') {
        const termo = (focused.value || '').toLowerCase();
        const categorias = db
          .listCategories()
          .filter((c) => c.toLowerCase().includes(termo))
          .slice(0, 25);
        await interaction.respond(categorias.map((c) => ({ name: c, value: c })));
      }
      return;
    }

    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      if (commandName === 'produto-criar') {
        const nome = interaction.options.getString('nome');
        const preco = interaction.options.getNumber('preco');
        const descricao = interaction.options.getString('descricao') || '';
        const moeda = interaction.options.getString('moeda') || 'eur';
        const categoria = interaction.options.getString('categoria') || null;
        const cargo = interaction.options.getRole('cargo');

        const id = db.addProduct({
          name: nome,
          description: descricao,
          priceCents: Math.round(preco * 100),
          currency: moeda,
          category: categoria,
          roleId: cargo?.id,
        });

        await interaction.reply({
          content: `Produto criado! **${nome}** (ID: ${id}). Agora usa \`!chave-adicionar ${id}\` com um ficheiro .txt para carregares as chaves.`,
          ephemeral: true,
        });
      }

      if (commandName === 'chave-adicionar') {
        const productId = interaction.options.getInteger('produto_id');
        const attachment = interaction.options.getAttachment('ficheiro');

        const product = db.getProduct(productId);
        if (!product) {
          return interaction.reply({ content: 'Não existe nenhum produto com esse ID.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const res = await fetch(attachment.url);
        const text = await res.text();
        const lines = text.split('\n');
        const added = db.addKeysBulk(productId, lines);

        await interaction.editReply(
          `Foram adicionadas **${added}** chaves ao produto **${product.name}**. ` +
            `O stock da loja continua a ser o número do \`!stock\` (agora: ${db.getStock(productId)}).`
        );
      }

      if (commandName === 'produtos') {
        const products = db.listActiveProducts();
        if (products.length === 0) {
          return interaction.reply({ content: 'Ainda não há produtos criados.', ephemeral: true });
        }
        const linhas = products.map(
          (p) =>
            `**#${p.id} ${p.name}** — ${formatPrice(p.price_cents, p.currency)}${
              p.category ? ` — [${p.category}]` : ''
            } — stock: ${stockDoProduto(p)}`
        );
        await interaction.reply({ content: linhas.join('\n'), ephemeral: true });
      }

      if (commandName === 'loja') {
        await publicarLoja(interaction, interaction.options.getString('categoria'));
      }

      if (CATEGORIA_POR_COMANDO[commandName]) {
        await publicarLoja(interaction, CATEGORIA_POR_COMANDO[commandName]);
      }

      if (commandName === 'entregar') {
        const pedidoId = interaction.options.getInteger('pedido_id');
        await entregarPorAdmin(interaction, pedidoId);
      }

      if (commandName === 'tickets') {
        const anexo = interaction.options.getAttachment('anexo');
        const painel = gerarPainelTickets({
          imagem: anexo?.url || interaction.options.getString('imagem') || null,
          titulo: interaction.options.getString('titulo') || null,
          descricao: interaction.options.getString('descricao') || null,
        });
        await enviarPainel(interaction.channel, painel);
        await interaction.reply({ content: 'Painel de tickets publicado!', ephemeral: true });
      }

      if (commandName === 'verificacao') {
        await publicarVerificacao(interaction);
      }

      if (commandName === 'comandos') {
        await interaction.reply({ content: textoComandos(), ephemeral: true });
      }

      if (commandName === 'fechar') {
        await pedirFecharTicket(interaction, interaction.channelId);
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'comprar_select') {
      const productId = Number(interaction.values[0]);
      await iniciarCompra(interaction, productId);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('comprar_qty_')) {
      const productId = Number(interaction.customId.slice('comprar_qty_'.length));
      await confirmarCompraComQuantidade(interaction, productId);
    }

    if (interaction.isButton() && interaction.customId.startsWith('entregar_')) {
      const orderId = Number(interaction.customId.slice('entregar_'.length));
      await entregarPorAdmin(interaction, orderId);
    }

    if (interaction.isButton() && interaction.customId.startsWith('cancelar_')) {
      const orderId = Number(interaction.customId.slice('cancelar_'.length));
      await cancelarPedido(interaction, orderId);
    }

    if (interaction.isButton() && interaction.customId.startsWith('verificar_')) {
      const roleId = interaction.customId.slice('verificar_'.length);
      await pedirCaptchaVerificacao(interaction, roleId);
    }

    if (interaction.isButton() && interaction.customId.startsWith('vcap_')) {
      const resto = interaction.customId.slice('vcap_'.length);
      const sep = resto.indexOf('_');
      const roleId = resto.slice(0, sep);
      const codigo = resto.slice(sep + 1);
      await resolverCaptchaVerificacao(interaction, roleId, codigo);
    }

    // Botão "⭐ Comprar" do painel — abre (ephemeral) o menu com os produtos
    // dessa categoria para o cliente escolher qual quer comprar.
    if (interaction.isButton() && interaction.customId.startsWith('abrir_')) {
      const categoria = decodeURIComponent(interaction.customId.slice('abrir_'.length)) || null;
      const products = categoria
        ? db.listActiveProductsByCategory(categoria)
        : db.listActiveProducts();

      const row = buildSelectRow(products);
      if (!row) {
        return interaction.reply({
          content: 'Não há produtos disponíveis nesta loja de momento.',
          ephemeral: true,
        });
      }

      await interaction.reply({
        content: 'Escolhe o produto que queres comprar:',
        components: [row],
        ephemeral: true,
      });
    }

    // ------------------------- Sistema de tickets -------------------------

    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_tipo_select') {
      await criarTicket(interaction, interaction.values[0]);
    }

    if (interaction.isUserSelectMenu() && interaction.customId.startsWith('ticket_addmember_select_')) {
      const channelId = interaction.customId.slice('ticket_addmember_select_'.length);
      await adicionarMembroAoTicket(interaction, channelId);
    }

    if (interaction.isButton() && interaction.customId.startsWith('ticket_addmember_')) {
      const channelId = interaction.customId.slice('ticket_addmember_'.length);
      await abrirSeletorMembro(interaction, channelId);
    }

    if (interaction.isButton() && interaction.customId.startsWith('ticket_call_')) {
      const channelId = interaction.customId.slice('ticket_call_'.length);
      await criarCallTicket(interaction, channelId);
    }

    if (interaction.isButton() && interaction.customId.startsWith('ticket_gank_')) {
      await pedirGankTicket(interaction);
    }

    if (interaction.isButton() && interaction.customId.startsWith('ticket_rename_')) {
      const channelId = interaction.customId.slice('ticket_rename_'.length);
      await abrirModalRenomear(interaction, channelId);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_rename_modal_')) {
      const channelId = interaction.customId.slice('ticket_rename_modal_'.length);
      await renomearTicket(interaction, channelId);
    }

    if (interaction.isButton() && interaction.customId.startsWith('ticket_fechar_')) {
      const channelId = interaction.customId.slice('ticket_fechar_'.length);
      await pedirFecharTicket(interaction, channelId);
    }
  } catch (err) {
    console.error(err);
    if (interaction.isRepliable()) {
      const msg = { content: 'Ocorreu um erro ao processar isso. Tenta novamente.', ephemeral: true };
      if (interaction.deferred || interaction.replied) await interaction.followUp(msg);
      else await interaction.reply(msg);
    }
  }
}

// ---------------------------------------------------------------------------
// Comandos de texto com "!" — alternativa aos slash commands.
// Ex.: escreve "!loja-trial", "!loja-spotify" ou "!loja spotify" num canal.
// Precisa da MESSAGE CONTENT INTENT ativada no Developer Portal do bot
// (Bot > Privileged Gateway Intents > Message Content Intent) — sem isso o
// bot não recebe o texto das mensagens e este bloco não faz nada.
// ---------------------------------------------------------------------------

function anexosImagem(message) {
  return [...message.attachments.values()].filter((a) => {
    if (a.contentType && a.contentType.startsWith('image/')) return true;
    return /\.(png|jpe?g|webp|gif|bmp)$/i.test(a.name || a.url || '');
  });
}

async function encaminharComprovante(message) {
  const imagens = anexosImagem(message);
  if (imagens.length === 0) return false;
  if (message.channelId === logsCanalId()) return false;
  if (message.guild && ehStaffTickets(message.member)) return false;

  const pending = db.listPendingOrdersByUser(message.author.id);
  const emTicket = message.guild ? ehCanalTicket(message.channel) : false;
  const emDm = !message.guild;

  if (!emTicket && !emDm && pending.length === 0) return false;

  const origem = emDm
    ? 'DM do bot'
    : `${message.channel} (\`${message.channel.name}\`)`;
  const pedidos =
    pending.length > 0
      ? pending
          .map(
            (o) =>
              `#${o.id} ${o.quantity || 1}x ${o.product_name} — ${formatPrice(
                o.price_cents * (o.quantity || 1),
                o.currency
              )}`
          )
          .join('\n')
      : 'Nenhum pedido pendente';

  const dest = await client.channels.fetch(logsCanalId()).catch(() => null);
  if (!dest?.isTextBased()) return false;

  const row =
    pending.length > 0
      ? new ActionRowBuilder().addComponents(
          pending.slice(0, 5).map((o) =>
            new ButtonBuilder()
              .setLabel(`Entregar #${o.id}`)
              .setStyle(ButtonStyle.Success)
              .setCustomId(`entregar_${o.id}`)
          )
        )
      : null;

  await dest.send({
    content:
      `💸 **Comprovante de pagamento** de <@${message.author.id}>\n` +
      `Origem: ${origem}\n` +
      `Pedidos pendentes:\n${pedidos}`,
    files: imagens.map((a) => ({ attachment: a.url, name: a.name || 'comprovante.png' })),
    components: row ? [row] : [],
    allowedMentions: { users: [message.author.id] },
  });

  try {
    await message.react('✅');
  } catch {
    /* sem permissão para reagir */
  }
  return true;
}

async function apagarComando(message) {
  try {
    await message.delete();
  } catch {
    /* sem permissão para apagar — não é grave */
  }
}

async function aoMensagem(message) {
  try {
    if (message.author.bot) return;

    if (anexosImagem(message).length > 0) {
      try {
        await encaminharComprovante(message);
      } catch (err) {
        console.error('Falha ao encaminhar comprovante:', err.message);
      }
    }

    if (!message.content.startsWith(PREFIXO)) return;

    const [cmd, ...resto] = message.content.slice(PREFIXO.length).trim().split(/\s+/);
    const nomeComando = (cmd || '').toLowerCase();

    if (nomeComando === 'comandos' || nomeComando === 'cmds' || nomeComando === 'help') {
      await message.reply({ content: textoComandos() });
      return;
    }

    if (nomeComando === 'fechar' || nomeComando === 'close') {
      if (!ehCanalTicket(message.channel)) {
        await message.reply('Este comando só funciona dentro de um ticket.');
        return;
      }
      if (!podeGerirTicket(message.member, message.channel)) {
        await message.reply('Não tens permissão para fechar este ticket.');
        return;
      }
      const motivo = resto.join(' ').trim() || null;
      await fecharTicket(message.channel, message.author, motivo);
      return;
    }

    if (nomeComando === 'entregar') {
      if (!ehStaffTickets(message.member)) {
        return;
      }
      const pedidoId = Number(resto[0]);
      if (!Number.isFinite(pedidoId)) {
        await message.reply('Uso: `!entregar <pedido_id>`');
        return;
      }
      const order = db.getOrder(pedidoId);
      if (!order) {
        await message.reply(`Não existe o pedido #${pedidoId}.`);
        return;
      }
      if (order.status === 'delivered') {
        await message.reply(`O pedido #${pedidoId} já foi entregue.`);
        return;
      }
      marcarTicketClaimed(message.channel, message.author.id);
      await entregarPedido(pedidoId, { deliveredBy: message.author.id });
      const entregue = db.getOrder(pedidoId).status === 'delivered';
      await message.reply(
        entregue
          ? `✅ Pedido #${pedidoId} marcado como entregue. Se havia chaves, foram enviadas por DM; senão a staff entrega à mão.`
          : `⚠️ Pedido #${pedidoId}: não consegui concluir a entrega.`
      );
      return;
    }

    if (!message.member?.permissions?.has(PermissionFlagsBits.Administrator)) return;

    if (nomeComando === 'loja') {
      const categoria = resto.join(' ') || null;
      await publicarLojaTexto(message, categoria);
      return;
    }

    if (nomeComando === 'tickets') {
      const painel = gerarPainelTickets({});
      await enviarPainel(message.channel, painel);
      await apagarComando(message);
      return;
    }

    if (nomeComando === 'verificacao' || nomeComando === 'verificação') {
      const mencionado = message.mentions.roles.first();
      const roleId = mencionado?.id || (resto[0] && /^\d{17,20}$/.test(resto[0]) ? resto[0] : cargoVerificacaoId());
      try {
        await publicarVerificacaoNoCanal(message.channel, { roleId });
        await apagarComando(message);
      } catch (err) {
        await message.reply(`Não consegui publicar o painel (${err.message}).`);
      }
      return;
    }

    if (nomeComando === 'stock' || nomeComando === 'estoque') {
      const products = db.listActiveProducts();
      if (resto.length === 0) {
        if (products.length === 0) {
          await message.reply('Ainda não há produtos criados.');
          return;
        }
        const linhas = products.map(
          (p) => `**#${p.id} ${p.name}** — stock: **${stockDoProduto(p)}**`
        );
        await message.reply(
          'Stock atual. Ex.: `!stock adicionar 2x impulso 4`\n' + linhas.join('\n')
        );
        return;
      }

      const acoes = {
        adicionar: 'add',
        add: 'add',
        mais: 'add',
        remover: 'remove',
        tirar: 'remove',
        remove: 'remove',
        menos: 'remove',
        definir: 'set',
        set: 'set',
        meter: 'set',
      };
      let acao = 'set';
      let args = resto.slice();
      if (acoes[args[0]?.toLowerCase()]) {
        acao = acoes[args.shift().toLowerCase()];
      }

      const qtdRaw = args.length >= 1 ? args[args.length - 1] : null;
      const temQtd = qtdRaw != null && /^[+-]?\d+$/.test(qtdRaw);
      const chave = temQtd ? args.slice(0, -1).join(' ') : args.join(' ');
      if (!chave) {
        await message.reply('Uso: `!stock adicionar 2x impulso 4`');
        return;
      }

      const { produto, ambiguos } = encontrarProdutoPorTexto(chave);
      if (!produto) {
        if (ambiguos.length > 0) {
          await message.reply(
            'Há mais do que um produto. Diz o nome mais completo (só um é alterado):\n' +
              ambiguos.map((p) => `• **#${p.id} ${p.name}**`).join('\n')
          );
          return;
        }
        await message.reply('Não reconheci esse produto. Ex.: `!stock adicionar 2x impulso 4`');
        return;
      }
      if (!temQtd) {
        await message.reply(
          `**#${produto.id} ${produto.name}** tem stock **${stockDoProduto(produto)}**.\n` +
            `Usa \`!stock adicionar ${produto.name} 4\` para acrescentar.`
        );
        return;
      }

      const n = parseInt(qtdRaw, 10);
      if (!Number.isFinite(n)) {
        await message.reply('Quantidade inválida. Ex.: `!stock adicionar 2x impulso 4`');
        return;
      }

      let novo;
      let verbo = 'definido como';
      if (acao === 'add' || (acao === 'set' && /^[+-]\d+$/.test(qtdRaw))) {
        novo = db.addStock(produto.id, Math.abs(n) * (acao === 'remove' || n < 0 ? -1 : 1));
        verbo = n < 0 || acao === 'remove' ? 'reduzido para' : 'aumentado para';
      } else if (acao === 'remove') {
        novo = db.addStock(produto.id, -Math.abs(n));
        verbo = 'reduzido para';
      } else {
        if (n < 0) {
          await message.reply('Quantidade inválida. Ex.: `!stock adicionar 2x impulso 4`');
          return;
        }
        novo = db.setStock(produto.id, n);
      }
      await message.reply(
        `📦 Stock de **${produto.name}** ${verbo} **${novo}** (os outros produtos ficaram iguais).`
      );
      return;
    }

    if (nomeComando === 'produtos') {
      const products = db.listActiveProducts();
      if (products.length === 0) {
        await message.reply('Ainda não há produtos criados.');
        return;
      }
      const linhas = products.map(
        (p) =>
          `**#${p.id} ${p.name}** — ${formatPrice(p.price_cents, p.currency)}${
            p.category ? ` — [${p.category}]` : ''
          } — stock: ${stockDoProduto(p)}`
      );
      await message.reply(linhas.join('\n'));
      return;
    }

    if (nomeComando === 'produto-criar') {
      const preco = Number(String(resto[0] || '').replace(',', '.'));
      const categoria = resto[1];
      const nome = resto.slice(2).join(' ').trim();
      if (!Number.isFinite(preco) || !categoria || !nome) {
        await message.reply(
          'Uso: `!produto-criar <preco> <categoria> <nome>`\nEx.: `!produto-criar 4 rockstar 1 Rockstar Acc`'
        );
        return;
      }
      const id = db.addProduct({
        name: nome,
        description: '',
        priceCents: Math.round(preco * 100),
        currency: 'eur',
        category: categoria,
      });
      await message.reply(
        `Produto criado! **${nome}** (ID: ${id}, stock 10). Altera com \`!stock ${id} <quantidade>\`.`
      );
      return;
    }

    if (nomeComando === 'chave-adicionar') {
      const productId = Number(resto[0]);
      const product = db.getProduct(productId);
      if (!product) {
        await message.reply('Uso: `!chave-adicionar <produto_id>` + ficheiro .txt (ou chaves no texto).');
        return;
      }
      const attachment = message.attachments.find((a) => /\.txt$/i.test(a.name || '')) || message.attachments.first();
      let linhas = resto.slice(1);
      if (attachment) {
        const res = await fetch(attachment.url);
        const text = await res.text();
        linhas = text.split('\n');
      }
      if (linhas.length === 0) {
        await message.reply('Anexa um .txt com uma chave por linha, ou escreve as chaves a seguir ao ID.');
        return;
      }
      const added = db.addKeysBulk(productId, linhas);
      await message.reply(
        `Foram adicionadas **${added}** chaves ao produto **${product.name}**. ` +
          `O stock da loja continua a ser o número do \`!stock\` (agora: ${db.getStock(productId)}).`
      );
      return;
    }

    if (CATEGORIA_POR_COMANDO[nomeComando]) {
      await publicarLojaTexto(message, CATEGORIA_POR_COMANDO[nomeComando]);
    }
  } catch (err) {
    console.error(err);
  }
}

async function aoReady() {
  ultimoOk = Date.now();
  falhasSeguidas = 0;
  console.log(`Bot ligado como ${client.user.tag}`);
  definirStatusBot();
  if (jaArrancou) return;
  jaArrancou = true;
  try {
    await registerSlashCommands();
  } catch (err) {
    console.error('❌ Erro ao registar comandos:', err);
  }
  try {
    seedProdutosIniciais();
  } catch (err) {
    console.error('❌ Erro ao criar produtos iniciais:', err);
  }
}

function anexarEventos(c) {
  c.on('interactionCreate', aoInteracao);
  c.on('messageCreate', aoMensagem);
  c.on(Events.ClientReady, aoReady);
  c.on(Events.Error, (err) => {
    console.error('Erro do cliente Discord:', err);
  });
  c.on(Events.ShardError, (err, id) => {
    console.error(`Erro no shard ${id}:`, err);
  });
  c.on(Events.ShardReconnecting, (id) => {
    console.log(`A reconectar shard ${id}…`);
  });
  c.on(Events.ShardResume, (id) => {
    ultimoOk = Date.now();
    definirStatusBot();
    console.log(`Shard ${id} reconectado.`);
  });
  c.on(Events.ShardDisconnect, (event, id) => {
    console.error(`Shard ${id} desconectou (código ${event?.code}).`);
    if (CODIGOS_SEM_RECONNECT.has(event?.code)) {
      console.error('Este código não permite reconectar (token/intents). Corrige o .env e reinicia.');
      return;
    }
    setTimeout(() => ligarBot({ forcar: true }), 5000);
  });
}

function emojiDoStatus() {
  const id = STATUS_BOT_EMOJI.id;
  if (client.guilds?.cache) {
    for (const guild of client.guilds.cache.values()) {
      const emoji = guild.emojis.cache.get(id);
      if (emoji) {
        return { name: emoji.name, id: emoji.id, animated: Boolean(emoji.animated) };
      }
    }
  }
  return { ...STATUS_BOT_EMOJI };
}

function montarPresencaStatus() {
  const emoji = emojiDoStatus();
  return {
    since: null,
    afk: false,
    status: 'online',
    activities: [
      {
        type: ActivityType.Custom,
        name: 'Custom Status',
        state: STATUS_BOT,
        ...(emoji ? { emoji } : {}),
      },
    ],
  };
}

function definirStatusBot() {
  if (!client.user) return;
  const presenca = montarPresencaStatus();
  try {
    if (typeof client.ws?.broadcast === 'function') {
      client.ws.broadcast({ op: 3, d: presenca });
      return;
    }
    client.user.setPresence({
      status: presenca.status,
      activities: [{ type: ActivityType.Custom, name: STATUS_BOT, state: STATUS_BOT }],
    });
  } catch (err) {
    console.error('Falha ao definir o status do bot:', err.message);
  }
}

anexarEventos(client);

async function novoCliente() {
  try {
    await client.destroy();
  } catch {
    /* já estava desligado */
  }
  client = criarCliente();
  anexarEventos(client);
}

// Só liga o bot quando o ficheiro é corrido diretamente (npm start).
// Assim o módulo pode ser importado em testes sem tentar autenticar no Discord.
async function ligarBot({ forcar = false } = {}) {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    console.error('❌ Falta DISCORD_TOKEN no .env.');
    process.exit(1);
  }
  if (aLigar) return;
  if (client.isReady() && !forcar) return;

  aLigar = true;
  try {
    if (forcar || client.ws?.destroyed) {
      await novoCliente();
    }
    await client.login(token);
    ultimoOk = Date.now();
    falhasSeguidas = 0;
  } catch (err) {
    falhasSeguidas += 1;
    console.error(`❌ Falha ao ligar ao Discord (${falhasSeguidas}x):`, err.message);
    aLigar = false;
    try {
      await novoCliente();
    } catch {
      /* ignore */
    }
    if (falhasSeguidas >= 12) {
      console.error('❌ Demasiadas falhas. A sair para o host reiniciar o processo…');
      process.exit(1);
    }
    setTimeout(() => ligarBot({ forcar: true }), 5000);
    return;
  }
  aLigar = false;
}

if (require.main === module) {
  process.on('unhandledRejection', (err) => {
    console.error('unhandledRejection:', err);
  });
  process.on('uncaughtException', (err) => {
    console.error('uncaughtException:', err);
    setTimeout(() => ligarBot({ forcar: true }), 3000);
  });

  ligarBot();

  setInterval(() => {
    if (client.isReady()) {
      ultimoOk = Date.now();
      return;
    }
    if (Date.now() - ultimoOk > 60_000) {
      console.warn('⚠️ Sem ligação ao Discord há 1 min, a religar do zero…');
      ultimoOk = Date.now();
      ligarBot({ forcar: true });
    }
  }, 15_000);
}

module.exports = {
  get client() {
    return client;
  },
  gerarPainelLoja,
  gerarPainelTickets,
  formatPrice,
  entregarPedido,
  seedProdutosIniciais,
  encontrarProdutoPorTexto,
  logsCanalId,
  ticketsLogsCanalId,
  ehStaffTickets,
  podeEntregarPedidos,
  montarEmbedTicketFechado,
  formatarDataPt,
  CATEGORIA_POR_COMANDO,
  PAINEL_TEXTOS,
  PRODUTOS_SEED,
  EMOJI_PACK,
  EMOJI_BOLINHA,
  EMOJI_TREVO,
  STATUS_BOT,
  STATUS_BOT_EMOJI,
  STATUS_BOT_EMOJI_ID,
  montarPresencaStatus,
  definirStatusBot,
};
