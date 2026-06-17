import { writeFile as fsWriteFile } from 'node:fs/promises';
import { z } from 'zod';
import { walkEnvSchema, mergeCatalogs, type CatalogModel } from './walk.js';
import { emitMarkdown } from './emit-markdown.js';
import { emitJson } from './emit-json.js';
import { emitDotenv } from './emit-dotenv.js';

export interface SchemaInput {
  service: string;
  schema: z.ZodTypeAny;
}

export interface CatalogArtifacts {
  markdown: string;
  json: string;
  dotenv: string;
  model: CatalogModel;
}

export interface GenerateOptions {
  schemas: SchemaInput[];
  out?: { markdown?: string; json?: string; dotenvExample?: string };
  writeFile?: (path: string, content: string) => Promise<void>;
}

export function buildArtifacts(schemas: SchemaInput[]): CatalogArtifacts {
  const perService = schemas.map((s) => walkEnvSchema(s.schema, { service: s.service }));
  const model = mergeCatalogs(perService);
  return { markdown: emitMarkdown(model), json: emitJson(model), dotenv: emitDotenv(model), model };
}

export async function generateCatalog(opts: GenerateOptions): Promise<CatalogArtifacts> {
  const artifacts = buildArtifacts(opts.schemas);
  const write = opts.writeFile ?? ((p: string, c: string): Promise<void> => fsWriteFile(p, c, 'utf8'));
  if (opts.out?.markdown) await write(opts.out.markdown, artifacts.markdown);
  if (opts.out?.json) await write(opts.out.json, artifacts.json);
  if (opts.out?.dotenvExample) await write(opts.out.dotenvExample, artifacts.dotenv);
  return artifacts;
}
