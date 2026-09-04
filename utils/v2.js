const {
    ContainerBuilder,
    TextDisplayBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    SectionBuilder,
    ThumbnailBuilder,
    MessageFlags
} = require('discord.js');

/**
 * Monta uma mensagem Components V2 (igual ao painel !pedirset):
 * imagem no topo, texto e botões no mesmo cartão.
 */
function v2({ content, imageUrl, footer, accentColor, thumbnailRight } = {}, extraRows = []) {
    const container = new ContainerBuilder();
    if (accentColor != null) container.setAccentColor(accentColor);

    const texto = footer ? `${content}\n\n${footer}` : content;

    if (imageUrl && !thumbnailRight) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(imageUrl)
            )
        );
    }

    if (imageUrl && thumbnailRight) {
        container.addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(texto))
                .setThumbnailAccessory(new ThumbnailBuilder().setURL(imageUrl))
        );
    } else {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(texto)
        );
    }

    for (const row of extraRows) {
        container.addActionRowComponents(row);
    }

    return {
        flags: MessageFlags.IsComponentsV2,
        components: [container]
    };
}

module.exports = { v2 };
