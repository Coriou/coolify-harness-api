import { resolve } from 'node:path';
import { loadConfigModule, resolveTarget } from '../../config/load.js';
import { EXIT } from '../main.js';
export async function configDoctor(args) {
    const mod = await loadConfigModule(resolve(args.config));
    const targets = Object.keys(mod.registry.targets);
    process.stdout.write(`Config OK. Instances: ${Object.keys(mod.registry.instances).join(', ')}\n`);
    process.stdout.write(`Targets: ${targets.join(', ')}\n`);
    if (args.app) {
        // Validates the chosen target resolves + its token is present (throws MissingTokenError otherwise).
        resolveTarget(mod.registry, args.app, process.env);
        process.stdout.write(`Target '${args.app}' resolves and its token is present.\n`);
    }
    return EXIT.ok;
}
