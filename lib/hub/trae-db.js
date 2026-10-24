import { DatabaseSync } from 'node:sqlite';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
export function traeRoots() {
    const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
    return [join(appData, 'Trae CN', 'User', 'workspaceStorage'), join(appData, 'Trae', 'User', 'workspaceStorage')];
}
function decodeFolder(raw) {
    if (!raw)
        return undefined;
    try {
        return decodeURIComponent(raw.replace(/^file:\/\/\//, ''));
    }
    catch {
        return raw;
    }
}
function stampOf(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0)
        return new Date(value).toISOString();
    return typeof value === 'string' ? value : '';
}
function readWorkspace(dbPath) {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
        const row = db.prepare("SELECT value FROM ItemTable WHERE key = 'memento/icube-ai-agent-storage'").get();
        if (!row)
            return { sessions: 0, localMessages: 0, lastActive: null };
        const data = JSON.parse(row.value);
        const list = data.list ?? [];
        let localMessages = 0;
        let lastActive = null;
        for (const session of list) {
            localMessages += session.messages?.length ?? 0;
            const stamp = stampOf(session.updatedAt ?? session.createdAt);
            if (stamp && (!lastActive || stamp > lastActive))
                lastActive = stamp;
        }
        return { sessions: list.length, localMessages, lastActive };
    }
    finally {
        db.close();
    }
}
export function scanTrae(roots = traeRoots()) {
    const workspaces = [];
    let totalLocalMessages = 0;
    for (const root of roots) {
        if (!existsSync(root))
            continue;
        for (const storageId of readdirSync(root)) {
            const dir = join(root, storageId);
            const dbPath = join(dir, 'state.vscdb');
            if (!existsSync(dbPath))
                continue;
            let folder;
            const wj = join(dir, 'workspace.json');
            if (existsSync(wj)) {
                try {
                    folder = decodeFolder(JSON.parse(readFileSync(wj, 'utf8')).folder);
                }
                catch {
                    // malformed workspace.json: folder stays unknown
                }
            }
            try {
                const { sessions, localMessages, lastActive } = readWorkspace(dbPath);
                workspaces.push({ storageId, folder, sessions, localMessages, lastActive, dbPath });
                totalLocalMessages += localMessages;
            }
            catch {
                continue; // locked or corrupt vscdb: skip this workspace
            }
        }
    }
    return { workspaces, totalSessions: workspaces.reduce((total, ws) => total + ws.sessions, 0), totalLocalMessages };
}
/** Chat sessions with local message bodies, newest first. */
/** Trae mixes ISO strings and epoch-ms numbers for timestamps. */
function stamp(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0)
        return new Date(value).toISOString();
    return typeof value === 'string' ? value : '';
}
export function traeChatSessions(inventory, limit = 20) {
    const sessions = [];
    for (const ws of inventory.workspaces) {
        if (!existsSync(ws.dbPath))
            continue;
        try {
            const db = new DatabaseSync(ws.dbPath, { readOnly: true });
            const row = db.prepare("SELECT value FROM ItemTable WHERE key = 'memento/icube-ai-agent-storage'").get();
            db.close();
            if (!row)
                continue;
            const data = JSON.parse(row.value);
            for (const session of data.list ?? []) {
                if (!session.sessionId)
                    continue;
                sessions.push({
                    sessionId: session.sessionId,
                    title: session.title ?? session.name ?? '(untitled)',
                    workspaceFolder: ws.folder,
                    createdAt: stamp(session.createdAt) || undefined,
                    updatedAt: stamp(session.updatedAt) || undefined,
                    localMessages: session.messages?.length ?? 0,
                    hasMore: session.hasMore ?? false,
                    models: [...new Set((session.messages ?? []).map((message) => message.modelInfo?.display_model_name).filter((model) => Boolean(model)))],
                });
            }
        }
        catch {
            // locked or corrupt: skip
        }
    }
    return sessions.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')).slice(0, limit);
}
//# sourceMappingURL=trae-db.js.map