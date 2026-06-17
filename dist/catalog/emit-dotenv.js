export function emitDotenv(model) {
    const blocks = model.map((e) => {
        const lines = [];
        if (e.description)
            lines.push(`# ${e.description}`);
        lines.push(`# type: ${e.type} | required: ${e.required ? 'yes' : 'no'} | services: ${e.services.join(', ')}`);
        lines.push(`${e.key}=${e.default ?? ''}`);
        return lines.join('\n');
    });
    return `${blocks.join('\n\n')}\n`;
}
