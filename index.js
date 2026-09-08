// index.js
// Corre o bot com: npm start
// Os slash commands são registados automaticamente quando o bot liga.
// É só bot: o pagamento é confirmado pela API do Stripe quando o cliente
// carrega em "Já paguei" (não há servidor de webhook a correr).

require('dotenv').config();
const Stripe = require('stripe');
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
  PermissionFlagsBits,
} = require('discord.js');

const db = require('./db');
const { formatPrice } = require('./currency');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

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

  new SlashCommandBuilder()
    .setName('loja')
    .setDescription('Publica a loja neste canal')
    .addStringOption((opt) =>
      opt
        .setName('categoria')
        .setDescription('Publica só o painel deste canal (ex.: Impulsos). Sem isto, publica tudo.')
        .setRequired(false)
    ),
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

function buildLojaEmbedAndRow(products, categoryName) {
  const embed = new EmbedBuilder()
    .setTitle(categoryName ? `🎮 Loja — ${categoryName}` : '🎮 Loja de Jogos')
    .setColor(0x5865f2)
    .setDescription(
      products.length
        ? 'Escolhe uma opção abaixo para comprar. A chave é entregue automaticamente por DM após o pagamento.'
        : 'Não há produtos disponíveis de momento.'
    );

  for (const p of products) {
    const stock = db.countAvailableKeys(p.id);
    embed.addFields({
      name: `${p.name} — ${formatPrice(p.price_cents, p.currency)}`,
      value: `${p.description || 'Sem descrição.'}\nStock: **${stock}** ${
        stock === 0 ? '(esgotado)' : ''
      }`,
    });
  }

  const options = products
    .filter((p) => db.countAvailableKeys(p.id) > 0)
    .slice(0, 25)
    .map((p) => ({
      label: `${p.name} — ${formatPrice(p.price_cents, p.currency)}`,
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
// Compra: cria a sessão de checkout no Stripe
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

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: product.currency,
          product_data: {
            name: product.name,
            description: product.description || undefined,
          },
          unit_amount: product.price_cents,
        },
        quantity: 1,
      },
    ],
    success_url: process.env.SUCCESS_URL || 'https://example.com/sucesso',
    cancel_url: process.env.CANCEL_URL || 'https://example.com/cancelado',
    metadata: {
      order_id: String(orderId),
      discord_user_id: interaction.user.id,
      product_id: String(product.id),
    },
  });

  db.attachStripeSession(orderId, session.id);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Pagar agora').setStyle(ButtonStyle.Link).setURL(session.url),
    new ButtonBuilder()
      .setLabel('Já paguei — receber chave')
      .setStyle(ButtonStyle.Success)
      .setCustomId(`verificar_${orderId}`)
  );

  await interaction.reply({
    content: `Compra de **${product.name}** criada. Clica em **Pagar agora** e, depois de pagares, carrega em **Já paguei — receber chave** para receberes a chave por DM.`,
    components: [row],
    ephemeral: true,
  });
}

// ---------------------------------------------------------------------------
// Confirmação do pagamento (só bot): consulta o estado da sessão no Stripe
// quando o cliente carrega em "Já paguei" e entrega a chave se estiver paga.
// ---------------------------------------------------------------------------

async function verificarEEntregar(interaction, orderId) {
  const order = db.getOrder(orderId);
  if (!order) {
    return interaction.reply({ content: 'Pedido não encontrado.', ephemeral: true });
  }
  if (order.status === 'delivered') {
    return interaction.reply({
      content: 'Este pedido já foi entregue. Vê as tuas DMs. 📩',
      ephemeral: true,
    });
  }
  if (!order.stripe_session_id) {
    return interaction.reply({
      content: 'Este pedido ainda não tem um pagamento associado.',
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const session = await stripe.checkout.sessions.retrieve(order.stripe_session_id);
  if (session.payment_status !== 'paid') {
    return interaction.editReply(
      'Ainda não recebi a confirmação do pagamento. Se acabaste de pagar, espera uns segundos e carrega outra vez.'
    );
  }

  await entregarPedido(orderId);

  if (db.getOrder(orderId).status === 'delivered') {
    await interaction.editReply('✅ Pagamento confirmado! Enviei a tua chave por DM.');
  } else {
    await interaction.editReply(
      '⚠️ Pagamento confirmado, mas não há stock disponível de momento. Um admin vai tratar da entrega.'
    );
  }
}

// ---------------------------------------------------------------------------
// Entrega: chamado quando o Stripe confirma o pagamento
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
// Slash commands e interações
// ---------------------------------------------------------------------------

client.on('interactionCreate', async (interaction) => {
  try {
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
        const categoria = interaction.options.getString('categoria');
        const products = categoria
          ? db.listActiveProductsByCategory(categoria)
          : db.listActiveProducts();

        if (categoria && products.length === 0) {
          return interaction.reply({
            content: `Não há produtos no canal **${categoria}**. Categorias disponíveis: ${
              db.listCategories().join(', ') || '(nenhuma)'
            }.`,
            ephemeral: true,
          });
        }

        const { embed, rows } = buildLojaEmbedAndRow(products, categoria);
        await interaction.channel.send({ embeds: [embed], components: rows });
        await interaction.reply({
          content: categoria ? `Painel do canal **${categoria}** publicado!` : 'Loja publicada!',
          ephemeral: true,
        });
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'comprar_select') {
      const productId = Number(interaction.values[0]);
      await iniciarCompra(interaction, productId);
    }

    if (interaction.isButton() && interaction.customId.startsWith('verificar_')) {
      const orderId = Number(interaction.customId.slice('verificar_'.length));
      await verificarEEntregar(interaction, orderId);
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

client.once('ready', async () => {
  console.log(`Bot ligado como ${client.user.tag}`);
  try {
    await registerSlashCommands();
  } catch (err) {
    console.error('❌ Erro ao registar comandos:', err);
  }
});

// Só liga o bot quando o ficheiro é corrido diretamente (npm start).
// Assim o módulo pode ser importado em testes sem tentar autenticar no Discord.
if (require.main === module) {
  client.login(process.env.DISCORD_TOKEN);
}
