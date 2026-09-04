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
    AttachmentBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    SectionBuilder,
    MessageFlags
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const https = require('https');

const CONFIG = {
    PREFIXO: process.env.PREFIX || '!',
    CANAL_LOGS_ID: process.env.LOGS_CHANNEL_ID,
    CATEGORIA_TICKETS_ID: process.env.TICKETS_CATEGORY_ID,
    CARGO_STAFF_TICKETS_ID: process.env.STAFF_ROLE_ID,
    AUTOROLE_ID: process.env.AUTOROLE_ID,
    CARGO_VERIFICACAO_ID: process.env.VERIFICACAO_ROLE_ID || process.env.AUTOROLE_ID,
    // Troca a imagem: mete o ficheiro em assets/banner.jpg (ou .png)
    // OU cola um link aqui e apaga o ficheiro antigo em assets/
    BANNER_LOJA: process.env.LOJA_BANNER || 'https://cdn.discordapp.com/attachments/1534183602764648579/1545538781308915863/content.png?ex=6a9c82a8&is=6a9b3128&hm=034a3261aa3c0971f60b238bb04911c98fb91eb100f9d2171eb613992a0cddf0',
    BANNER_VERIFICACAO: process.env.VERIFICACAO_BANNER || process.env.LOJA_BANNER || 'https://cdn.discordapp.com/attachments/1534183602764648579/1545405851089768458/E38321D1-EC20-4C1C-853E-49B17BD42B90.png?ex=6a9c06db&is=6a9ab55b&hm=e43d7971bd59b37b93416ad024a948208bebb856eea7e8e9163d93879e6de3fa',
    TIPOS_TICKET: [
        { id_menu: 'ticket_suporte', nome: 'Suporte', desc: 'Abra um ticket de suporte', emoji: '🎫' },
        { id_menu: 'ticket_receber', nome: 'Receber Produto', desc: 'Abra um ticket para receber seu produto', emoji: '🛒' },
        { id_menu: 'ticket_duvidas', nome: 'Dúvidas', desc: 'Abra um ticket para tirar sua Dúvida', emoji: '❓' }
    ]
};

const PASTA_ASSETS = path.join(__dirname, 'assets');
const FICHEIRO_BANNER_LOJA = path.join(PASTA_ASSETS, 'banner-loja.png');
const FICHEIRO_BANNER_VERIFICACAO = path.join(PASTA_ASSETS, 'banner.png');

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

function botaoComprar() {
    return new ButtonBuilder()
        .setCustomId('btn_comprar')
        .setLabel('Comprar')
        .setEmoji('🛒')
        .setStyle(ButtonStyle.Secondary);
}

function textoPainelLoja() {
    return (
        '## NITRO GIFT GAMING\n' +
        '• Só clicar em resgatar\n' +
        '• Pega em todas as contas que já teve nitro\n' +
        '• Entrega automática no seu privado\n' +
        '• Chances bem minimas do nitro cair, quase nunca cai, compre ciente\n' +
        '• Não é necessário de cartão para ativar\n' +
        '• Nitro gift não possui garantia, apenas que vai ser entregue funcionando!\n\n' +
        'Pedimos que grave o processo da compra do início ao fim recebendo e resgatando no privado do bot, para que caso ocorra algum erro, possamos trocar o nitro, caso não tenha gravação,não será possível realizar a troca.\n\n' +
        '```ansi\n\u001b[2;32m⚡ Entrega Automática!\u001b[0m\n```'
    );
}

function rodapePainelLoja() {
    return (
        'Preço: **De R$ 8,99 a R$ 21,99**\n' +
        'Clique no botão **"Comprar"**'
    );
}

function baixarFicheiro(url, destino) {
    return new Promise((resolve, reject) => {
        const pedir = (alvo) => {
            https.get(alvo, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return pedir(res.headers.location);
                }
                if (res.statusCode !== 200) {
                    res.resume();
                    return reject(new Error(`HTTP ${res.statusCode}`));
                }
                fs.mkdirSync(path.dirname(destino), { recursive: true });
                const ficheiro = fs.createWriteStream(destino);
                res.pipe(ficheiro);
                ficheiro.on('finish', () => ficheiro.close(() => resolve(destino)));
                ficheiro.on('error', reject);
            }).on('error', reject);
        };
        pedir(url);
    });
}

async function garantirBanner(url, destino) {
    fs.mkdirSync(PASTA_ASSETS, { recursive: true });
    if (url && /^https?:\/\//i.test(url)) {
        try {
            await baixarFicheiro(url, destino);
        } catch (error) {
            console.warn('Não foi possível descarregar o banner:', error.message);
        }
    }
    return fs.existsSync(destino) ? destino : null;
}

function anexoBanner(ficheiro, urlFallback) {
    if (ficheiro && fs.existsSync(ficheiro) && fs.statSync(ficheiro).size > 1000) {
        const nome = path.basename(ficheiro);
        return {
            imageUrl: `attachment://${nome}`,
            files: [new AttachmentBuilder(ficheiro, { name: nome })]
        };
    }
    if (urlFallback) return { imageUrl: urlFallback, files: null };
    return null;
}

function botaoVerificar() {
    return new ButtonBuilder()
        .setCustomId('btn_verificar')
        .setLabel('Verificar')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Secondary);
}

function textoPainelVerificacao() {
    return (
        '## VERIFICAÇÃO\n' +
        '• Clique no botão para se verificar\n' +
        '• Libera o acesso aos canais do servidor\n' +
        '• Verificação imediata, só um clique\n\n' +
        '```ansi\n\u001b[2;32m✅ Verifique-se agora!\u001b[0m\n```'
    );
}

function rodapePainelVerificacao() {
    return (
        'Acesso ao servidor\n' +
        'Clique no botão **"Verificar"**'
    );
}

function montarPainelV2(texto, rodape, botao, anexo, urlFallback) {
    const container = new ContainerBuilder().setAccentColor(0x2b2d31);
    const imageUrl = anexo?.imageUrl || urlFallback || undefined;

    if (imageUrl) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(imageUrl)
            )
        );
    }

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(texto)
    );

    container.addSectionComponents(
        new SectionBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(rodape))
            .setButtonAccessory(botao)
    );

    const payload = {
        flags: MessageFlags.IsComponentsV2,
        components: [container]
    };
    if (anexo?.files) payload.files = anexo.files;
    return payload;
}

function payloadPainelLoja() {
    return montarPainelV2(
        textoPainelLoja(),
        rodapePainelLoja(),
        botaoComprar(),
        anexoBanner(FICHEIRO_BANNER_LOJA, CONFIG.BANNER_LOJA),
        CONFIG.BANNER_LOJA
    );
}

function payloadPainelVerificacao() {
    return montarPainelV2(
        textoPainelVerificacao(),
        rodapePainelVerificacao(),
        botaoVerificar(),
        anexoBanner(FICHEIRO_BANNER_VERIFICACAO, CONFIG.BANNER_VERIFICACAO),
        CONFIG.BANNER_VERIFICACAO
    );
}

function payloadLojaClassico() {
    const embed = new EmbedBuilder()
        .setTitle('NITRO GIFT GAMING')
        .setDescription(
            '• Só clicar em resgatar\n' +
            '• Pega em todas as contas que já teve nitro\n' +
            '• Entrega automática no seu privado\n' +
            '• Chances bem minimas do nitro cair, quase nunca cai, compre ciente\n' +
            '• Não é necessário de cartão para ativar\n' +
            '• Nitro gift não possui garantia, apenas que vai ser entregue funcionando!\n\n' +
            'Pedimos que grave o processo da compra do início ao fim recebendo e resgatando no privado do bot, para que caso ocorra algum erro, possamos trocar o nitro, caso não tenha gravação,não será possível realizar a troca.\n\n' +
            '```ansi\n\u001b[2;32m⚡ Entrega Automática!\u001b[0m\n```\n' +
            'Preço: **De R$ 8,99 a R$ 21,99**\n' +
            'Clique no botão **"Comprar"**'
        )
        .setColor(0x2b2d31);

    const payload = {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(botaoComprar())]
    };

    const anexo = anexoBanner(FICHEIRO_BANNER_LOJA, CONFIG.BANNER_LOJA);
    if (anexo?.files) {
        embed.setImage(anexo.imageUrl);
        payload.files = anexo.files;
    } else if (CONFIG.BANNER_LOJA) {
        embed.setImage(CONFIG.BANNER_LOJA);
    }
    return payload;
}

async function publicarPainelLoja(channel) {
    await garantirBanner(CONFIG.BANNER_LOJA, FICHEIRO_BANNER_LOJA);
    try {
        return await channel.send(payloadPainelLoja());
    } catch (error) {
        console.warn('Painel V2 falhou, a usar embed:', error.message);
        return channel.send(payloadLojaClassico());
    }
}

function payloadVerificacaoClassico() {
    const embed = new EmbedBuilder()
        .setTitle('VERIFICAÇÃO')
        .setDescription(
            '• Clique no botão para se verificar\n' +
            '• Libera o acesso aos canais do servidor\n' +
            '• Verificação imediata, só um clique\n\n' +
            '```ansi\n\u001b[2;32m✅ Verifique-se agora!\u001b[0m\n```\n' +
            'Clique no botão **"Verificar"**'
        )
        .setColor(0x2b2d31);

    const payload = {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(botaoVerificar())]
    };

    const anexo = anexoBanner(FICHEIRO_BANNER_VERIFICACAO, CONFIG.BANNER_VERIFICACAO);
    if (anexo?.files) {
        embed.setImage(anexo.imageUrl);
        payload.files = anexo.files;
    } else if (CONFIG.BANNER_VERIFICACAO) {
        embed.setImage(CONFIG.BANNER_VERIFICACAO);
    }
    return payload;
}

async function publicarPainelVerificacao(channel) {
    await garantirBanner(CONFIG.BANNER_VERIFICACAO, FICHEIRO_BANNER_VERIFICACAO);
    try {
        return await channel.send(payloadPainelVerificacao());
    } catch (error) {
        console.warn('Painel V2 de verificação falhou, a usar embed:', error.message);
        return channel.send(payloadVerificacaoClassico());
    }
}

function nomeComando(texto) {
    return String(texto || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

client.once('clientReady', aoFicarOnline);
client.once('ready', aoFicarOnline);

async function aoFicarOnline() {
    if (client.user.__lojaReady) return;
    client.user.__lojaReady = true;
    console.log(`🤖 Bot ${client.user.tag} Online e pronto para vender!`);
    try {
        await garantirBanner(CONFIG.BANNER_LOJA, FICHEIRO_BANNER_LOJA);
        await garantirBanner(CONFIG.BANNER_VERIFICACAO, FICHEIRO_BANNER_VERIFICACAO);
        console.log(`📁 Pasta do banner: ${PASTA_ASSETS}`);
    } catch (error) {
        console.warn('Não foi possível criar a pasta assets:', error.message);
    }
    try {
        for (const guild of client.guilds.cache.values()) {
            const cmds = await guild.commands.fetch();
            const nomes = new Set([...cmds.values()].map((c) => c.name));
            if (!nomes.has('loja')) {
                await guild.commands.create({
                    name: 'loja',
                    description: 'Publica o painel da loja neste canal'
                });
            }
            if (!nomes.has('verificacao')) {
                await guild.commands.create({
                    name: 'verificacao',
                    description: 'Publica o painel de verificação neste canal'
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
    const commandName = nomeComando(args.shift() || '');

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

    if (commandName === 'verificacao' || commandName === 'verificar') {
        try {
            await publicarPainelVerificacao(message.channel);
            message.delete().catch(() => {});
        } catch (error) {
            console.error('Erro no !verificacao:', error);
            await message.channel.send({ content: `Não consegui publicar a verificação: \`${error.message}\`` }).catch(() => {});
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
    if (interaction.isChatInputCommand() && interaction.commandName === 'verificacao') {
        try {
            await interaction.deferReply({ flags: 64 });
            await publicarPainelVerificacao(interaction.channel);
            return interaction.editReply({ content: 'Painel de verificação publicado neste canal.' });
        } catch (error) {
            console.error('Erro no /verificacao:', error);
            const msg = `Não consegui publicar a verificação: \`${error.message}\``;
            if (interaction.deferred || interaction.replied) return interaction.editReply({ content: msg });
            return interaction.reply({ content: msg, flags: 64 });
        }
    }

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

    if (interaction.isButton() && interaction.customId === 'btn_verificar') {
        const cargoId = CONFIG.CARGO_VERIFICACAO_ID;
        if (!cargoId) {
            return interaction.reply({
                content: 'Falta definir o cargo. No `.env` mete `VERIFICACAO_ROLE_ID=id_do_cargo`.',
                flags: 64
            });
        }

        try {
            const member = interaction.member || await interaction.guild.members.fetch(interaction.user.id);
            const cargo = interaction.guild.roles.cache.get(cargoId);
            if (!cargo) {
                return interaction.reply({ content: 'O cargo de verificação não existe neste servidor.', flags: 64 });
            }
            if (member.roles.cache.has(cargoId)) {
                return interaction.reply({ content: 'Já estás verificado.', flags: 64 });
            }
            await member.roles.add(cargo);
            return interaction.reply({ content: '✅ Verificado com sucesso. Já tens acesso ao servidor.', flags: 64 });
        } catch (error) {
            console.error('Erro no btn_verificar:', error);
            return interaction.reply({
                content: 'Não consegui verificar. Confirma que o bot tem permissão **Gerir Cargos** e que o cargo dele está acima do cargo de membro.',
                flags: 64
            });
        }
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
