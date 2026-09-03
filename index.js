// index.js
// Corre o bot com: npm install   (uma vez)   e depois   npm start

require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} = require('discord.js');

const db = require('./db');

// Texto mostrado ao comprador com os dados para onde deve enviar o pagamento.
// Define isto no .env, ex: PAYMENT_INSTRUCTIONS="MB WAY 912345678 ou IBAN PT50..."
const PAYMENT_INSTRUCTIONS =
  process.env.PAYMENT_INSTRUCTIONS || 'Contacta um membro da staff para combinares o pagamento.';
// Banner opcional mostrado no topo do painel da loja. Define STORE_BANNER_URL no .env.
const STORE_BANNER_URL = process.env.STORE_BANNER_URL || null;
const STORE_NAME = process.env.STORE_NAME || 'Loja de Jogos';

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel],
});

// Mapeia orderId -> threadId enquanto o bot está a correr, só para conseguirmos
// avisar o "carrinho" do cliente quando a staff confirma/cancela.
const orderThreads = new Map();

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

async function avisarThread(orderId, payload) {
  const threadId = orderThreads.get(orderId);
  if (!threadId) return;
  try {
    const thread = await client.channels.fetch(threadId);
    if (thread?.isTextBased()) await thread.send(payload);
    if (thread?.setArchived) await thread.setArchived(true).catch(() => {});
  } catch (err) {
    console.error('Falha ao avisar o tópico do pedido:', err.message);
  }
}

function isAdmin(member) {
  return member?.permissions?.has(PermissionFlagsBits.Administrator);
}

// ---------------------------------------------------------------------------
// Painel principal da loja (embed + menu de seleção)
// ---------------------------------------------------------------------------

function buildLojaEmbedAndRow(products) {
  const embed = new EmbedBuilder()
    .setTitle('🛍️ Loja')
    .setColor(0x2b1a1a)
    .setDescription(
      products.length
        ? `Seja bem-vindo(a) à loja da **${STORE_NAME}**!\n\n` +
            '> Utilize o menu abaixo para escolher o produto desejado. A nossa equipa de staff irá confirmar o seu pagamento o mais rápido possível.\n\n' +
            '> Lembre-se de ter o pagamento pronto antes de finalizar o pedido.\n\n' +
            'Ao selecionar, um canal privado será criado para finalizares a compra.'
        : 'Não há produtos disponíveis de momento.'
    );

  if (STORE_BANNER_URL) embed.setImage(STORE_BANNER_URL);
  embed.setFooter({ text: `${STORE_NAME} ${new Date().getFullYear()} ©` });

  const options = products
    .filter((p) => db.countAvailableKeys(p.id) > 0)
    .slice(0, 25)
    .map((p) => ({
      label: `${p.name} — ${formatPriceEUR(p.price_eur)}`,
      description: (p.description || 'Comprar este jogo').slice(0, 100),
      value: String(p.id),
      emoji: '🎮',
    }));

  const rows = [];
  if (options.length > 0) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('comprar_select')
          .setPlaceholder('Selecione o produto que deseja comprar...')
          .addOptions(options)
      )
    );
  }

  return { embed, rows };
}

// ---------------------------------------------------------------------------
// Pedido: abre um tópico privado tipo "carrinho" com a revisão do pedido
// ---------------------------------------------------------------------------

async function criarPedido(interaction, productId) {
  const product = db.getProduct(productId);
  if (!product || !product.active) {
    return interaction.reply({ content: 'Este produto já não está disponível.', ephemeral: true });
  }
  if (db.countAvailableKeys(product.id) <= 0) {
    return interaction.reply({ content: 'Este produto está esgotado no momento.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const orderId = db.createOrder({
    productId: product.id,
    discordUserId: interaction.user.id,
    paymentMethod: 'manual',
  });

  let thread;
  try {
    thread = await interaction.channel.threads.create({
      name: `pedido-${interaction.user.username}-${orderId}`,
      type: ChannelType.PrivateThread,
      reason: `Pedido #${orderId}`,
    });
  } catch (err) {
    // Tópicos privados exigem boost nível 2 — se falhar, usa um tópico normal.
    thread = await interaction.channel.threads.create({
      name: `pedido-${interaction.user.username}-${orderId}`,
      type: ChannelType.PublicThread,
      reason: `Pedido #${orderId}`,
    });
  }

  await thread.members.add(interaction.user.id).catch(() => {});
  orderThreads.set(orderId, thread.id);

  const revisaoEmbed = new EmbedBuilder()
    .setTitle('🛒 Revisão do Pedido')
    .setColor(0x9b59b6)
    .addFields(
      { name: 'Produto', value: product.name, inline: true },
      { name: 'Quantidade', value: '1', inline: true },
      { name: 'Valor', value: formatPriceEUR(product.price_eur), inline: true }
    )
    .setFooter({ text: `Pedido #${orderId}` });

  const rowRevisao = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`revisao_confirmar_${orderId}`)
      .setLabel('Ir para o Pagamento')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`revisao_cancelar_${orderId}`)
      .setLabel('Cancelar')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger)
  );

  await thread.send({
    content: `${interaction.user}, aqui está o resumo do teu pedido:`,
    embeds: [revisaoEmbed],
    components: [rowRevisao],
  });

  await interaction.editReply(`Abri o teu pedido em ${thread}. Continua por lá!`);
}

async function irParaPagamento(interaction, orderId) {
  const order = db.getOrder(orderId);
  if (!order || order.status !== 'pending') {
    return interaction.reply({ content: 'Este pedido já não está disponível.', ephemeral: true });
  }
  const product = db.getProduct(order.product_id);

  const pagamentoEmbed = new EmbedBuilder()
    .setTitle('💳 Pagamento')
    .setColor(0xf1c40f)
    .setDescription(
      `**${product.name}** — ${formatPriceEUR(product.price_eur)}\n\n${PAYMENT_INSTRUCTIONS}\n\n` +
        'Depois de pagares, aguarda que a staff confirme aqui mesmo — a chave chega automaticamente por DM.'
    )
    .setFooter({ text: `Pedido #${orderId}` });

  await interaction.update({ embeds: [pagamentoEmbed], components: [] });

  const staffEmbed = new EmbedBuilder()
    .setTitle(`Novo pedido #${orderId}`)
    .setColor(0xf1c40f)
    .addFields(
      { name: 'Produto', value: product.name, inline: true },
      { name: 'Valor', value: formatPriceEUR(product.price_eur), inline: true },
      { name: 'Comprador', value: `<@${order.discord_user_id}>`, inline: true }
    )
    .setDescription('Confirma aqui assim que receberes o pagamento.');

  const rowStaff = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`confirmar_${orderId}`)
      .setLabel('Confirmar pagamento')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`cancelar_${orderId}`)
      .setLabel('Cancelar pedido')
      .setStyle(ButtonStyle.Danger)
  );

  await logToChannel({ embeds: [staffEmbed], components: [rowStaff] });
}

async function cancelarPedidoCliente(interaction, orderId) {
  db.markOrderStatus(orderId, 'cancelado');
  const embed = new EmbedBuilder().setTitle('❌ Pedido cancelado').setColor(0xe74c3c);
  await interaction.update({ embeds: [embed], components: [] });
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

  await avisarThread(order.id, `✅ Pagamento confirmado! A tua chave foi enviada por DM. Obrigado pela compra!`);

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Slash commands + menu de seleção da loja + botões do carrinho + staff
// ---------------------------------------------------------------------------

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      if (commandName === 'produto-criar') {
        if (!isAdmin(interaction.member)) {
          return interaction.reply({ content: 'Só administradores podem usar este comando.', ephemeral: true });
        }
        const nome = interaction.options.getString('nome');
        const preco = interaction.options.getNumber('preco');
        const descricao = interaction.options.getString('descricao') || '';
        const cargo = interaction.options.getRole('cargo');

        const id = db.addProduct({ name: nome, description: descricao, priceEur: preco, roleId: cargo?.id });
        return interaction.reply({
          content: `Produto criado! **${nome}** (ID: ${id}). Agora usa \`/chave-adicionar produto_id:${id}\` para carregares as chaves.`,
          ephemeral: true,
        });
      }

      if (commandName === 'chave-adicionar') {
        if (!isAdmin(interaction.member)) {
          return interaction.reply({ content: 'Só administradores podem usar este comando.', ephemeral: true });
        }
        const productId = interaction.options.getInteger('produto_id');
        const attachment = interaction.options.getAttachment('ficheiro');
        const product = db.getProduct(productId);
        if (!product) return interaction.reply({ content: 'Não existe nenhum produto com esse ID.', ephemeral: true });

        await interaction.deferReply({ ephemeral: true });
        const res = await fetch(attachment.url);
        const text = await res.text();
        const added = db.addKeysBulk(productId, text.split('\n'));
        return interaction.editReply(
          `Foram adicionadas **${added}** chaves ao produto **${product.name}**. Stock atual: ${db.countAvailableKeys(
            productId
          )}.`
        );
      }

      if (commandName === 'produtos') {
        if (!isAdmin(interaction.member)) {
          return interaction.reply({ content: 'Só administradores podem usar este comando.', ephemeral: true });
        }
        const products = db.listActiveProducts();
        if (products.length === 0) return interaction.reply({ content: 'Ainda não há produtos criados.', ephemeral: true });
        const linhas = products.map(
          (p) => `**#${p.id} ${p.name}** — ${formatPriceEUR(p.price_eur)} — stock: ${db.countAvailableKeys(p.id)}`
        );
        return interaction.reply({ content: linhas.join('\n'), ephemeral: true });
      }

      if (commandName === 'loja') {
        if (!isAdmin(interaction.member)) {
          return interaction.reply({ content: 'Só administradores podem usar este comando.', ephemeral: true });
        }
        const products = db.listActiveProducts();
        const { embed, rows } = buildLojaEmbedAndRow(products);
        await interaction.channel.send({ embeds: [embed], components: rows });
        return interaction.reply({ content: 'Painel publicado!', ephemeral: true });
      }

      if (commandName === 'confirmar') {
        if (!isAdmin(interaction.member)) {
          return interaction.reply({ content: 'Só administradores podem usar este comando.', ephemeral: true });
        }
        const orderId = interaction.options.getInteger('pedido_id');
        const result = await entregarPedido(orderId);
        return interaction.reply({
          content: result.ok ? `Pedido #${orderId} confirmado e entregue.` : result.reason,
          ephemeral: true,
        });
      }

      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'comprar_select') {
      const productId = Number(interaction.values[0]);
      await criarPedido(interaction, productId);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('revisao_confirmar_')) {
      const orderId = Number(interaction.customId.replace('revisao_confirmar_', ''));
      await irParaPagamento(interaction, orderId);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('revisao_cancelar_')) {
      const orderId = Number(interaction.customId.replace('revisao_cancelar_', ''));
      await cancelarPedidoCliente(interaction, orderId);
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
      await avisarThread(orderId, '❌ O teu pedido foi cancelado pela staff.');
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
