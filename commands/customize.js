import { SlashCommandBuilder, ModalBuilder, LabelBuilder, FileUploadBuilder, TextInputBuilder, TextInputStyle} from 'discord.js';
import { getCustomSettings, updateCustomSettings } from '../database.js';

export default {
    data: new SlashCommandBuilder()
        .setName('customize')
        .setDescription('Customize embed content.'),

    async execute(interaction) {
        const serverId = interaction.guildId;
        const currentCustoms = await getCustomSettings(serverId);

        const modal = new ModalBuilder()
            .setCustomId('customize_modal')
            .setTitle('Bot Customization')
            .setLabelComponents(
                new LabelBuilder()
                    .setLabel("Bot Name")
                    .setTextInputComponent(
                        new TextInputBuilder()
                            .setCustomId('name')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder(currentCustoms.name)
                            .setRequired(false)
                    ),
                new LabelBuilder()
                    .setLabel('Embed Colour')
                    .setDescription('In Hex Format: #RRGGBB')
                    .setTextInputComponent(
                        new TextInputBuilder()
                            .setCustomId('color')
                            .setMaxLength(7)
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder(currentCustoms.color)
                            .setRequired(false)
                    ),
                new LabelBuilder()
                    .setLabel('Analyzing Message')
                    .setDescription('Message to show while analyzing (no markdown)')
                    .setTextInputComponent(
                        new TextInputBuilder()
                            .setCustomId('embed_search')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder(currentCustoms.embed_search)
                            .setRequired(false)
                    ),
                new LabelBuilder()
                    .setLabel('Result Message')
                    .setDescription('Message to show at success (no markdown)')
                    .setTextInputComponent(
                        new TextInputBuilder()
                            .setCustomId('embed_final')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder(currentCustoms.embed_final)
                            .setRequired(false)
                    ),
                new LabelBuilder()
                    .setLabel('Success Thumbnail')
                    .setDescription('`.png` or `.gif`')
                    .setFileUploadComponent(
                        new FileUploadBuilder()
                            .setCustomId('animation_upload')
                            .setMaxValues(1)
                            .setRequired(false)
                    ),
            )

        await interaction.showModal(modal);
    }
};

export async function handleCustomize(interaction){
    const fields = interaction.fields;
    const newSettings = {
        name: fields.getTextInputValue('name'),
        color: fields.getTextInputValue('color'),
        animation: fields.getUploadedFiles('animation_upload')?.url || null, 
        embed_search: fields.getTextInputValue('embed_search'),
        embed_final: fields.getTextInputValue('embed_final')
    };

    await updateCustomSettings(interaction.guildId, newSettings);
    await interaction.editReply("Bot Customized");

}