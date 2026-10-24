/** Declarative registry of known IDEs' local data roots. Paths are absolute or
 * home-relative ('~'); {APPDATA} expands to the Windows roaming dir. Session
 * globs are simple suffix/prefix matchers — v0.1 does directory-level facts,
 * never parses proprietary message formats. */
export interface IdeSpec {
    tool: string;
    dataRoots: string[];
    /** files/dirs counted as "session evidence" under each root */
    sessionMatch: {
        suffixes?: string[];
        dirNames?: string[];
    };
    /** prompt/rules files to unify */
    promptFiles?: string[];
    vendor: 'domestic' | 'global';
}
export declare function defaultRegistry(): IdeSpec[];
//# sourceMappingURL=registry.d.ts.map