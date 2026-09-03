// index.js
// Corre o bot com: npm install   (uma vez)   e depois   npm start

require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} = require('discord.js');

const db = require('./db');

const PREFIX = process.env.PREFIX || '!';
// Texto mostrado ao comprador com os dados para onde deve enviar o pagamento.
// Define isto no .env, ex: PAYMENT_INSTRUCTIONS="MB WAY 912345678 ou IBAN PT50..."
const PAYMENT_INSTRUCTIONS =
  process.env.PAYMENT_INSTRUCTIONS || 'Contacta um membro da staff para combinares o pagamento.';

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

async function logToChannel(payload) {
  if (!process.env.LOG_CHANNEL_ID) return null;
  try {
    const channel = await client.channels.fetch(process.env.LOG_CHANNEL_ID);
    if (channel?.isTextBased()) return channel.send(payload);
  } catch (err) {
    console.error('Falha ao escrever no canal de logs:', err.message);
  }
  return null;
}

function isAdmin(memberOrMessage) {
  const member = memberOrMessage.member ?? memberOrMessage;
  return member?.permissions?.has(PermissionFlagsBits.Administrator);
}

// Faz parsing de argumentos respeitando texto entre aspas: !cmd "texto com espaços" 10 @cargo
function parseArgs(content) {
  const matches = [...content.matchAll(/"([^"]+)"|(\S+)/g)];
  return matches.map((m) => m[1] ?? m[2]);
}

function buildLojaEmbedAndRow(products) {
  const embed = new EmbedBuilder()
    .setTitle('🎮 Loja de Jogos')
    .setColor(0x5865f2)
    .setDescription(
      products.length
        ? 'Escolhe um jogo abaixo para comprar. Depois de pedires, a staff confirma o pagamento e a chave chega automaticamente por DM.'
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
// Pedido: cria o pedido pendente e avisa a staff para confirmar manualmente
// ---------------------------------------------------------------------------

async function criarPedido(interaction, productId) {
  const product = db.getProduct(productId);
  if (!product || !product.active) {
    return interaction.reply({ content: 'Este produto já não está disponível.', ephemeral: true });
  }
  if (db.countAvailableKeys(product.id) <= 0) {
    return interaction.reply({ content: 'Este produto está esgotado no momento.', ephemeral: true });
  }

  const orderId = db.createOrder({
    productId: product.id,
    discordUserId: interaction.user.id,
    paymentMethod: 'manual',
  });

  await interaction.reply({
    content:
      `Pedido **#${orderId}** criado: **${product.name}** — ${formatPriceEUR(product.price_eur)}\n\n` +
      `${PAYMENT_INSTRUCTIONS}\n\n` +
      `Depois de pagares, aguarda que a staff confirme — a chave chega automaticamente aqui por DM.`,
    ephemeral: true,
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`confirmar_${orderId}`)
      .setLabel('Confirmar pagamento')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`cancelar_${orderId}`)
      .setLabel('Cancelar pedido')
      .setStyle(ButtonStyle.Danger)
  );

  const embed = new EmbedBuilder()
    .setTitle(`Novo pedido #${orderId}`)
    .setColor(0xf1c40f)
    .addFields(
      { name: 'Produto', value: product.name, inline: true },
      { name: 'Valor', value: formatPriceEUR(product.price_eur), inline: true },
      { name: 'Comprador', value: `<@${interaction.user.id}>`, inline: true }
    )
    .setDescription('Confirma aqui assim que receberes o pagamento.');

  await logToChannel({ embeds: [embed], components: [row] });
}

// ---------------------------------------------------------------------------
// Entrega: chamado quando um membro da staff confirma o pagamento
// ---------------------------------------------------------------------------

async function entregarPedido(orderId) {
  const order = db.getOrder(orderId);
  if (!order) return { ok: false, reason: 'Esse pedido não existe.' };
  if (order.status === 'delivered') return { ok: false, reason: 'Esse pedido já foi entregue.' };
  if (order.status === 'cancelado') return { ok: false, reason: 'Esse pedido foi cancelado.' };

  const product = db.getProduct(order.product_id);
  const keyId = db.allocateKeyTxn(order.product_id, order.discord_user_id);

  if (!keyId) {
    db.markOrderStatus(order.id, 'paid');
    await logToChannel(
      `⚠️ Pedido #${order.id} (${product?.name}) foi confirmado mas **não há chaves em stock**. Entrega manual necessária para <@${order.discord_user_id}>.`
    );
    return { ok: false, reason: 'Sem chaves em stock — avisei o canal de logs para entrega manual.' };
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

  return { ok: true };
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

    // Alternativa em texto ao botão "Confirmar pagamento", útil se o pedido já rolou no canal
    if (command === 'confirmar') {
      if (!isAdmin(message)) return message.reply('Só administradores podem usar este comando.');
      const orderId = Number(args[0]);
      if (!orderId) return message.reply(`Uso: \`${PREFIX}confirmar <id_do_pedido>\``);
      const result = await entregarPedido(orderId);
      return message.reply(result.ok ? `Pedido #${orderId} confirmado e entregue.` : result.reason);
    }
  } catch (err) {
    console.error(err);
    message.reply('Ocorreu um erro ao processar esse comando.');
  }
});

// Menu de seleção da loja + botões de confirmar/cancelar pedido
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isStringSelectMenu() && interaction.customId === 'comprar_select') {
      const productId = Number(interaction.values[0]);
      await criarPedido(interaction, productId);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('confirmar_')) {
      if (!isAdmin(interaction.member)) {
        return interaction.reply({ content: 'Só a staff pode confirmar pagamentos.', ephemeral: true });
      }
      const orderId = Number(interaction.customId.replace('confirmar_', ''));
      const result = await entregarPedido(orderId);
      if (result.ok) {
        await interaction.update({
          content: `✅ Pedido #${orderId} confirmado por <@${interaction.user.id}> e entregue.`,
          embeds: [],
          components: [],
        });
      } else {
        await interaction.reply({ content: result.reason, ephemeral: true });
      }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('cancelar_')) {
      if (!isAdmin(interaction.member)) {
        return interaction.reply({ content: 'Só a staff pode cancelar pedidos.', ephemeral: true });
      }
      const orderId = Number(interaction.customId.replace('cancelar_', ''));
      db.markOrderStatus(orderId, 'cancelado');
      await interaction.update({
        content: `❌ Pedido #${orderId} cancelado por <@${interaction.user.id}>.`,
        embeds: [],
        components: [],
      });
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
