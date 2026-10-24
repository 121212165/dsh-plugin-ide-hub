/** M5: the pointer generator — one project-level source of truth (.hub/AGENTS.md)
 * plus a marker-delimited block dropped into each tool's project rule file.
 *
 * Everything here is pure: it takes the existing file contents in and hands the
 * bytes to write back out, so idempotency, "never clobber the user", and the
 * zero-residue uninstall are testable without touching a disk.
 */
export declare const POINTER_BEGIN = "<!-- hub-pointer:start dsh-plugin-ide-hub v1 -->";
export declare const POINTER_END = "<!-- hub-pointer:end dsh-plugin-ide-hub v1 -->";
export type PointerMode = 'block' | 'manual';
export interface PointerSpec {
    tool: string;
    /** path inside the project, relative to its root; empty for a manual handoff */
    path: string;
    mode: PointerMode;
    /** why this is the right attach point, said out loud in the command output */
    note: string;
}
/** Every path below was read out of the installed vendor binary on this machine
 * (2026-10-02), not from docs. Project-root AGENTS.md is the shared convention the
 * four CLI tools read, and Qoder's and CatPaw's runtimes look it up too, so one
 * file covers seven of the eight. Trae is the exception: its project-root AGENTS.md
 * support is a settings toggle ("Include AGENTS.md in the context"), so it gets its
 * own rules file — and the installed CN build ships a second rules directory, hence
 * two Trae entries.
 */
export declare const POINTER_SPECS: readonly PointerSpec[];
/** The rule body every pointer refers to. Relative paths keep it portable. */
export declare const HUB_BODY = ".hub/AGENTS.md";
export declare const HUB_FILES: readonly [".hub/AGENTS.md", '.hub/STRUCTURE.json', '.hub/PROJECT_NOTES.md'];
export declare function pointerBlock(hubFile?: string): string;
export declare function hasPointer(content: string): boolean;
/** Everything outside the managed block, with the blank line the block was
 * separated by taken back too — so an uninstall leaves no trailing scar. */
export declare function stripPointer(content: string): string;
export type MergeAction = 'noop' | 'rewrite' | 'append' | 'create';
export interface MergeResult {
    action: MergeAction;
    content: string;
}
/** Idempotent attach: never duplicate the block, never drop the user's own text.
 * `existing === null` means the file does not exist yet. */
export declare function mergePointer(existing: string | null, block?: string): MergeResult;
/** Remove our block; a file that had nothing else in it should be deleted. */
export declare function unmergePointer(existing: string): {
    content: string;
    deleteFile: boolean;
};
export interface PointerTarget {
    path: string;
    tools: string[];
    notes: string[];
}
/** Group specs by file so five tools sharing AGENTS.md produce one write. */
export declare function pointerTargets(tools?: string[]): {
    block: PointerTarget[];
    manual: PointerSpec[];
};
export interface TreeEntry {
    path: string;
    kind: 'dir' | 'file';
    size?: number;
}
/** The generated STRUCTURE.json — a snapshot a reader can trust about staleness. */
export declare function renderStructureJson(project: string, entries: TreeEntry[], now?: Date): string;
/** The rule body. Created once and then never overwritten: it is the user's file. */
export declare function renderHubAgents(project: string): string;
/** The working-notes file: a checklist, not a document nobody fills in. */
export declare function renderProjectNotes(project: string): string;
//# sourceMappingURL=pointers.d.ts.map