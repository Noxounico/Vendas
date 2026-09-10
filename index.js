// index.js
// Corre o bot com: npm start
// Os slash commands são registados automaticamente quando o bot liga.
// Bot de vendas com pagamento MANUAL: o cliente compra, um admin confirma o
// pagamento (botão "Entregar" ou /entregar) e a chave é enviada por DM.

require('dotenv').config();
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
  'https://cdn.discordapp.com/attachments/1534183602764648579/1547712371232084109/content.png?ex=6aa46af8&is=6aa31978&hm=e25af16bb901517989d68003802e826b9b0dcaba72368fa90b3e52a20e6bf435&';

// Tickets: categoria, cargo da staff e banner por defeito (env var sobrepõe).
const TICKETS_CATEGORIA_ID_PADRAO = '1322700826912882779';
const TICKETS_CARGO_STAFF_ID_PADRAO = '1443307566921678968';
const TICKETS_BANNER_URL_PADRAO =
  'https://media.discordapp.net/attachments/1534183602764648579/1547711353840738425/image.png?ex=6aa46a05&is=6aa31885&hm=add46c54857977892ae15441df5b3e5ac8423cbc068029e98d4b4fdca43cabb4&=&format=webp&quality=lossless&width=1479&height=832';

function ticketsCategoriaId() {
  return process.env.TICKETS_CATEGORIA_ID || TICKETS_CATEGORIA_ID_PADRAO;
}

function ticketsCargoStaffId() {
  return process.env.TICKETS_CARGO_STAFF_ID || TICKETS_CARGO_STAFF_ID_PADRAO;
}

function ticketsBannerUrl() {
  return process.env.TICKETS_BANNER_URL || TICKETS_BANNER_URL_PADRAO;
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
    ],
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
  { nome: '2x impulsos', preco: eur(1.2), categoria: 'Impulsos' },
  { nome: '6x impulsos', preco: eur(3), categoria: 'Impulsos' },
  { nome: '8x impulsos', preco: eur(5), categoria: 'Impulsos' },
  { nome: '14x impulsos', preco: eur(8), categoria: 'Impulsos' },
  { nome: '14x impulsos trimensais', preco: eur(10), categoria: 'Impulsos' },

  // --- Canal de nitradas ---
  { nome: 'Nitrada Mensal', preco: eur(2.55), categoria: 'Nitradas' },
  { nome: 'Nitrada Trimensal', preco: eur(6.99), categoria: 'Nitradas' },
  { nome: 'Nitrada Anual', preco: eur(7.99), categoria: 'Nitradas' },

  // --- Canal de links ---
  { nome: 'Nitro Link Mensal', preco: eur(0.8), categoria: 'Links' },
  { nome: 'Nitro Link Trimensal', preco: eur(2), categoria: 'Links' },
  { nome: 'Ativação do Nitro', preco: eur(1), categoria: 'Links' },

  // --- Canal de trial ---
  { nome: 'Trial Nitro', preco: eur(0.8), categoria: 'trial' },

  // --- Canal virgem ---
  { nome: 'Conta Virgem', preco: eur(0.55), categoria: 'virgem' },

  // --- Canal aged ---
  { nome: 'Conta 2016', preco: eur(12), categoria: 'aged' },
  { nome: 'Conta 2017', preco: eur(7), categoria: 'aged' },
  { nome: 'Conta 2018', preco: eur(5), categoria: 'aged' },
  { nome: 'Conta 2019', preco: eur(4), categoria: 'aged' },
  { nome: 'Conta 2020', preco: eur(3), categoria: 'aged' },
  { nome: 'Conta 2021', preco: eur(2.5), categoria: 'aged' },
  { nome: 'Conta 2022', preco: eur(2), categoria: 'aged' },

  // --- Canal Spotify + Canal link Spotify Tri (mesma categoria "spotify") ---
  { nome: 'Conta Spotify Premium', preco: eur(1.3), categoria: 'spotify' },
  { nome: 'Link Spotify Trimensal', preco: eur(0.5), categoria: 'spotify' },

  // --- Canal membros ---
  { nome: '100x membros online', preco: eur(1.5), categoria: 'membros' },
  { nome: '100x membros offline', preco: eur(1), categoria: 'membros' },

  // --- Canal trampo ---
  { nome: 'Trampo fazendo dinheiro', preco: eur(1.2), categoria: 'trampo' },

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
];

// Cria os produtos de PRODUTOS_SEED que ainda não existem (por nome).
// Corre sempre que o bot liga, mas nunca duplica os que já foram criados.
function seedProdutosIniciais() {
  const existentes = new Set(
    db.listActiveProducts().map((p) => p.name.toLowerCase())
  );

  let criados = 0;
  for (const p of PRODUTOS_SEED) {
    if (existentes.has(p.nome.toLowerCase())) continue;

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
  }

  if (criados > 0) {
    console.log(`🌱 ${criados} produto(s) novo(s) criado(s). Falta carregar chaves com /chave-adicionar.`);
  } else {
    console.log('🌱 Produtos iniciais já existiam, nada foi criado.');
  }
}

// Categoria fixa de cada comando /loja-XXX — não precisas de escrever nada,
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

  if (process.env.GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(clientId, process.env.GUILD_ID),
      { body: slashCommands }
    );
    console.log(
      `✅ ${slashCommands.length} comandos registados no servidor ${process.env.GUILD_ID}.`
    );
  } else {
    await rest.put(Routes.applicationCommands(clientId), { body: slashCommands });
    console.log(
      `✅ ${slashCommands.length} comandos registados globalmente (pode demorar até 1h a aparecer).`
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function logToChannel(text) {
  if (!process.env.LOG_CHANNEL_ID) return;
  try {
    const channel = await client.channels.fetch(process.env.LOG_CHANNEL_ID);
    if (channel?.isTextBased()) await channel.send(text);
  } catch (err) {
    console.error('Falha ao escrever no canal de logs:', err.message);
  }
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

// Constrói o menu de seleção com os produtos da categoria — mostra o preço e o
// stock em cada opção (mesmo quando esgotado), tal como no exemplo que mandaste.
function buildSelectRow(products) {
  const options = products.slice(0, 25).map((p) => {
    const stock = db.countAvailableKeys(p.id);
    return {
      label: p.name,
      description: `Valor: ${formatPrice(p.price_cents, p.currency)} · 📦 Estoque: ${
        stock === 0 ? 'Esgotado' : stock
      }`,
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
    'Painéis e métodos digitais prontos pra usar',
    'SMS, Ifood, internet e outros métodos',
    'Entrega automática no privado',
    'Qualidade testada antes da venda',
  ]),
  Impulsos: textoPainel('Impulsos', [
    'Impulso para o teu servidor Discord',
    'Ativação rápida, entrega automática',
    'Packs de 2x, 6x, 8x e 14x',
    'Sem partilhar a tua conta',
  ]),
  Nitradas: textoPainel('Nitradas', [
    'Conta Full Acesso, Muda Email, Senha Etc...',
    'Contas com Nitro Gaming',
    'Contas Nitradas Possui Nitro.',
    'Nitradas Na Melhor Qualidade.',
  ]),
  Links: textoPainel('Nitro Links', [
    'Nitro Link Mensal e Trimensal',
    'Ativação do Nitro incluída',
    'Entrega automática no privado',
    'Só clicar em resgatar',
  ]),
  trial: textoPainel('Trial Nitro', [
    'Trial Nitro pra testar a conta',
    'Entrega automática no privado',
    'Ativação simples, só resgatar',
    'Ideal pra quem quer testar',
  ]),
  virgem: textoPainel('Conta Virgem', [
    'Contas virgens, nunca usadas',
    'Sem histórico de Nitro ou tickets',
    'Full acesso, muda e-mail e senha',
    'Entrega automática no privado',
  ]),
  aged: textoPainel('Contas Aged', [
    'Contas antigas (2016 a 2022)',
    'Mais confiança e histórico',
    'Full acesso, muda e-mail e senha',
    'Entrega automática no privado',
  ]),
  spotify: textoPainel('Spotify', [
    'Spotify Premium na tua conta',
    'Conta completa ou link trimensal',
    'Entrega automática no privado',
    'Ativação rápida',
  ]),
  membros: textoPainel('Membros', [
    'Membros para o teu servidor',
    'Packs de 100 online ou 100 offline',
    'Entrega automática',
    'Ideal pra começar o servidor',
  ]),
  trampo: textoPainel('Trampo', [
    'Trampo fazendo dinheiro',
    'Entrega automática no privado',
    'Pronto pra começar',
    'Suporte após a compra',
  ]),
  cloner: textoPainel(
    'Clonar Site',
    [
      'Clonagem de site sob pedido',
      'Layout igual ao original',
      'Entrega combinada no ticket',
      'Suporte até validar',
    ],
    { entrega: '🎫 Entrega via ticket' }
  ),
  roblox: textoPainel('ROBLOX ACC\'S', [
    'Contas Roblox full access',
    'Valor = Robux do inventário',
    'ALL FULL ACCESS',
    'Entrega automática no privado',
  ]),
  fortnite: textoPainel('FORTNITE ACC\'S', [
    '💥 100–150 Skins — OG + rare mix (Black Knight, Minty Axe) e emotes (Take the L)',
    '✨ 150–250 Skins — coleção maior de OG & rare, emotes e itens raros',
    '🔥 100–250 Tryhard — skins sweaty/populares, 50+ do Item Shop',
    '✨ 250–400 Skins — biblioteca grande com lendários e ultra-rares',
    'ᴀʟʟ ꜰᴜʟʟ ᴀᴄᴄᴇꜱꜱ',
  ]),
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
    bulletsLinhas: bulletsTexto.split('\n').filter(Boolean),
    entregaFinal,
    imagemFinal,
    corFinal,
    faixa,
    botaoEmojiFinal,
    botaoTextoFinal,
  };
}

// Cartão V2 igual à print: banner no topo, texto, caixa verde, rodapé + botão
// à direita (ou menu em baixo, no caso dos tickets).
function montarPainelV2({ imagemUrl, accentColor, texto, rodape, accessory, extraRows = [] }) {
  const container = new ContainerBuilder().setAccentColor(accentColor ?? 0x2b2d31);

  if (imagemUrl && /^https?:\/\//i.test(imagemUrl)) {
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

// Publica o painel de uma categoria (chamado tanto por /loja categoria:"..."
// como pelos comandos fixos /loja-trial, /loja-spotify, etc.)
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
    .map((cmd) => `\`!${cmd}\` / \`/${cmd}\``)
    .join('\n');

  return (
    '## Comandos do bot\n' +
    '**Loja**\n' +
    '`!loja` / `/loja` — publica todos os painéis (ou uma categoria)\n' +
    `${paineis}\n\n` +
    '**Tickets**\n' +
    '`!tickets` / `/tickets` — publica o painel de tickets\n' +
    '`!fechar` / `!close` / `/fechar` — fecha o ticket deste canal\n' +
    'Dentro do ticket: Adicionar Membro · Criar Call · Pedir Gank · Renomear · Fechar\n\n' +
    '**Geral**\n' +
    '`!comandos` / `/comandos` — esta lista\n' +
    '`/verificacao` — painel de verificação\n\n' +
    '**Admin**\n' +
    '`/produtos` · `/chave-adicionar` · `/entregar`'
  );
}

function ehCanalTicket(canal) {
  if (!canal) return false;
  return canal.parentId === ticketsCategoriaId() || /^(suporte|receber-produto|duvidas)-/i.test(canal.name);
}

function podeGerirTicket(membro, canal) {
  if (!membro) return false;
  if (membro.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  const staffId = ticketsCargoStaffId();
  if (staffId && membro.roles?.cache?.has(staffId)) return true;
  const overwrite = canal?.permissionOverwrites?.cache?.get(membro.id);
  if (overwrite?.allow?.has(PermissionFlagsBits.ViewChannel)) return true;
  return false;
}

async function fecharTicket(canal, autorTag) {
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

async function criarTicket(interaction, tipoKey) {
  const tipo = TIPOS_TICKET[tipoKey];
  if (!tipo) return;

  const categoriaId = ticketsCategoriaId();
  const staffRoleId = ticketsCargoStaffId();

  const overwrites = [
    { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: interaction.user.id,
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
  if (staffRoleId) {
    overwrites.push({
      id: staffRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }

  let canal;
  try {
    canal = await interaction.guild.channels.create({
      name: `${tipoKey}-${gerarSufixoTicket()}`,
      type: ChannelType.GuildText,
      parent: categoriaId || undefined,
      permissionOverwrites: overwrites,
    });
  } catch (err) {
    console.error('Falha ao criar canal de ticket:', err.message);
    return interaction.reply({
      content:
        'Não consegui criar o canal do ticket. Confirma que o bot tem a permissão **Gerir Canais** ' +
        'e que a categoria de tickets existe.',
      ephemeral: true,
    });
  }

  const painelTicket = montarPainelV2({
    imagemUrl: ticketsBannerUrl(),
    accentColor: 0x2b2d31,
    texto:
      `Olá <@${interaction.user.id}>! Ticket de **${tipo.label}** aberto — em breve alguém da equipa vai responder.` +
      (staffRoleId ? ` <@&${staffRoleId}>` : ''),
    extraRows: [buildBotoesTicket(canal.id)],
  });
  await canal.send({
    ...painelTicket.payload,
    allowedMentions: {
      users: [interaction.user.id],
      roles: staffRoleId ? [staffRoleId] : [],
    },
  });

  await interaction.reply({
    content: `✅ Ticket criado: <#${canal.id}>`,
    ephemeral: true,
  });
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
  const staffRoleId = ticketsCargoStaffId();
  await interaction.reply({
    content: staffRoleId
      ? `❗ <@&${staffRoleId}> — <@${interaction.user.id}> precisa de ajuda neste ticket!`
      : `❗ <@${interaction.user.id}> pediu ajuda neste ticket!`,
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
  await fecharTicket(canal, `<@${interaction.user.id}>`);
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

  const stock = db.countAvailableKeys(product.id);
  if (stock <= 0) {
    return interaction.reply({ content: 'Este produto está esgotado no momento.', ephemeral: true });
  }

  const orderId = db.createOrder({ productId: product.id, discordUserId: interaction.user.id });

  const instrucoes =
    process.env.PAYMENT_INFO ||
    'Contacta um administrador para efetuares o pagamento. Assim que for confirmado, recebes a tua chave por DM.';

  await interaction.reply({
    content:
      `🧾 Pedido **#${orderId}** criado — **${product.name}** por ${formatPrice(
        product.price_cents,
        product.currency
      )}.\n\n` +
      `**Como pagar:** ${instrucoes}\n\n` +
      `Assim que um admin confirmar o pagamento, a tua chave chega por DM. 📩`,
    ephemeral: true,
  });

  await notificarPedidoAdmins(interaction, orderId, product);
}

// Publica o pedido no canal de admins (PEDIDOS_CHANNEL_ID ou LOG_CHANNEL_ID)
// com os botões "Entregar chave" e "Cancelar".
async function notificarPedidoAdmins(interaction, orderId, product) {
  const channelId = process.env.PEDIDOS_CHANNEL_ID || process.env.LOG_CHANNEL_ID;
  if (!channelId) return;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setTitle(`🛒 Novo pedido #${orderId}`)
      .setColor(0xfaa61a)
      .addFields(
        {
          name: 'Produto',
          value: `${product.name} — ${formatPrice(product.price_cents, product.currency)}`,
        },
        { name: 'Cliente', value: `<@${interaction.user.id}>` },
        { name: 'Estado', value: 'Aguarda confirmação de pagamento' }
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Entregar chave')
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
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: 'Só administradores podem entregar pedidos.',
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

  await entregarPedido(orderId);
  const entregue = db.getOrder(orderId).status === 'delivered';

  await interaction.reply({
    content: entregue
      ? `✅ Pedido #${orderId} entregue. A chave foi enviada por DM ao cliente.`
      : `⚠️ Pedido #${orderId}: não há chaves em stock. Usa \`/chave-adicionar\` e tenta de novo.`,
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
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: 'Só administradores podem cancelar pedidos.',
      ephemeral: true,
    });
  }
  db.markOrderStatus(orderId, 'expired');
  await interaction.reply({ content: `Pedido #${orderId} cancelado.`, ephemeral: true });
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

async function entregarPedido(orderId) {
  const order = db.getOrder(orderId);
  if (!order || order.status === 'delivered') return; // já entregue, evita duplicar

  const product = db.getProduct(order.product_id);
  const keyId = db.allocateKeyTxn(order.product_id, order.discord_user_id);

  if (!keyId) {
    db.markOrderStatus(order.id, 'paid'); // pago mas sem stock -> tratar manualmente
    await logToChannel(
      `⚠️ Pedido #${order.id} (${product?.name}) foi pago mas **não há chaves em stock**. Entrega manual necessária para <@${order.discord_user_id}>.`
    );
    return;
  }

  const keyValue = db.getKeyValue(keyId);
  db.markOrderDelivered(order.id, keyId);

  try {
    const user = await client.users.fetch(order.discord_user_id);
    await user.send(
      `✅ Pagamento confirmado! Aqui está a tua chave de **${product.name}**:\n\`\`\`${keyValue}\`\`\`\nObrigado pela compra!`
    );
  } catch (err) {
    await logToChannel(
      `⚠️ Pedido #${order.id}: pagamento confirmado mas não consegui enviar DM a <@${order.discord_user_id}> (tem as DMs fechadas?). Chave: \`${keyValue}\``
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
    `💰 Venda concluída: **${product.name}** para <@${order.discord_user_id}> (pedido #${order.id}).`
  );
}

// ---------------------------------------------------------------------------
// Verificação: publica um painel com botão que dá um cargo de acesso.
// ---------------------------------------------------------------------------

async function publicarVerificacao(interaction) {
  const cargo = interaction.options.getRole('cargo');
  // Ordem: opção do comando > variável VERIFY_ROLE_ID > cargo por defeito.
  const roleId = cargo?.id || process.env.VERIFY_ROLE_ID || '1547037277132292146';
  if (!roleId) {
    return interaction.reply({
      content:
        'Falta o cargo de verificação. Escolhe-o na opção `cargo` do comando, ' +
        'ou define a variável `VERIFY_ROLE_ID` com o ID do cargo.',
      ephemeral: true,
    });
  }

  // Banner por defeito (troca com a opção anexo/imagem ou a variável VERIFY_BANNER_URL).
  // Atenção: links do Discord (com ?ex=) expiram; para permanente usa a opção `anexo`.
  const bannerDefeito =
    process.env.VERIFY_BANNER_URL ||
    'https://media.discordapp.net/attachments/1545383446208315422/1545780693550891009/banner.png?ex=6aa15874&is=6aa006f4&hm=56751429c4ad74e1edd9ded35491d91681dfed9e4c5e8c0bac13f9039c16369b&=&format=webp&quality=lossless&width=1521&height=856';
  const anexo = interaction.options.getAttachment('anexo');
  const imagem = anexo?.url || interaction.options.getString('imagem') || bannerDefeito;
  const titulo = interaction.options.getString('titulo') || 'VERIFICAÇÃO';
  const bullets =
    interaction.options.getString('descricao') ||
    '• Clique no botão para se verificar\n' +
      '• Libera o acesso aos canais do servidor\n' +
      '• Verificação imediata, só um clique';

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

  try {
    await enviarPainel(interaction.channel, painel);
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

async function verificarMembro(interaction, roleId) {
  const member = interaction.member;
  if (member?.roles?.cache?.has(roleId)) {
    return interaction.reply({ content: '✅ Já estás verificado!', ephemeral: true });
  }
  try {
    await member.roles.add(roleId);
    await interaction.reply({
      content: '✅ Verificado! Já tens acesso ao servidor.',
      ephemeral: true,
    });
  } catch (err) {
    console.error('Falha ao verificar membro:', err.message);
    await interaction.reply({
      content:
        'Não consegui dar-te o cargo. Um admin precisa de dar ao bot a permissão **Gerir Cargos** ' +
        'e de colocar o cargo do bot **acima** do cargo de verificação.',
      ephemeral: true,
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
          content: `Produto criado! **${nome}** (ID: ${id}). Agora usa \`/chave-adicionar produto_id:${id}\` para carregares as chaves.`,
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
          `Foram adicionadas **${added}** chaves ao produto **${product.name}**. Stock atual: ${db.countAvailableKeys(
            productId
          )}.`
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
            } — stock: ${db.countAvailableKeys(p.id)}`
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
      await verificarMembro(interaction, roleId);
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

async function aoMensagem(message) {
  try {
    if (message.author.bot) return;
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
      await fecharTicket(message.channel, `<@${message.author.id}>`);
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
      try {
        await message.delete();
      } catch {
        /* sem permissão para apagar — não é grave */
      }
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
};
