// deploy-commands.js
// Corre isto uma vez (e sempre que mudares os comandos) com: npm run deploy

require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('produto-criar')
    .setDescription('Cria um novo jogo à venda na loja')
    .addStringOption((o) => o.setName('nome').setDescription('Nome do jogo').setRequired(true))
    .addNumberOption((o) =>
      o.setName('preco').setDescription('Preço (ex: 9.99)').setRequired(true)
    )
    .addStringOption((o) =>
      o.setName('descricao').setDescription('Descrição curta do jogo').setRequired(false)
    )
    .addStringOption((o) =>
      o
        .setName('moeda')
        .setDescription('Moeda (padrão: eur)')
        .addChoices({ name: 'EUR (€)', value: 'eur' }, { name: 'USD ($)', value: 'usd' })
        .setRequired(false)
    )
    .addRoleOption((o) =>
      o
        .setName('cargo')
        .setDescription('Cargo a atribuir automaticamente após a compra (opcional)')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('chave-adicionar')
    .setDescription('Adiciona chaves ao stock de um produto (um ficheiro .txt, uma chave por linha)')
    .addIntegerOption((o) =>
      o.setName('produto_id').setDescription('ID do produto (vê em /produtos)').setRequired(true)
    )
    .addAttachmentOption((o) =>
      o.setName('ficheiro').setDescription('Ficheiro .txt com uma chave por linha').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('produtos')
    .setDescription('Lista os produtos e o stock de chaves disponível')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('loja')
    .setDescription('Publica a loja com botões de compra neste canal')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
].map((c) => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('A registar slash commands...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log('Comandos registados com sucesso!');
  } catch (err) {
    console.error(err);
  }
})();
