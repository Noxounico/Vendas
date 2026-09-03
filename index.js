// index.js
// Corre o bot com: npm install   (uma vez)   e depois   npm start

require('dotenv').config();
const express = require('express');
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
} = require('discord.js');

const db = require('./db');

const PREFIX = process.env.PREFIX || '!';
const EUPAGO_BASE_URL =
  process.env.EUPAGO_BASE_URL || 'https://clientes.eupago.pt/clientes/rest_api';
const EUPAGO_API_KEY = process.env.EUPAGO_API_KEY;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // necessário para ler comandos com "!"
  ],
  partials: [Partials.Channel],
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPriceEUR(value) {
  return `${Number(value).toFixed(2)} €`;
}

async function logToChannel(text) {
  if (!process.env.LOG_CHANNEL_ID) return;
  try {
    const channel = await client.channels.fetch(process.env.LOG_CHANNEL_ID);
    if (channel?.isTextBased()) await channel.send(text);
  } catch (err) {
    console.error('Falha ao escrever no canal de logs:', err.message);
  }
}

function isAdmin(message) {
  return message.member?.permissions.has(PermissionFlagsBits.Administrator);
}

// Faz parsing de argumentos respeitando texto entre aspas: !cmd "texto com espaços" 10 @cargo
function parseArgs(content) {
  const matches = [...content.matchAll(/"([^"]+)"|(\S+)/g)];
  return matches.map((m) => m[1] ?? m[2]);
}

// Chamada genérica à API REST do Eupago (body em application/x-www-form-urlencoded)
async function eupagoRequest(endpoint, params) {
  const body = new URLSearchParams({ chave: EUPAGO_API_KEY, ...params });
  const res = await fetch(`${EUPAGO_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return res.json();
}

function buildLojaEmbedAndRow(products) {
  const embed = new EmbedBuilder()
    .setTitle('🎮 Loja de Jogos')
    .setColor(0x5865f2)
    .setDescription(
      products.length
        ? 'Escolhe um jogo abaixo para comprar. A chave é entregue automaticamente por DM após o pagamento (MB Way ou Multibanco).'
        : 'Não há produtos disponíveis de momento.'
    );

  for (const p of products) {
    const stock = db.countAvailableKeys(p.id);
    embed.addFields({
      name: `${p.name} — ${formatPriceEUR(p.price_eur)}`,
      value: `${p.description || 'Sem descrição.'}\nStock: **${stock}** ${
        stock === 0 ? '(esgotado)' : ''
      }`,
    });
  }

  const options = products
    .filter((p) => db.countAvailableKeys(p.id) > 0)
    .slice(0, 25)
    .map((p) => ({
      label: `${p.name} — ${formatPriceEUR(p.price_eur)}`,
      value: String(p.id),
    }));

  const rows = [];
  if (options.length > 0) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('comprar_select')
          .setPlaceholder('Seleciona o jogo que queres comprar')
          .addOptions(options)
      )
    );
  }

  return { embed, rows };
}

// ---------------------------------------------------------------------------
// Passo 1: depois de escolher o jogo, escolher o método de pagamento
// ---------------------------------------------------------------------------

async function mostrarEscolhaPagamento(interaction, productId) {
  const product = db.getProduct(productId);
  if (!product || !product.active) {
    return interaction.reply({ content: 'Este produto já não está disponível.', ephemeral: true });
  }
  if (db.countAvailableKeys(product.id) <= 0) {
    return interaction.reply({ content: 'Este produto está esgotado no momento.', ephemeral: true });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pay_mbway_${product.id}`)
      .setLabel('Pagar com MB WAY')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`pay_mb_${product.id}`)
      .setLabel('Pagar com Multibanco')
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.reply({
    content: `**${product.name}** — ${formatPriceEUR(product.price_eur)}\nComo queres pagar?`,
    components: [row],
    ephemeral: true,
  });
}

// ---------------------------------------------------------------------------
// MB WAY: pede o número de telemóvel via modal e envia o pedido de pagamento
// ---------------------------------------------------------------------------

async function abrirModalMBWay(interaction, productId) {
  const modal = new ModalBuilder()
    .setCustomId(`mbway_modal_${productId}`)
    .setTitle('Pagamento MB WAY');

  const phoneInput = new TextInputBuilder()
    .setCustomId('telefone')
    .setLabel('O teu número de telemóvel (9 dígitos)')
    .setPlaceholder('912345678')
    .setStyle(TextInputStyle.Short)
    .setMinLength(9)
    .setMaxLength(9)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(phoneInput));
  await interaction.showModal(modal);
}

async function processarPagamentoMBWay(interaction, productId, telefone) {
  const product = db.getProduct(productId);
  if (!product || db.countAvailableKeys(product.id) <= 0) {
    return interaction.reply({ content: 'Este produto já não está disponível.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const orderId = db.createOrder({
    productId: product.id,
    discordUserId: interaction.user.id,
    paymentMethod: 'mbway',
    externalRef: telefone,
  });

  const resp = await eupagoRequest('/mbway/create', {
    valor: Number(product.price_eur).toFixed(2),
    id: String(orderId),
    alias: telefone,
    descricao: product.name,
  });

  if (!resp || resp.sucesso === false || resp.estado === 'erro') {
    console.error('Erro Eupago MB WAY:', resp);
    return interaction.editReply(
      'Não consegui criar o pedido MB WAY. Confirma o número de telemóvel e tenta novamente.'
    );
  }

  await interaction.editReply(
    `📱 Foi enviado um pedido de pagamento para o teu MB WAY (**${telefone}**), no valor de **${formatPriceEUR(
      product.price_eur
    )}**.\nAbre a app MB WAY e aceita o pagamento. A chave chega automaticamente aqui por DM assim que for confirmado.`
  );
}

// ---------------------------------------------------------------------------
// Multibanco: gera entidade + referência na hora
// ---------------------------------------------------------------------------

async function processarPagamentoMultibanco(interaction, productId) {
  const product = db.getProduct(productId);
  if (!product || db.countAvailableKeys(product.id) <= 0) {
    return interaction.reply({ content: 'Este produto já não está disponível.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const orderId = db.createOrder({
    productId: product.id,
    discordUserId: interaction.user.id,
    paymentMethod: 'multibanco',
  });

  const resp = await eupagoRequest('/multibanco/create', {
    valor: Number(product.price_eur).toFixed(2),
    id: String(orderId),
  });

  if (!resp || !resp.referencia) {
    console.error('Erro Eupago Multibanco:', resp);
    return interaction.editReply('Não consegui gerar a referência Multibanco. Tenta novamente.');
  }

  const embed = new EmbedBuilder()
    .setTitle(`Pagamento Multibanco — ${product.name}`)
    .setColor(0x2ecc71)
    .addFields(
      { name: 'Entidade', value: String(resp.entidade || '—'), inline: true },
      { name: 'Referência', value: String(resp.referencia), inline: true },
      { name: 'Valor', value: formatPriceEUR(product.price_eur), inline: true }
    )
    .setDescription(
      'Paga num Multibanco (ATM) ou no homebanking com estes dados. A chave chega automaticamente aqui por DM assim que o pagamento for confirmado.'
    );

  await interaction.editReply({ embeds: [embed] });
}

// ---------------------------------------------------------------------------
// Entrega: chamado quando o Eupago confirma o pagamento (webhook)
// ---------------------------------------------------------------------------

async function entregarPedido(orderId) {
  const order = db.getOrder(orderId);
  if (!order || order.status === 'delivered') return; // já entregue, evita duplicar

  const product = db.getProduct(order.product_id);
  const keyId = db.allocateKeyTxn(order.product_id, order.discord_user_id);

  if (!keyId) {
    db.markOrderStatus(order.id, 'paid');
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
    `💰 Venda concluída (${order.payment_method}): **${product.name}** para <@${order.discord_user_id}> (pedido #${order.id}).`
  );
}

// ---------------------------------------------------------------------------
// Comandos com prefixo "!"
// ---------------------------------------------------------------------------

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = parseArgs(message.content.slice(PREFIX.length).trim());
  const command = args.shift()?.toLowerCase();

  try {
    if (command === 'produto-criar') {
      if (!isAdmin(message)) return message.reply('Só administradores podem usar este comando.');
      const [nome, precoStr, descricao] = args;
      const preco = Number(precoStr);
      if (!nome || !precoStr || Number.isNaN(preco)) {
        return message.reply(
          `Uso: \`${PREFIX}produto-criar "Nome do Jogo" 19.99 "Descrição opcional" @Cargo(opcional)\``
        );
      }
      const cargoId = message.mentions.roles.first()?.id;
      const id = db.addProduct({ name: nome, description: descricao || '', priceEur: preco, roleId: cargoId });
      return message.reply(
        `Produto criado! **${nome}** (ID: ${id}). Agora usa \`${PREFIX}chave-adicionar ${id}\` (anexando um .txt) para carregares as chaves.`
      );
    }

    if (command === 'chave-adicionar') {
      if (!isAdmin(message)) return message.reply('Só administradores podem usar este comando.');
      const [produtoIdStr] = args;
      const productId = Number(produtoIdStr);
      const attachment = message.attachments.first();
      if (!productId || !attachment) {
        return message.reply(
          `Uso: \`${PREFIX}chave-adicionar <id_do_produto>\` e anexa um ficheiro .txt com uma chave por linha.`
        );
      }
      const product = db.getProduct(productId);
      if (!product) return message.reply('Não existe nenhum produto com esse ID.');

      const res = await fetch(attachment.url);
      const text = await res.text();
      const added = db.addKeysBulk(productId, text.split('\n'));
      return message.reply(
        `Foram adicionadas **${added}** chaves ao produto **${product.name}**. Stock atual: ${db.countAvailableKeys(
          productId
        )}.`
      );
    }

    if (command === 'produtos') {
      if (!isAdmin(message)) return message.reply('Só administradores podem usar este comando.');
      const products = db.listActiveProducts();
      if (products.length === 0) return message.reply('Ainda não há produtos criados.');
      const linhas = products.map(
        (p) => `**#${p.id} ${p.name}** — ${formatPriceEUR(p.price_eur)} — stock: ${db.countAvailableKeys(p.id)}`
      );
      return message.reply(linhas.join('\n'));
    }

    if (command === 'loja') {
      if (!isAdmin(message)) return message.reply('Só administradores podem usar este comando.');
      const products = db.listActiveProducts();
      const { embed, rows } = buildLojaEmbedAndRow(products);
      return message.channel.send({ embeds: [embed], components: rows });
    }
  } catch (err) {
    console.error(err);
    message.reply('Ocorreu um erro ao processar esse comando.');
  }
});

// Botões, menu de seleção e modal da compra
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isStringSelectMenu() && interaction.customId === 'comprar_select') {
      const productId = Number(interaction.values[0]);
      await mostrarEscolhaPagamento(interaction, productId);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('pay_mbway_')) {
      const productId = Number(interaction.customId.replace('pay_mbway_', ''));
      await abrirModalMBWay(interaction, productId);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('pay_mb_')) {
      const productId = Number(interaction.customId.replace('pay_mb_', ''));
      await processarPagamentoMultibanco(interaction, productId);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('mbway_modal_')) {
      const productId = Number(interaction.customId.replace('mbway_modal_', ''));
      const telefone = interaction.fields.getTextInputValue('telefone').trim();
      if (!/^\d{9}$/.test(telefone)) {
        return interaction.reply({ content: 'Número inválido — usa 9 dígitos (ex: 912345678).', ephemeral: true });
      }
      await processarPagamentoMBWay(interaction, productId, telefone);
      return;
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

client.once('ready', () => {
  console.log(`Bot ligado como ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);

// ---------------------------------------------------------------------------
// Servidor HTTP — recebe a confirmação automática do Eupago
// ---------------------------------------------------------------------------
// Configura este URL (ex: https://o-teu-servidor.com/webhook/eupago) como
// "URL de notificação" na área de cliente do Eupago (Definições do canal).

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.post('/webhook/eupago', async (req, res) => {
  try {
    const body = req.body || {};

    // Segurança básica: confirma que quem chamou conhece a nossa chave API.
    if (!body.chave || body.chave !== EUPAGO_API_KEY) {
      console.warn('Webhook Eupago recebido com chave inválida, a ignorar.');
      return res.sendStatus(200);
    }

    const orderId = Number(body.identificador || body.id);
    if (orderId) {
      await entregarPedido(orderId);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Erro no webhook do Eupago:', err.message);
    res.sendStatus(200); // responde sempre 200 para não ficar a reenviar em loop
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor do webhook a correr na porta ${port}`);
});
