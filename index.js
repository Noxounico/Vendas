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
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    EmbedBuilder, 
    PermissionFlagsBits,
    REST,
    Routes,
    SlashCommandBuilder
} = require('discord.js');

const { v2 } = require('./utils/v2.js');
const fs = require('fs');
const path = require('path');

// ---- Proteção contra instâncias duplicadas do bot ----
const LOCK_FILE = path.join(__dirname, 'bot.lock');

function verificarInstanciaUnica() {
    if (fs.existsSync(LOCK_FILE)) {
        const pidAntigo = parseInt(fs.readFileSync(LOCK_FILE, 'utf8'), 10);
        try {
            process.kill(pidAntigo, 0);
            console.error(`❌ Já existe uma instância deste bot a correr (PID ${pidAntigo}).`);
            console.error(`   Fecha essa janela/processo antes de abrir uma nova, ou apaga "bot.lock" se tiveres a certeza que não há nenhum a correr.`);
            process.exit(1);
        } catch (e) {}
    }
    fs.writeFileSync(LOCK_FILE, String(process.pid), 'utf8');
}

function limparLock() {
    try {
        if (fs.existsSync(LOCK_FILE)) {
            const pidNoLock = parseInt(fs.readFileSync(LOCK_FILE, 'utf8'), 10);
            if (pidNoLock === process.pid) fs.unlinkSync(LOCK_FILE);
        }
    } catch (e) {}
}

verificarInstanciaUnica();
process.on('exit', limparLock);
process.on('SIGINT', () => { limparLock(); process.exit(); });
process.on('SIGTERM', () => { limparLock(); process.exit(); });
// ---- Fim da proteção ----

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ]
});

const CONFIG = {
    CANAL_LOGS_ID: '1532011317882519592', 
    PREFIXO: '!',

    // Categoria (canal-pai) onde os canais de ticket são criados. Substitui pelo ID real.
    CATEGORIA_TICKETS_ID: '1545383446208315422',
    // Cargo de staff que deve conseguir ver todos os tickets. Substitui pelo ID real.
    CARGO_STAFF_TICKETS_ID: '1545383480232378379',

    TIPOS_TICKET: [
        { id_menu: 'ticket_suporte', nome: 'Suporte', desc: 'Abrir um ticket de suporte geral', emoji: '🎫' },
        { id_menu: 'ticket_duvidas', nome: 'Dúvidas', desc: 'Tirar uma dúvida com a Staff', emoji: '❓' },
        { id_menu: 'ticket_denuncia', nome: 'Denúncia', desc: 'Denunciar uma situação à Staff', emoji: '🚨' }
    ],

    CATEGORIAS_HIERARQUIA: [
        { titulo: 'HIERARQUIA MÁFIA', cargos: ['1527000274038947890'], grupo: 'gestao' },
        { titulo: 'ADM', cargos: ['1527000248982175764'], grupo: 'gestao' },
        { titulo: 'AUX', cargos: ['1527000221089796236'], grupo: 'gestao' },
        { titulo: 'LID', cargos: ['1527001475652522267'], grupo: 'gestao' },
        { titulo: 'SUB', cargos: ['1527000194548502632'], grupo: 'gestao' },
        { titulo: 'MEMBRO-E', cargos: ['1527000169537605703'], grupo: 'membros' },
        { titulo: 'MEMBRO', cargos: ['1527000128953516052'], grupo: 'membros' }
    ],

    EMOJIS: {
        sucesso: '<:sucess:1520249613901103135>',
        aviso: '<:192440warningicon:1533451130049265704>',
        info: '<:info:1520249612542279780>',
        cancelar: '<:cancel:1520249621589524571>',
        ticket: '<:ticket:1520278432687325195>',
        auth: '<:272410anonymous:1533449386594664509>',
        // Emojis decorativos usados antes e depois de cada nome no !hierarquia.
        hierarquiaEsq: '<:272410anonymous:1534181186216132688>',
        hierarquiaDir: '<:272410anonymous:1534181186216132688>',
        coroa: '👑'
    }
};

const pedidosPendentes = new Set();
// Guarda "userId_tipoTicket" enquanto o ticket estiver aberto, para não deixar abrir duplicados.
const ticketsAbertos = new Set();

async function responderETemporizar(interactionOrMessage, conteudo, ephemeral = true) {
    if (interactionOrMessage.replied || interactionOrMessage.deferred) {
        const msg = await interactionOrMessage.followUp({ content: conteudo, ephemeral });
        setTimeout(() => msg.delete().catch(() => {}), 3000);
    } else if (interactionOrMessage.isChatInputCommand || interactionOrMessage.isButton || interactionOrMessage.isStringSelectMenu) {
        await interactionOrMessage.reply({ content: conteudo, ephemeral });
        setTimeout(() => interactionOrMessage.deleteReply().catch(() => {}), 3000);
    } else {
        const rep = await interactionOrMessage.channel.send(conteudo);
        setTimeout(() => rep.delete().catch(() => {}), 3000);
    }
}

client.once('clientReady', async () => {
    console.log(`🤖 ${client.user.tag} está online e pronto a funcionar com comandos por prefixo (${CONFIG.PREFIXO})!`);

    try {
        const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
        await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
        console.log('🗑️ Comandos de barra (/) antigos removidos.');
    } catch (error) {
        console.error('Erro ao remover comandos de barra antigos:', error);
    }

});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    if (!message.content.startsWith(CONFIG.PREFIXO)) return;

    const args = message.content.slice(CONFIG.PREFIXO.length).trim().split(/\s+/);
    const commandName = args.shift().toLowerCase();

    message.delete().catch(() => {});

    async function responderEApagar(payloadOptions) {
        const rep = await message.channel.send(payloadOptions);
        setTimeout(() => rep.delete().catch(() => {}), 3000);
        return rep;
    }

    if (commandName === 'pedirset') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return responderEApagar({ content: `${CONFIG.EMOJIS.cancelar} Apenas Administradores podem usar este comando.` });
        }

        // Identifica sozinho os cargos disponíveis no servidor (sem lista fixa a manter):
        // pega em todos os cargos "normais" abaixo do cargo mais alto do bot.
        const meuCargoTopo = message.guild.members.me.roles.highest;
        const cargosDisponiveis = message.guild.roles.cache
            .filter(r => r.id !== message.guild.id && !r.managed && r.position < meuCargoTopo.position)
            .sort((a, b) => b.position - a.position)
            .first(25);

        if (!cargosDisponiveis.length) {
            return responderEApagar({ content: `${CONFIG.EMOJIS.aviso} Não encontrei nenhum cargo que o bot possa atribuir (verifica a posição do cargo do bot na hierarquia).` });
        }

        const optionsMenu = cargosDisponiveis.map(role =>
            new StringSelectMenuOptionBuilder()
                .setLabel(`· ${role.name}`)
                .setDescription(`Solicitar o cargo ${role.name}`.slice(0, 100))
                .setValue(role.id)
        );
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('menu_pedir_set')
            .setPlaceholder('Selecione o Set que desejas pedir...')
            .addOptions(optionsMenu);
        const row = new ActionRowBuilder().addComponents(selectMenu);
        const payload = v2({
            content: `## ${CONFIG.EMOJIS.auth} Solicitação de Set / Cargos\nSeja bem-vindo(a) ao sistema de solicitação da nossa cidade!\n\n> Utilize o menu abaixo para selecionar o cargo desejado. A nossa equipa de Staff irá analisar o seu pedido o mais rápido possível.\n> \n> Lembre-se de ter os seus requisitos prontos ao abrir o ticket.\n\n-# Ao selecionar, um canal privado será criado para análise da Staff.`,
            imageUrl: 'https://i.postimg.cc/VNPjBpps/Design-sem-nome-(2).png',
            footer: '-# NoxAssistant 2026 ©',
            accentColor: 0x2F3136
        }, [row]);

        await message.channel.send(payload);
        return responderEApagar({ content: `${CONFIG.EMOJIS.sucesso} Painel de sets enviado com sucesso!` });
    }

    if (commandName === 'tickets') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return responderEApagar({ content: `${CONFIG.EMOJIS.cancelar} Apenas Administradores podem usar este comando.` });
        }
        const optionsMenu = CONFIG.TIPOS_TICKET.map(tipo =>
            new StringSelectMenuOptionBuilder()
                .setLabel(`· ${tipo.nome}`)
                .setDescription(tipo.desc)
                .setValue(tipo.id_menu)
                .setEmoji(tipo.emoji)
        );
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('menu_abrir_ticket')
            .setPlaceholder('Selecione o tipo de ticket que deseja abrir...')
            .addOptions(optionsMenu);
        const row = new ActionRowBuilder().addComponents(selectMenu);
        const payload = v2({
            content: `## ${CONFIG.EMOJIS.ticket} Central de Atendimento\nPrecisas de falar com a Staff?\n\n> Utilize o menu abaixo para escolher o tipo de ticket. Vai ser criado um canal privado só teu para tratares do assunto com a equipa.\n\n-# Ao selecionar, um canal privado será criado para análise da Staff.`,
            imageUrl: 'https://i.postimg.cc/VNPjBpps/Design-sem-nome-(2).png',
            footer: '-# NoxAssistant 2026 ©',
            accentColor: 0x2F3136
        }, [row]);

        await message.channel.send(payload);
        return responderEApagar({ content: `${CONFIG.EMOJIS.sucesso} Painel de tickets enviado com sucesso!` });
    }

    if (commandName === 'clear') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return responderEApagar({ content: `${CONFIG.EMOJIS.cancelar} Não tens permissão para limpar mensagens.` });
        }
        const amount = parseInt(args[0], 10);
        if (!amount || amount < 1 || amount > 99) {
            return responderEApagar({ content: `${CONFIG.EMOJIS.aviso} Usa \`!clear <1-99>\`, ex: \`!clear 20\`.` });
        }
        await message.channel.bulkDelete(amount, true);
        return responderEApagar({ content: `${CONFIG.EMOJIS.sucesso} **${amount}** mensagens limpas com sucesso!` });
    }

});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return;

    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'menu_pedir_set') {
            if (pedidosPendentes.has(interaction.user.id)) {
                return interaction.reply({ content: `${CONFIG.EMOJIS.aviso} Sua ficha já está em revisão, aguarde uma resposta.`, flags: 64 });
            }

            const roleId = interaction.values[0];
            const role = interaction.guild.roles.cache.get(roleId);

            if (!role) {
                return interaction.reply({ content: `${CONFIG.EMOJIS.aviso} Esse cargo já não existe no servidor.`, flags: 64 });
            }

            const modal = new ModalBuilder()
                .setCustomId(`modal_set_${role.id}`)
                .setTitle(`Solicitar Set: ${role.name}`.slice(0, 45));

            const nomeInput = new TextInputBuilder().setCustomId('input_nome').setLabel('Nome in Game').setStyle(TextInputStyle.Short).setRequired(true);
            const idInput = new TextInputBuilder().setCustomId('input_passaporte').setLabel('Passaporte / ID na cidade').setStyle(TextInputStyle.Short).setRequired(true);
            const recrutadorInput = new TextInputBuilder().setCustomId('input_recrutador').setLabel('Quem lhe recrutou?').setStyle(TextInputStyle.Short).setRequired(true);

            modal.addComponents(
                new ActionRowBuilder().addComponents(nomeInput),
                new ActionRowBuilder().addComponents(idInput),
                new ActionRowBuilder().addComponents(recrutadorInput)
            );

            await interaction.showModal(modal);
            return;
        }

        if (interaction.customId === 'menu_abrir_ticket') {
            const tipo = CONFIG.TIPOS_TICKET.find(t => t.id_menu === interaction.values[0]);
            if (!tipo) {
                return interaction.reply({ content: `${CONFIG.EMOJIS.aviso} Tipo de ticket inválido.`, flags: 64 });
            }

            const chaveTicket = `${interaction.user.id}_${tipo.id_menu}`;
            if (ticketsAbertos.has(chaveTicket)) {
                return interaction.reply({ content: `${CONFIG.EMOJIS.aviso} Já tens um ticket de **${tipo.nome}** aberto.`, flags: 64 });
            }

            await interaction.deferReply({ flags: 64 });

            const overwrites = [
                { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] }
            ];
            if (CONFIG.CARGO_STAFF_TICKETS_ID && interaction.guild.roles.cache.has(CONFIG.CARGO_STAFF_TICKETS_ID)) {
                overwrites.push({ id: CONFIG.CARGO_STAFF_TICKETS_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
            }

            let canalTicket;
            try {
                canalTicket = await interaction.guild.channels.create({
                    name: `ticket-${tipo.nome.toLowerCase()}-${interaction.user.username}`.slice(0, 90),
                    type: ChannelType.GuildText,
                    parent: interaction.guild.channels.cache.has(CONFIG.CATEGORIA_TICKETS_ID) ? CONFIG.CATEGORIA_TICKETS_ID : undefined,
                    permissionOverwrites: overwrites,
                    reason: `Ticket de ${tipo.nome} aberto por ${interaction.user.tag}`
                });
            } catch (err) {
                console.error('Erro ao criar canal de ticket:', err);
                return interaction.editReply({ content: `${CONFIG.EMOJIS.cancelar} Não consegui criar o canal do ticket. Verifica as permissões do bot.` });
            }

            ticketsAbertos.add(chaveTicket);

            const rowFechar = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`fechar_ticket_${chaveTicket}`)
                    .setLabel('Fechar Ticket')
                    .setEmoji('🔒')
                    .setStyle(ButtonStyle.Danger)
            );

            const payloadTicket = v2({
                content: `## ${tipo.emoji} Ticket de ${tipo.nome}\nOlá ${interaction.user}, a Staff foi notificada e vai atender-te aqui.\n\n> Descreve o teu pedido/situação com o máximo de detalhe possível.\n\n-# Aguarda com calma, a nossa equipa não está disponível 24 horas por dia.`,
                footer: '-# NoxAssistant 2026 ©',
                accentColor: 0x2F3136
            }, [rowFechar]);

            await canalTicket.send(payloadTicket);
            return interaction.editReply({ content: `${CONFIG.EMOJIS.sucesso} Ticket criado: ${canalTicket}` });
        }

    }

    if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('modal_set_')) {
            await interaction.deferReply({ flags: 64 });
            const roleId = interaction.customId.replace('modal_set_', '');
            const role = interaction.guild.roles.cache.get(roleId);

            if (!role) {
                return interaction.editReply({ content: `${CONFIG.EMOJIS.aviso} O cargo solicitado já não existe.` });
            }

            const nome = interaction.fields.getTextInputValue('input_nome');
            const passaporte = interaction.fields.getTextInputValue('input_passaporte');
            const recrutador = interaction.fields.getTextInputValue('input_recrutador');

            const logsChannel = interaction.guild.channels.cache.get(CONFIG.CANAL_LOGS_ID);
            if (!logsChannel) {
                return interaction.editReply({ content: `${CONFIG.EMOJIS.cancelar} Erro: O canal de logs não está configurado.` });
            }

            pedidosPendentes.add(interaction.user.id);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`aprovar_set_${role.id}_${interaction.user.id}_${nome}_${passaporte}`)
                    .setLabel('Aprovar e Dar Cargo')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('1520249613901103135'),
                new ButtonBuilder()
                    .setCustomId(`rejeitar_set_${interaction.user.id}`)
                    .setLabel('Rejeitar')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('1520249615318782022')
            );

            const payloadLog = v2({
                content: `## ${CONFIG.EMOJIS.ticket} Nova Solicitação de Set\n**Membro:** ${interaction.user} (\`${interaction.user.id}\`)\n**Cargo Solicitado:** ${role}\n\n📌 **Informações Enviadas:**\n${CONFIG.EMOJIS.info} **Nome in Game:** \`${nome}\`\n${CONFIG.EMOJIS.info} **Passaporte / ID:** \`${passaporte}\`\n${CONFIG.EMOJIS.info} **Recrutado por:** \`${recrutador}\``,
                imageUrl: interaction.user.displayAvatarURL({ extension: 'png', size: 128 }),
                thumbnailRight: true,
                footer: '-# NoxAssistant 2026 ©',
                accentColor: 0x2F3136
            }, [row]);

            await logsChannel.send(payloadLog);
            return interaction.editReply({ content: `${CONFIG.EMOJIS.sucesso} A tua solicitação para o cargo **${role.name}** foi enviada para análise da Staff!` });
        }

    }

    if (interaction.isButton()) {
        if (interaction.customId.startsWith('aprovar_set_')) {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
                return interaction.reply({ content: `${CONFIG.EMOJIS.cancelar} Apenas membros autorizados podem aprovar sets.`, flags: 64 });
            }

            const [, , roleId, userId, nomeInGame, passaporte] = interaction.customId.split('_');
            const role = interaction.guild.roles.cache.get(roleId);
            const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);

            if (!pedidosPendentes.has(userId)) {
                return interaction.reply({ content: `${CONFIG.EMOJIS.cancelar} Este pedido já foi processado!`, flags: 64 });
            }

            if (!targetMember || !role) {
                return interaction.reply({ content: `${CONFIG.EMOJIS.cancelar} Membro ou cargo não encontrado.`, flags: 64 });
            }

            try {
                await targetMember.roles.add(role);
                pedidosPendentes.delete(userId);

                let novoNick = `${role.name} 🎭 | ${nomeInGame} ${passaporte}`;
                if (novoNick.length > 32) novoNick = novoNick.substring(0, 32);

                await targetMember.setNickname(novoNick).catch(() => {});
                
                await interaction.deferUpdate();
                const mensagemConfirmacao = await interaction.followUp({ 
                    content: `${CONFIG.EMOJIS.sucesso} O pedido de ${targetMember} foi **aprovado** por ${interaction.user}. Cargo ${role} entregue e alcunha alterada para \`${novoNick}\`!` 
                });

                setTimeout(() => mensagemConfirmacao.delete().catch(() => {}), 3000);

                const embedDM = new EmbedBuilder()
                    .setTitle(`${CONFIG.EMOJIS.sucesso} Solicitação Aprovada!`)
                    .setDescription(`Olá ${targetMember}, a tua solicitação para o cargo **${role.name}** foi **aprovada**! Já recebeste o cargo e o teu nome foi atualizado para **${novoNick}**.`)
                    .setColor(0x57F287)
                    .setFooter({ text: 'NoxAssistant 2026 ©' });
                await targetMember.send({ embeds: [embedDM] }).catch(() => {});
            } catch (err) {
                await interaction.reply({ content: `${CONFIG.EMOJIS.aviso} Erro ao dar o cargo. Verifique a hierarquia de cargos do bot.`, flags: 64 });
            }
        }

        if (interaction.customId.startsWith('rejeitar_set_')) {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
                return interaction.reply({ content: `${CONFIG.EMOJIS.cancelar} Apenas membros autorizados podem rejeitar sets.`, flags: 64 });
            }

            const parts = interaction.customId.split('_');
            const userId = parts[2];
            const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
            if (!pedidosPendentes.has(userId)) {
                return interaction.reply({ content: `${CONFIG.EMOJIS.cancelar} Este pedido já foi processado!`, flags: 64 });
            }
            pedidosPendentes.delete(userId);

            await interaction.deferUpdate();
            await interaction.followUp({ content: `${CONFIG.EMOJIS.aviso} O pedido de ${targetMember ? targetMember : 'Membro'} foi **rejeitado** por ${interaction.user}.` });

            if (targetMember) {
                const embedDM = new EmbedBuilder()
                    .setTitle(`${CONFIG.EMOJIS.cancelar} Solicitação Rejeitada`)
                    .setDescription(`Olá ${targetMember}, a tua solicitação de Set foi **rejeitada** pela Staff.`)
                    .setColor(0xED4245)
                    .setFooter({ text: 'NoxAssistant 2026 ©' });
                await targetMember.send({ embeds: [embedDM] }).catch(() => {});
            }
        }

        if (interaction.customId.startsWith('fechar_ticket_')) {
            const chaveTicket = interaction.customId.replace('fechar_ticket_', '');
            const [abertoPorId] = chaveTicket.split('_');

            const ehStaff = interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)
                || (CONFIG.CARGO_STAFF_TICKETS_ID && interaction.member.roles.cache.has(CONFIG.CARGO_STAFF_TICKETS_ID));
            const ehDono = interaction.user.id === abertoPorId;

            if (!ehStaff && !ehDono) {
                return interaction.reply({ content: `${CONFIG.EMOJIS.cancelar} Apenas a Staff ou quem abriu o ticket pode fechá-lo.`, flags: 64 });
            }

            ticketsAbertos.delete(chaveTicket);
            await interaction.reply({ content: `${CONFIG.EMOJIS.sucesso} Ticket fechado por ${interaction.user}. Este canal vai ser apagado em 5 segundos...` });
            setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
        }
    }
});

client.login(process.env.TOKEN);
