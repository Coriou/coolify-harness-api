import type { ParsedArgs } from '../args.js';
export declare const HELP: string;
/** `help` / `--help` / `--version`: local, instant, never touches the config or the network. */
export declare function helpCmd(args?: Pick<ParsedArgs, 'version' | 'json'>): Promise<number>;
