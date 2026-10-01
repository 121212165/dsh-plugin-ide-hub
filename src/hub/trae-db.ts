import { DatabaseSync } from 'node:sqlite';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Trae (CN) chat reader (v0.4). One workspaceStorage dir per project; the AI
 * chat lives in state.vscdb under key 'memento/icube-ai-agent-storage' as
 * {list: [{sessionId, title, createdAt, updatedAt, messages: [{role, content,
 * modelInfo: {display_model_name}}], hasMore}]} — including per-message model
 * names. Chat bodies may be server-paginated (hasMore + nextPageToken): local
 * data is a partial view and the reader reports it as such. Read-only. */

export interface TraeChatSession {
  sessionId: string;
  title: string;
  workspaceFolder?: string;
  createdAt?: string;
  updatedAt?: string;
  localMessages: number;
  hasMore: boolean;
  models: string[]; // per-message display model names, in order
}

export interface TraeInventory {
  workspaces: TraeWorkspace[];
  totalSessions: number;
  totalLocalMessages: number;
}

export interface TraeWorkspace {
  storageId: string;
  folder?: string;
  sessions: number;
  localMessages: number;
  lastActive: string | null;
  dbPath: string;
}

export function traeRoots(): string[] {
  const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
  return [join(appData, 'Trae CN', 'User', 'workspaceStorage'), join(appData, 'Trae', 'User', 'workspaceStorage')];
}

function decodeFolder(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw.replace(/^file:\/\/\//, ''));
  } catch {
    return raw;
  }
}

interface AgentStorage {
  list?: {
    sessionId?: string;
    title?: string;
    name?: string;
    createdAt?: string;
    updatedAt?: string;
    messages?: { role?: string; content?: unknown; modelInfo?: { display_model_name?: string } }[];
    hasMore?: boolean;
  }[];
}

function stampOf(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return new Date(value).toISOString();
  return typeof value === 'string' ? value : '';
}

function readWorkspace(dbPath: string): { sessions: number; localMessages: number; lastActive: string | null } {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare("SELECT value FROM ItemTable WHERE key = 'memento/icube-ai-agent-storage'").get() as { value: string } | undefined;
    if (!row) return { sessions: 0, localMessages: 0, lastActive: null };
    const data = JSON.parse(row.value) as AgentStorage;
    const list = data.list ?? [];
    let localMessages = 0;
    let lastActive: string | null = null;
    for (const session of list) {
      localMessages += session.messages?.length ?? 0;
      const stamp = stampOf(session.updatedAt ?? session.createdAt);
      if (stamp && (!lastActive || stamp > lastActive)) lastActive = stamp;
    }
    return { sessions: list.length, localMessages, lastActive };
  } finally {
    db.close();
  }
}

export function scanTrae(roots: string[] = traeRoots()): TraeInventory {
  const workspaces: TraeWorkspace[] = [];
  let totalLocalMessages = 0;
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const storageId of readdirSync(root)) {
      const dir = join(root, storageId);
      const dbPath = join(dir, 'state.vscdb');
      if (!existsSync(dbPath)) continue;
      let folder: string | undefined;
      const wj = join(dir, 'workspace.json');
      if (existsSync(wj)) {
        try {
          folder = decodeFolder(JSON.parse(readFileSync(wj, 'utf8')).folder);
        } catch {
          // malformed workspace.json: folder stays unknown
        }
      }
      try {
        const { sessions, localMessages, lastActive } = readWorkspace(dbPath);
        workspaces.push({ storageId, folder, sessions, localMessages, lastActive, dbPath });
        totalLocalMessages += localMessages;
      } catch {
        continue; // locked or corrupt vscdb: skip this workspace
      }
    }
  }
  return { workspaces, totalSessions: workspaces.reduce((total, ws) => total + ws.sessions, 0), totalLocalMessages };
}

/** Chat sessions with local message bodies, newest first. */
/** Trae mixes ISO strings and epoch-ms numbers for timestamps. */
function stamp(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return new Date(value).toISOString();
  return typeof value === 'string' ? value : '';
}

export function traeChatSessions(inventory: TraeInventory, limit = 20): TraeChatSession[] {
  const sessions: TraeChatSession[] = [];
  for (const ws of inventory.workspaces) {
    if (!existsSync(ws.dbPath)) continue;
    try {
      const db = new DatabaseSync(ws.dbPath, { readOnly: true });
      const row = db.prepare("SELECT value FROM ItemTable WHERE key = 'memento/icube-ai-agent-storage'").get() as { value: string } | undefined;
      db.close();
      if (!row) continue;
      const data = JSON.parse(row.value) as AgentStorage;
      for (const session of data.list ?? []) {
        if (!session.sessionId) continue;
        sessions.push({
          sessionId: session.sessionId,
          title: session.title ?? session.name ?? '(untitled)',
          workspaceFolder: ws.folder,
          createdAt: stamp(session.createdAt) || undefined,
          updatedAt: stamp(session.updatedAt) || undefined,
          localMessages: session.messages?.length ?? 0,
          hasMore: session.hasMore ?? false,
          models: [...new Set((session.messages ?? []).map((message) => message.modelInfo?.display_model_name).filter((model): model is string => Boolean(model)))],
        });
      }
    } catch {
      // locked or corrupt: skip
    }
  }
  return sessions.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')).slice(0, limit);
}
