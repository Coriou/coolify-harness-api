export declare const EXIT: {
    readonly ok: 0;
    readonly internal: 1;
    readonly usage: 2;
    readonly catalogStale: 3;
    readonly drift: 4;
    readonly authScope: 5;
    readonly lockedVar: 6;
};
export declare function errorToExitCode(err: unknown): number;
export declare function main(argv: string[]): Promise<number>;
