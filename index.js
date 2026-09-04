require('dotenv').config();
const discord = require('discord.js');
const {
    Client,
    GatewayIntentBits,
    ChannelType,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    AttachmentBuilder
} = discord;
const fs = require('fs');
const path = require('path');

function v2({ content, imageUrl, accentColor } = {}, extraRows = []) {
    const {
        ContainerBuilder,
        TextDisplayBuilder,
        MediaGalleryBuilder,
        MediaGalleryItemBuilder,
        MessageFlags
    } = discord;

    if (!ContainerBuilder || !MessageFlags?.IsComponentsV2) {
        throw new Error('Atualiza o discord.js: npm install discord.js@14.27.0');
    }

    const container = new ContainerBuilder();
    if (accentColor != null) container.setAccentColor(accentColor);

    if (imageUrl) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(imageUrl)
            )
        );
    }

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(content)
    );

    for (const row of extraRows) {
        container.addActionRowComponents(row);
    }

    return {
        flags: MessageFlags.IsComponentsV2,
        components: [container]
    };
}

const CONFIG = {
    PREFIXO: process.env.PREFIX || '!',
    CANAL_LOGS_ID: process.env.LOGS_CHANNEL_ID,
    CATEGORIA_TICKETS_ID: process.env.TICKETS_CATEGORY_ID,
    CARGO_STAFF_TICKETS_ID: process.env.STAFF_ROLE_ID,
    AUTOROLE_ID: process.env.AUTOROLE_ID,
    BANNER_LOJA: process.env.LOJA_BANNER || '',
    TIPOS_TICKET: [
        { id_menu: 'ticket_suporte', nome: 'Suporte', desc: 'Abra um ticket de suporte', emoji: '🎫' },
        { id_menu: 'ticket_receber', nome: 'Receber Produto', desc: 'Abra um ticket para receber seu produto', emoji: '🛒' },
        { id_menu: 'ticket_duvidas', nome: 'Dúvidas', desc: 'Abra um ticket para tirar sua Dúvida', emoji: '❓' }
    ]
};

let db = null;
try {
    const sqlite3 = require('sqlite3').verbose();
    db = new sqlite3.Database(path.join(__dirname, 'database.sqlite'));
    db.serialize(() => {
        db.run('CREATE TABLE IF NOT EXISTS compras (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, produto TEXT, status TEXT, data DATETIME DEFAULT CURRENT_TIMESTAMP)');
    });
} catch (error) {
    console.warn('SQLite indisponível, o bot continua sem base de dados:', error.message);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ]
});

const ticketsAbertos = new Set();

function caminhoBanner() {
    const local = path.join(__dirname, 'assets', 'banner.png');
    if (fs.existsSync(local)) return local;
    if (CONFIG.BANNER_LOJA && fs.existsSync(CONFIG.BANNER_LOJA)) return CONFIG.BANNER_LOJA;
    return null;
}

function textoNitradas() {
    return (
        '## Nitradas\n' +
        '• Conta Full Acesso, Muda Email, Senha Etc...\n' +
        '• Contas com Nitro Gaming\n' +
        '• Contas Nitradas Possui Nitro.\n' +
        '• Nitradas Na Melhor Qualidade.\n\n' +
        '```ansi\n\u001b[2;32m⚡ Entrega Automática!\u001b[0m\n```\n' +
        'Preço: **De R$ 2,55 a R$ 7,99**\n' +
        'Clique no botão **"Comprar"**'
    );
}

function botaoComprar() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_comprar')
            .setLabel('Comprar')
            .setEmoji('🛒')
            .setStyle(ButtonStyle.Secondary)
    );
}

function payloadPainelLoja() {
    const ficheiro = caminhoBanner();
    const url = CONFIG.BANNER_LOJA && /^https?:\/\//i.test(CONFIG.BANNER_LOJA)
        ? CONFIG.BANNER_LOJA
        : null;
    const imageUrl = ficheiro ? 'attachment://banner.png' : (url || undefined);

    const payload = v2({
        content: textoNitradas(),
        imageUrl,
        accentColor: 0x120c0c
    }, [botaoComprar()]);

    if (ficheiro) {
        payload.files = [new AttachmentBuilder(ficheiro, { name: 'banner.png' })];
    }
    return payload;
}

function payloadLojaClassico() {
    const embed = new EmbedBuilder()
        .setTitle('Nitradas')
        .setDescription(
            '• Conta Full Acesso, Muda Email, Senha Etc...\n' +
            '• Contas com Nitro Gaming\n' +
            '• Contas Nitradas Possui Nitro.\n' +
            '• Nitradas Na Melhor Qualidade.\n\n' +
            '```ansi\n\u001b[2;32m⚡ Entrega Automática!\u001b[0m\n```\n' +
            'Preço: **De R$ 2,55 a R$ 7,99**\n' +
            'Clique no botão **"Comprar"**'
        )
        .setColor(0x120c0c);

    const payload = { embeds: [embed], components: [botaoComprar()] };
    const ficheiro = caminhoBanner();
    const url = CONFIG.BANNER_LOJA && /^https?:\/\//i.test(CONFIG.BANNER_LOJA)
        ? CONFIG.BANNER_LOJA
        : null;

    if (ficheiro) {
        payload.files = [new AttachmentBuilder(ficheiro, { name: 'banner.png' })];
    } else if (url) {
        payload.files = [new AttachmentBuilder(url, { name: 'banner.png' })];
    }
    return payload;
}

async function publicarPainelLoja(channel) {
    try {
        return await channel.send(payloadPainelLoja());
    } catch (erroV2) {
        console.warn('Painel V2 falhou, a usar embed:', erroV2.message);
        return channel.send(payloadLojaClassico());
    }
}

client.once('clientReady', aoFicarOnline);
client.once('ready', aoFicarOnline);

async function aoFicarOnline() {
    if (client.user.__lojaReady) return;
    client.user.__lojaReady = true;
    console.log(`🤖 Bot ${client.user.tag} Online e pronto para vender!`);
    try {
        for (const guild of client.guilds.cache.values()) {
            const cmds = await guild.commands.fetch();
            if (![...cmds.values()].some((c) => c.name === 'loja')) {
                await guild.commands.create({
                    name: 'loja',
                    description: 'Publica o painel da loja neste canal'
                });
            }
        }
    } catch (error) {
        console.error('Não foi possível registar o /loja:', error);
    }
}

client.on('guildMemberAdd', async (member) => {
    if (CONFIG.AUTOROLE_ID) {
        try {
            const role = member.guild.roles.cache.get(CONFIG.AUTOROLE_ID);
            if (role) await member.roles.add(role);
        } catch (error) {
            console.error('Erro ao dar autorole:', error);
        }
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    const texto = (message.content || '').trim();
    if (!texto.startsWith(CONFIG.PREFIXO)) return;

    const args = texto.slice(CONFIG.PREFIXO.length).trim().split(/\s+/);
    const commandName = (args.shift() || '').toLowerCase();

    if (commandName === 'loja') {
        try {
            await publicarPainelLoja(message.channel);
            message.delete().catch(() => {});
        } catch (error) {
            console.error('Erro no !loja:', error);
            await message.channel.send({ content: `Não consegui publicar a loja: \`${error.message}\`` }).catch(() => {});
        }
        return;
    }

    if (commandName === 'tickets') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
        message.delete().catch(() => {});

        const embed = new EmbedBuilder()
            .setTitle('Central de Atendimento')
            .setDescription('- Após solicitar atendimento, aguarde até que um integrante da equipa responda à sua solicitação.\n\n- O atendimento é realizado de forma privada; apenas membros autorizados terão acesso.\n\n- Ressaltamos que nossa equipa não está disponível 24 horas por dia.')
            .setImage('https://i.imgur.com/link_da_imagem.png')
            .setColor(0x2b2d31);

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('menu_abrir_ticket')
            .setPlaceholder('Selecione o tipo de atendimento')
            .addOptions(CONFIG.TIPOS_TICKET.map((t) =>
                new StringSelectMenuOptionBuilder()
                    .setLabel(t.nome)
                    .setDescription(t.desc)
                    .setValue(t.id_menu)
                    .setEmoji(t.emoji)
            ));

        const row = new ActionRowBuilder().addComponents(selectMenu);
        await message.channel.send({ embeds: [embed], components: [row] });
    }

    if (commandName === 'feedback') {
        message.delete().catch(() => {});
        const review = args.join(' ');
        if (!review) {
            const msgErro = await message.channel.send({ content: 'Uso incorreto. Tenta: `!feedback Gostei muito do serviço!`' });
            return setTimeout(() => msgErro.delete().catch(() => {}), 5000);
        }

        const embed = new EmbedBuilder()
            .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
            .setTitle('🌟 Novo Feedback Recebido!')
            .setDescription(`**Avaliação do Cliente:**\n${review}`)
            .setColor(0xFEE75C)
            .setTimestamp();

        await message.channel.send({ embeds: [embed] });
    }
});

client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand() && interaction.commandName === 'loja') {
        try {
            await interaction.deferReply({ flags: 64 });
            await publicarPainelLoja(interaction.channel);
            return interaction.editReply({ content: 'Painel da loja publicado neste canal.' });
        } catch (error) {
            console.error('Erro no /loja:', error);
            const msg = `Não consegui publicar a loja: \`${error.message}\``;
            if (interaction.deferred || interaction.replied) return interaction.editReply({ content: msg });
            return interaction.reply({ content: msg, flags: 64 });
        }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'menu_abrir_ticket') {
        const tipoId = interaction.values[0];
        const tipo = CONFIG.TIPOS_TICKET.find((t) => t.id_menu === tipoId);

        const chaveTicket = `${interaction.user.id}_${tipoId}`;
        if (ticketsAbertos.has(chaveTicket)) {
            return interaction.reply({ content: 'Já tens um ticket aberto para este assunto.', flags: 64 });
        }

        await interaction.deferReply({ flags: 64 });

        try {
            const overwrites = [
                { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] }
            ];

            if (CONFIG.CARGO_STAFF_TICKETS_ID) {
                overwrites.push({ id: CONFIG.CARGO_STAFF_TICKETS_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
            }

            const canal = await interaction.guild.channels.create({
                name: `ticket-${interaction.user.username}`,
                type: ChannelType.GuildText,
                parent: CONFIG.CATEGORIA_TICKETS_ID || null,
                permissionOverwrites: overwrites
            });

            ticketsAbertos.add(chaveTicket);

            const fecharBtn = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`fechar_ticket_${chaveTicket}`)
                    .setLabel('Fechar Ticket')
                    .setEmoji('🔒')
                    .setStyle(ButtonStyle.Danger)
            );

            await canal.send({ content: `Olá ${interaction.user}, bem-vindo ao teu ticket de **${tipo.nome}**. A staff irá responder em breve.`, components: [fecharBtn] });
            return interaction.editReply({ content: `Ticket criado com sucesso em: ${canal}` });
        } catch (error) {
            console.error(error);
            return interaction.editReply({ content: 'Erro ao criar o ticket. Verifica as permissões do Bot.' });
        }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'menu_loja_produto') {
        const btnCredito = new ButtonBuilder().setCustomId('pay_credito').setLabel('Crédito/Débito').setEmoji('💳').setStyle(ButtonStyle.Primary);
        const btnLtc = new ButtonBuilder().setCustomId('pay_ltc').setLabel('Litecoin').setEmoji('1301292023914856488').setStyle(ButtonStyle.Secondary);
        const btnBtc = new ButtonBuilder().setCustomId('pay_btc').setLabel('Bitcoin').setEmoji('1301292040432291901').setStyle(ButtonStyle.Secondary);
        const btnCancelar = new ButtonBuilder().setCustomId('pay_cancel').setLabel('Cancelar').setEmoji('🗑️').setStyle(ButtonStyle.Danger);
        const row = new ActionRowBuilder().addComponents(btnCredito, btnLtc, btnBtc, btnCancelar);
        return interaction.reply({ content: 'Selecione uma forma de pagamento:', components: [row], flags: 64 });
    }

    if (interaction.isButton() && interaction.customId.startsWith('fechar_ticket_')) {
        const chaveTicket = interaction.customId.replace('fechar_ticket_', '');
        ticketsAbertos.delete(chaveTicket);
        await interaction.reply({ content: 'O ticket será fechado e apagado em 5 segundos...' });
        setTimeout(() => interaction.channel.delete().catch(() => null), 5000);
    }

    if (interaction.isButton() && interaction.customId === 'btn_comprar') {
        const btnCredito = new ButtonBuilder().setCustomId('pay_credito').setLabel('Crédito/Débito').setEmoji('💳').setStyle(ButtonStyle.Primary);
        const btnLtc = new ButtonBuilder().setCustomId('pay_ltc').setLabel('Litecoin').setEmoji('1301292023914856488').setStyle(ButtonStyle.Secondary);
        const btnBtc = new ButtonBuilder().setCustomId('pay_btc').setLabel('Bitcoin').setEmoji('1301292040432291901').setStyle(ButtonStyle.Secondary);
        const btnCancelar = new ButtonBuilder().setCustomId('pay_cancel').setLabel('Cancelar').setEmoji('🗑️').setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(btnCredito, btnLtc, btnBtc, btnCancelar);
        await interaction.reply({ content: 'Selecione uma forma de pagamento:', components: [row], flags: 64 });
    }

    if (interaction.isButton() && interaction.customId.startsWith('pay_')) {
        const type = interaction.customId.replace('pay_', '');

        if (type === 'cancel') {
            return interaction.update({ content: 'A compra foi cancelada com sucesso.', components: [] });
        }

        const embed = new EmbedBuilder()
            .setTitle('Aguardando Pagamento')
            .setDescription(`Foi escolhido o método: **${type.toUpperCase()}**.\n\n*Nesta secção, integrará o link final para a Stripe/Coinbase/Cryptomus dependendo de como processará as moedas no futuro.*`)
            .setColor(0x2b2d31);

        await interaction.update({ content: '', embeds: [embed], components: [] });
    }
});

client.login(process.env.DISCORD_TOKEN || process.env.TOKEN);
