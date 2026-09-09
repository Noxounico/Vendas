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
  PermissionFlagsBits,
} = require('discord.js');

const db = require('./db');
const { formatPrice } = require('./currency');

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

  const embed = new EmbedBuilder()
    .setTitle(titulo)
    .setColor(0xe02424)
    .setDescription(descricao)
    .addFields({ name: 'Acesso ao servidor', value: 'Clique no botão **Verificar**' });
  // Só mete a imagem se for mesmo um URL (evita rebentar o embed com valores inválidos).
  if (imagem && /^https?:\/\//i.test(imagem)) embed.setImage(imagem);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Verificar')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
      .setCustomId(`verificar_${roleId}`)
  );

  try {
    await interaction.channel.send({ embeds: [embed], components: [row] });
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

module.exports = { client, buildLojaEmbedAndRow, formatPrice, entregarPedido };
