require('dotenv').config();
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
} = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const CONFIG = {
    PREFIXO: process.env.PREFIX || '!',
    CANAL_LOGS_ID: process.env.LOGS_CHANNEL_ID,
    CATEGORIA_TICKETS_ID: process.env.TICKETS_CATEGORY_ID,
    CARGO_STAFF_TICKETS_ID: process.env.STAFF_ROLE_ID,
    AUTOROLE_ID: process.env.AUTOROLE_ID,
    BANNER_LOJA: process.env.LOJA_BANNER || 'https://cdn.discordapp.com/attachments/1534183602764648579/1545405851089768458/E38321D1-EC20-4C1C-853E-49B17BD42B90.png?ex=6a9c06db&is=6a9ab55b&hm=e43d7971bd59b37b93416ad024a948208bebb856eea7e8e9163d93879e6de3fa',
    TIPOS_TICKET: [
        { id_menu: 'ticket_suporte', nome: 'Suporte', desc: 'Abra um ticket de suporte', emoji: '🎫' },
        { id_menu: 'ticket_receber', nome: 'Receber Produto', desc: 'Abra um ticket para receber seu produto', emoji: '🛒' },
        { id_menu: 'ticket_duvidas', nome: 'Dúvidas', desc: 'Abra um ticket para tirar sua Dúvida', emoji: '❓' }
    ]
};

const db = new sqlite3.Database(path.join(__dirname, 'database.sqlite'));
db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS compras (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, produto TEXT, status TEXT, data DATETIME DEFAULT CURRENT_TIMESTAMP)");
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ]
});

const ticketsAbertos = new Set();

function podePublicarPainel(member, guild) {
    if (!member || !guild) return false;
    if (member.id === guild.ownerId) return true;
    return member.permissions.has(PermissionFlagsBits.Administrator)
        || member.permissions.has(PermissionFlagsBits.ManageGuild);
}

function resolverBanner(usarFicheiroLocal = false) {
    const bannerFonte = CONFIG.BANNER_LOJA;
    const bannerLocal = path.join(__dirname, 'assets', 'banner.png');
    if (!usarFicheiroLocal && bannerFonte && /^https?:\/\//i.test(bannerFonte)) return bannerFonte;
    if (bannerFonte && fs.existsSync(bannerFonte)) return bannerFonte;
    if (fs.existsSync(bannerLocal)) return bannerLocal;
    return null;
}

function payloadPainelLoja(usarFicheiroLocal = false) {
    const cor = 0x2b2d31;

    const embedBanner = new EmbedBuilder().setColor(cor);
    const embedTexto = new EmbedBuilder()
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
        .setColor(cor);

    const components = [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('btn_comprar')
                .setLabel('Comprar')
                .setEmoji('🛒')
                .setStyle(ButtonStyle.Secondary)
        )
    ];

    const bannerFonte = resolverBanner(usarFicheiroLocal);
    const payload = { embeds: [embedTexto], components };

    if (bannerFonte) {
        embedBanner.setImage('attachment://banner.png');
        payload.files = [new AttachmentBuilder(bannerFonte, { name: 'banner.png' })];
        payload.embeds = [embedBanner, embedTexto];
    }

    return payload;
}

async function publicarPainelLoja(channel) {
    try {
        return await channel.send(payloadPainelLoja(false));
    } catch (error) {
        const bannerLocal = path.join(__dirname, 'assets', 'banner.png');
        if (!fs.existsSync(bannerLocal)) throw error;
        return channel.send(payloadPainelLoja(true));
    }
}

client.once('ready', async () => {
    console.log(`🤖 Bot ${client.user.tag} Online e pronto para vender!`);
    try {
        const cmds = [{ name: 'loja', description: 'Publica o painel da loja neste canal' }];
        for (const guild of client.guilds.cache.values()) {
            await guild.commands.set(cmds);
        }
    } catch (error) {
        console.error('Não foi possível registar o /loja:', error);
    }
});

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
            const member = message.member || await message.guild.members.fetch(message.author.id);
            if (!podePublicarPainel(member, message.guild)) {
                const aviso = await message.reply({ content: 'Não tens permissão para publicar a loja (precisa de Administrador ou Gerir Servidor).' });
                return setTimeout(() => aviso.delete().catch(()=>{}), 8000);
            }
            await publicarPainelLoja(message.channel);
            message.delete().catch(()=>{});
        } catch (error) {
            console.error('Erro no !loja:', error);
            await message.channel.send({ content: `Não consegui publicar a loja: \`${error.message}\`` }).catch(()=>{});
        }
        return;
    }

    if (commandName === 'tickets') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
        message.delete().catch(()=>{});

        const embed = new EmbedBuilder()
            .setTitle('Central de Atendimento')
            .setDescription('- Após solicitar atendimento, aguarde até que um integrante da equipa responda à sua solicitação.\n\n- O atendimento é realizado de forma privada; apenas membros autorizados terão acesso.\n\n- Ressaltamos que nossa equipa não está disponível 24 horas por dia.')
            .setImage('https://i.imgur.com/link_da_imagem.png') 
            .setColor(0x2b2d31);

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('menu_abrir_ticket')
            .setPlaceholder('Selecione o tipo de atendimento')
            .addOptions(CONFIG.TIPOS_TICKET.map(t => 
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
        message.delete().catch(()=>{});
        const review = args.join(' ');
        if (!review) {
            const msgErro = await message.channel.send({ content: 'Uso incorreto. Tenta: `!feedback Gostei muito do serviço!`' });
            return setTimeout(() => msgErro.delete().catch(()=>{}), 5000);
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
            const member = interaction.member || await interaction.guild.members.fetch(interaction.user.id);
            if (!podePublicarPainel(member, interaction.guild)) {
                return interaction.reply({ content: 'Não tens permissão para publicar a loja (precisa de Administrador ou Gerir Servidor).', flags: 64 });
            }
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
        const tipo = CONFIG.TIPOS_TICKET.find(t => t.id_menu === tipoId);
        
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

    if (interaction.isButton() && interaction.customId.startsWith('fechar_ticket_')) {
        const chaveTicket = interaction.customId.replace('fechar_ticket_', '');
        ticketsAbertos.delete(chaveTicket);
        await interaction.reply({ content: 'O ticket será fechado e apagado em 5 segundos...' });
        setTimeout(() => interaction.channel.delete().catch(()=>null), 5000);
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

client.login(process.env.DISCORD_TOKEN);
