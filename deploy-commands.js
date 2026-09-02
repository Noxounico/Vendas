// deploy-commands.js
// Regista os slash commands no Discord.
// Corre com: npm run deploy
//
// Precisa no .env de:
//   DISCORD_TOKEN=...
//   CLIENT_ID=...        (ID da aplicação, no Developer Portal -> General Information)
//   GUILD_ID=...          (opcional: ID do servidor, para registo instantâneo só nesse servidor)

require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const commands = [
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
        .setDescription('Moeda (eur, usd, ...)')
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
    .setDescription('Publica a loja neste canal'),
].map((cmd) => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    if (!process.env.CLIENT_ID) {
      console.error('❌ Falta CLIENT_ID no .env — vai ao Developer Portal > General Information.');
      process.exit(1);
    }

    if (process.env.GUILD_ID) {
      // Registo por servidor: aparece quase de imediato.
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body: commands }
      );
      console.log(`✅ ${commands.length} comandos registados no servidor ${process.env.GUILD_ID}.`);
    } else {
      // Registo global: pode demorar até ~1 hora a propagar.
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
      console.log(`✅ ${commands.length} comandos registados globalmente (pode demorar até 1h a aparecer).`);
    }
  } catch (err) {
    console.error('❌ Erro ao registar comandos:', err);
    process.exit(1);
  }
})();
