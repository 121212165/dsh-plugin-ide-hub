import type { IdeSpec } from './registry.ts';
/** M1: directory-level session inventory. Counts session-evidence files/dirs,
 * sums sizes, and takes the newest mtime as last-active. Never reads message
 * content — proprietary formats stay untouched. */
export interface IdeInventory {
    tool: string;
    vendor: 'domestic' | 'global';
    present: boolean;
    sessions: number;
    bytes: number;
    lastActive: string | null;
    roots: {
        root: string;
        present: boolean;
        sessions: number;
        bytes: number;
        lastActive: string | null;
    }[];
}
export declare function expandPath(path: string): string;
export declare function inventory(spec: IdeSpec): IdeInventory;
//# sourceMappingURL=inventory.d.ts.map