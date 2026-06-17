export function emitJson(model) {
    return `${JSON.stringify(model, null, 2)}\n`;
}
