import { writeFile as fsWriteFile } from 'node:fs/promises';
import { z } from 'zod';
import { walkEnvSchema, mergeCatalogs } from './walk.js';
import { emitMarkdown } from './emit-markdown.js';
import { emitJson } from './emit-json.js';
import { emitDotenv } from './emit-dotenv.js';
export function buildArtifacts(schemas) {
    const perService = schemas.map((s) => walkEnvSchema(s.schema, { service: s.service }));
    const model = mergeCatalogs(perService);
    return { markdown: emitMarkdown(model), json: emitJson(model), dotenv: emitDotenv(model), model };
}
export async function generateCatalog(opts) {
    const artifacts = buildArtifacts(opts.schemas);
    const write = opts.writeFile ?? ((p, c) => fsWriteFile(p, c, 'utf8'));
    if (opts.out?.markdown)
        await write(opts.out.markdown, artifacts.markdown);
    if (opts.out?.json)
        await write(opts.out.json, artifacts.json);
    if (opts.out?.dotenvExample)
        await write(opts.out.dotenvExample, artifacts.dotenv);
    return artifacts;
}
