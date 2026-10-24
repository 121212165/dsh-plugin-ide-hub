/** Trae (CN) chat reader (v0.4). One workspaceStorage dir per project; the AI
 * chat lives in state.vscdb under key 'memento/icube-ai-agent-storage' as
 * {list: [{sessionId, title, createdAt, updatedAt, messages: [{role, content,
 * modelInfo: {display_model_name}}], hasMore}]} — including per-message model
 * names. Chat bodies may be server-paginated (hasMore + nextPageToken): local
 * data is a partial view and the reader reports it as such. Read-only. */
export interface TraeChatSession {
    sessionId: string;
    title: string;
    workspaceFolder?: string | undefined;
    createdAt?: string | undefined;
    updatedAt?: string | undefined;
    localMessages: number;
    hasMore: boolean;
    models: string[];
}
export interface TraeInventory {
    workspaces: TraeWorkspace[];
    totalSessions: number;
    totalLocalMessages: number;
}
export interface TraeWorkspace {
    storageId: string;
    folder?: string | undefined;
    sessions: number;
    localMessages: number;
    lastActive: string | null;
    dbPath: string;
}
export declare function traeRoots(): string[];
export declare function scanTrae(roots?: string[]): TraeInventory;
export declare function traeChatSessions(inventory: TraeInventory, limit?: number): TraeChatSession[];
//# sourceMappingURL=trae-db.d.ts.map