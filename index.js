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
    PermissionFlagsBits
} = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// --- Configurações Iniciais ---
const CONFIG = {
    PREFIXO: process.env.PREFIX || '!',
    CANAL_LOGS_ID: process.env.LOGS_CHANNEL_ID,
    CATEGORIA_TICKETS_ID: process.env.TICKETS_CATEGORY_ID,
    CARGO_STAFF_TICKETS_ID: process.env.STAFF_ROLE_ID,
    AUTOROLE_ID: process.env.AUTOROLE_ID,

    TIPOS_TICKET: [
        { id_menu: 'ticket_suporte', nome: 'Suporte', desc: 'Abra um ticket de suporte', emoji: '🎫' },
        { id_menu: 'ticket_receber', nome: 'Receber Produto', desc: 'Abra um ticket para receber seu produto', emoji: '🛒' },
        { id_menu: 'ticket_duvidas', nome: 'Dúvidas', desc: 'Abra um ticket para tirar sua Dúvida', emoji: '❓' }
    ]
};

// --- Base de Dados (SQLite) ---
const db = new sqlite3.Database(path.join(__dirname, 'database.sqlite'));
db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS compras (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, produto TEXT, status TEXT, data DATETIME DEFAULT CURRENT_TIMESTAMP)");
});

// --- Iniciar o Bot ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ]
});

const ticketsAbertos = new Set();

client.once('ready', () => {
    console.log(`🤖 Bot ${client.user.tag} Online e pronto para vender!`);
});

// --- Sistema de Autorole ---
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

// --- Comandos (!loja, !tickets, !feedback) ---
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild || !message.content.startsWith(CONFIG.PREFIXO)) return;

    const args = message.content.slice(CONFIG.PREFIXO.length).trim().split(/\s+/);
    const commandName = args.shift().toLowerCase();
    
    // Comando 1: Painel de Loja (Comprar)
    if (commandName === 'loja') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
        message.delete().catch(()=>{});

        const embed = new EmbedBuilder()
            .setTitle('⚡ Entrega Automática!')
            .setDescription('**Impulsos Automáticos**\n\n- Entrega automática em menos de 1 minuto\n- Os impulsos são entregues apenas com o convite do servidor\n- Entrega instantânea\n\nPreço: **De R$ 2,50 a R$ 25,99**')
            .setColor(0x2b2d31)
            .setFooter({ text: 'Clique no botão "Comprar"' });

        const btn = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('btn_comprar')
                .setLabel('Comprar')
                .setEmoji('🛒')
                .setStyle(ButtonStyle.Secondary)
        );

        await message.channel.send({ embeds: [embed], components: [btn] });
    }

    // Comando 2: Painel de Tickets (Central de Atendimento)
    if (commandName === 'tickets') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
        message.delete().catch(()=>{});

        const embed = new EmbedBuilder()
            .setTitle('Central de Atendimento')
            .setDescription('- Após solicitar atendimento, aguarde até que um integrante da equipa responda à sua solicitação.\n\n- O atendimento é realizado de forma privada; apenas membros autorizados terão acesso.\n\n- Ressaltamos que nossa equipa não está disponível 24 horas por dia.')
            // Se quiser colocar o banner roxo da imagem, insira o link aqui dentro das aspas:
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

    // Comando 3: Feedback
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

// --- Interações (Menus, Botões) ---
client.on('interactionCreate', async (interaction) => {
    
    // Lógica do Menu de Tickets
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

    // Lógica do botão Fechar Ticket
    if (interaction.isButton() && interaction.customId.startsWith('fechar_ticket_')) {
        const chaveTicket = interaction.customId.replace('fechar_ticket_', '');
        ticketsAbertos.delete(chaveTicket);
        await interaction.reply({ content: 'O ticket será fechado e apagado em 5 segundos...' });
        setTimeout(() => interaction.channel.delete().catch(()=>null), 5000);
    }

    // Lógica do botão inicial de COMPRAR na loja
    if (interaction.isButton() && interaction.customId === 'btn_comprar') {
        const btnCredito = new ButtonBuilder().setCustomId('pay_credito').setLabel('Crédito/Débito').setEmoji('💳').setStyle(ButtonStyle.Primary);
        const btnLtc = new ButtonBuilder().setCustomId('pay_ltc').setLabel('Litecoin').setEmoji('1301292023914856488').setStyle(ButtonStyle.Secondary);
        const btnBtc = new ButtonBuilder().setCustomId('pay_btc').setLabel('Bitcoin').setEmoji('1301292040432291901').setStyle(ButtonStyle.Secondary);
        const btnCancelar = new ButtonBuilder().setCustomId('pay_cancel').setLabel('Cancelar').setEmoji('🗑️').setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(btnCredito, btnLtc, btnBtc, btnCancelar);
        
        await interaction.reply({ content: 'Selecione uma forma de pagamento:', components: [row], flags: 64 });
    }

    // Lógica ao clicar num dos métodos de pagamento na loja
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
