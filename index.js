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
} = require('discord.js');
// Precisas de instalar isto: npm install @napi-rs/canvas
// (escolhido em vez do pacote "canvas" porque já vem com binários prontos,
// sem precisar de instalar Cairo/Pango no servidor.)
const { createCanvas, loadImage } = require('@napi-rs/canvas');

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
  'https://media.discordapp.net/attachments/1545383446208315422/1545780646473891962/banner-loja.jpg?ex=6aa2a9e9&is=6aa15869&hm=404cc600d7d05b1b6913c6f5570112197949aa98e2d14b023a24c6b2ccc76e1c&=&format=webp';

// "trial" -> "Trial", "link spotify tri" -> "Link Spotify Tri"
function capitalizar(str) {
  return str
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

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
  { nome: 'Nitrada Mensal', preco: eur(1), categoria: 'Nitradas' },
  { nome: 'Nitrada Trimensal', preco: eur(2.5), categoria: 'Nitradas' },
  { nome: 'Nitrada Anual', preco: eur(7), categoria: 'Nitradas' },

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

    console.log(`✅ produto criado #${id}: ${p.nome} — ${(p.preco / 100).toFixed(2)}€ [${p.categoria}]`);
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

// Devolve "de X€" ou "de X€ a Y€" com o intervalo de preços dos produtos.
function faixaPrecos(products) {
  if (products.length === 0) return null;
  const precos = products.map((p) => p.price_cents);
  const min = Math.min(...precos);
  const max = Math.max(...precos);
  const moeda = products[0].currency;
  return min === max
    ? formatPrice(min, moeda)
    : `de ${formatPrice(min, moeda)} a ${formatPrice(max, moeda)}`;
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

// Textos/estilo específicos por categoria — usados quando ninguém passa uma
// opção manual no comando. Acrescenta aqui outras categorias sempre que
// quiseres bullets/entrega/cor próprios para esse canal.
const PAINEL_TEXTOS = {
  Nitradas: {
    descricao:
      '• Conta Full Acesso, Muda Email, Senha Etc...\n' +
      '• Contas com Nitro Gaming\n' +
      '• Contas Nitradas Possui Nitro.\n' +
      '• Nitradas Na Melhor Qualidade.',
    entrega: '⚡ Entrega Automática!',
    cor: 0x8b1e1e,
  },
};

// Junta as opções passadas no comando com os defaults da categoria e os
// defaults genéricos — usado tanto pelo painel da loja como (parcialmente)
// pelo dos tickets.
function resolverTextosLoja(products, categoryName, opts = {}) {
  const { imagem, titulo, descricao, entrega, botaoEmoji, botaoTexto, cor } = opts;
  const defaults = PAINEL_TEXTOS[categoryName] || {};

  const tituloFinal = titulo || defaults.titulo || (categoryName ? capitalizar(categoryName) : 'Loja');
  const faixa = faixaPrecos(products);
  const imagemFinal = imagem || defaults.imagem || LOJA_BANNER_URL_PADRAO;
  const corFinal = corParaHex(cor) ?? defaults.cor ?? 0x9b59b6;
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

// Gera o painel (banner + título + bullets + caixa de entrega + preço) como
// UMA ÚNICA IMAGEM (banner sempre por cima, sem nenhum espaço, porque é tudo
// a mesma imagem) e devolve o botão "Comprar" para ir por baixo.
async function gerarPainelLoja(products, categoryName, opts = {}) {
  const t = resolverTextosLoja(products, categoryName, opts);

  const buffer = await gerarImagemPainel({
    imagemUrl: t.imagemFinal,
    titulo: t.tituloFinal,
    bullets: t.bulletsLinhas,
    entrega: t.entregaFinal,
    precoTexto: t.faixa || null,
    instrucao: t.faixa ? `Clique no botão "${t.botaoTextoFinal}" para escolheres o produto.` : 'Não há produtos disponíveis de momento.',
    cor: t.corFinal,
  });

  const rows = [];
  if (products.length > 0) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel(t.botaoTextoFinal)
          .setEmoji(t.botaoEmojiFinal)
          .setStyle(ButtonStyle.Secondary)
          .setCustomId(`abrir_${encodeURIComponent(categoryName || '')}`)
      )
    );
  }

  return { buffer, rows };
}

// Manda o painel: imagem única (ficheiro) + botão/menu por baixo.
async function enviarPainel(channel, painel) {
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

  const { buffer, rows } = await gerarPainelLoja(products, categoria, {
    imagem,
    titulo,
    descricao: descricaoOpt,
    entrega,
    botaoEmoji,
    botaoTexto,
    cor,
  });
  await enviarPainel(interaction.channel, { buffer, rows });
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

  const { buffer, rows } = await gerarPainelLoja(products, categoria, {});
  await enviarPainel(message.channel, { buffer, rows });
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
// Configuração por variáveis de ambiente (todas opcionais):
//   TICKETS_CATEGORIA_ID  -> categoria onde os canais de ticket são criados
//   TICKETS_CARGO_STAFF_ID -> cargo da staff (vê os tickets, é chamado no "Pedir Gank")
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

async function gerarPainelTickets(opts = {}) {
  const { imagem, titulo, descricao, cor } = opts;

  const bulletsTexto =
    descricao ||
    '• Após solicitar atendimento, aguarde até que um integrante da equipe responda à sua solicitação.\n' +
      '• O atendimento é realizado de forma privada; contudo, apenas membros autorizados da equipe terão acesso às informações compartilhadas.\n' +
      '• Ressaltamos que a nossa equipe não está disponível 24 horas por dia. Entretanto, dentro dos horários informados anteriormente, estaremos devidamente disponíveis para atendê-lo(a).';

  const buffer = await gerarImagemPainel({
    imagemUrl: imagem || LOJA_BANNER_URL_PADRAO,
    titulo: titulo || 'Central de Atendimento',
    bullets: bulletsTexto.split('\n').filter(Boolean),
    entrega: null,
    precoTexto: null,
    instrucao: null,
    cor: corParaHex(cor) ?? 0x9b1e2e,
  });

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

  return { buffer, rows: [new ActionRowBuilder().addComponents(select)] };
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
      .setCustomId(`ticket_rename_${channelId}`)
  );
}

async function criarTicket(interaction, tipoKey) {
  const tipo = TIPOS_TICKET[tipoKey];
  if (!tipo) return;

  const categoriaId = process.env.TICKETS_CATEGORIA_ID || null;
  const staffRoleId = process.env.TICKETS_CARGO_STAFF_ID || null;

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
        '(e que `TICKETS_CATEGORIA_ID`, se definido, é uma categoria válida).',
      ephemeral: true,
    });
  }

  await canal.send({
    content: `Olá <@${interaction.user.id}>! Ticket de **${tipo.label}** aberto — em breve alguém da equipa vai responder.${
      staffRoleId ? ` <@&${staffRoleId}>` : ''
    }`,
    components: [buildBotoesTicket(canal.id)],
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
  const staffRoleId = process.env.TICKETS_CARGO_STAFF_ID;
  await interaction.reply({
    content: staffRoleId
      ? `❗ <@&${staffRoleId}> — <@${interaction.user.id}> precisa de ajuda neste ticket!`
      : `❗ <@${interaction.user.id}> pediu ajuda neste ticket! (define \`TICKETS_CARGO_STAFF_ID\` no .env para chamar um cargo específico)`,
  });
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
  const descricao =
    interaction.options.getString('descricao') ||
    '• Clique no botão para se verificar\n' +
      '• Libera o acesso aos canais do servidor\n' +
      '• Verificação imediata, só um clique\n' +
      // Caixa verde "Verifique-se agora!" (bloco de código ANSI a verde).
      '```ansi\n\u001b[2;32mVerifique-se agora!\u001b[0m\n```';

  const embedTexto = new EmbedBuilder()
    .setTitle(titulo)
    .setColor(0xe02424)
    .setDescription(descricao)
    .addFields({ name: 'Acesso ao servidor', value: 'Clique no botão **Verificar**' });

  // Imagem POR CIMA: o setImage de um embed aparece em baixo, por isso a imagem
  // vai num embed próprio (só imagem), enviado antes do embed do texto.
  const embeds = [];
  if (imagem && /^https?:\/\//i.test(imagem)) {
    embeds.push(new EmbedBuilder().setColor(0xe02424).setImage(imagem));
  }
  embeds.push(embedTexto);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Verificar')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
      .setCustomId(`verificar_${roleId}`)
  );

  try {
    await interaction.channel.send({ embeds, components: [row] });
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

client.on('interactionCreate', async (interaction) => {
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

      if (commandName === 'verificacao') {
        await publicarVerificacao(interaction);
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
  } catch (err) {
    console.error(err);
    if (interaction.isRepliable()) {
      const msg = { content: 'Ocorreu um erro ao processar isso. Tenta novamente.', ephemeral: true };
      if (interaction.deferred || interaction.replied) await interaction.followUp(msg);
      else await interaction.reply(msg);
    }
  }
});

// ---------------------------------------------------------------------------
// Comandos de texto com "!" — alternativa aos slash commands.
// Ex.: escreve "!loja-trial", "!loja-spotify" ou "!loja spotify" num canal.
// Precisa da MESSAGE CONTENT INTENT ativada no Developer Portal do bot
// (Bot > Privileged Gateway Intents > Message Content Intent) — sem isso o
// bot não recebe o texto das mensagens e este bloco não faz nada.
// ---------------------------------------------------------------------------

client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIXO)) return;
    if (!message.member?.permissions?.has(PermissionFlagsBits.Administrator)) return;

    const [cmd, ...resto] = message.content.slice(PREFIXO.length).trim().split(/\s+/);
    const nomeComando = (cmd || '').toLowerCase();

    if (nomeComando === 'loja') {
      const categoria = resto.join(' ') || null;
      await publicarLojaTexto(message, categoria);
      return;
    }

    if (nomeComando === 'tickets') {
      const { buffer, rows } = await gerarPainelTickets({});
      await enviarPainel(message.channel, { buffer, rows });
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
});

client.once('ready', async () => {
  console.log(`Bot ligado como ${client.user.tag}`);
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
});

// Só liga o bot quando o ficheiro é corrido diretamente (npm start).
// Assim o módulo pode ser importado em testes sem tentar autenticar no Discord.
if (require.main === module) {
  client.login(process.env.DISCORD_TOKEN);
}

module.exports = { client, gerarPainelLoja, formatPrice, entregarPedido, seedProdutosIniciais };
