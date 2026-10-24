import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
export function expandPath(path) {
    const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
    return path.replace(/^\{APPDATA\}/, appData).replace(/^~/, homedir());
}
function walk(root, spec, depth, state) {
    if (depth > 4 || !existsSync(root))
        return;
    let entries;
    try {
        entries = readdirSync(root);
    }
    catch {
        return;
    }
    for (const name of entries) {
        const full = join(root, name);
        let isDir = false;
        let mtimeMs = 0;
        let size = 0;
        try {
            const st = statSync(full);
            isDir = st.isDirectory();
            mtimeMs = st.mtimeMs;
            size = st.size;
        }
        catch {
            continue;
        }
        const isSessionFile = spec.sessionMatch.suffixes?.some((suffix) => name.endsWith(suffix)) ?? false;
        const isSessionDir = spec.sessionMatch.dirNames?.some((prefix) => name.startsWith(prefix) || name === prefix) ?? false;
        if (isSessionFile) {
            state.sessions++;
            state.bytes += size;
            state.lastActive = Math.max(state.lastActive ?? 0, mtimeMs);
            continue;
        }
        if (!isDir)
            continue;
        if (isSessionDir) {
            // a session-evidence directory counts as one session; its byte cost is
            // the files inside it (the dir stat size is meaningless on NTFS)
            state.sessions++;
            state.bytes += subtreeBytes(full, 3);
            state.lastActive = Math.max(state.lastActive ?? 0, mtimeMs);
            continue;
        }
        walk(full, spec, depth + 1, state);
    }
}
function subtreeBytes(root, depth) {
    if (depth <= 0 || !existsSync(root))
        return 0;
    let total = 0;
    let entries;
    try {
        entries = readdirSync(root);
    }
    catch {
        return 0;
    }
    for (const name of entries) {
        const full = join(root, name);
        try {
            const st = statSync(full);
            total += st.isDirectory() ? subtreeBytes(full, depth - 1) : st.size;
        }
        catch {
            // unreadable entry: skip
        }
    }
    return total;
}
export function inventory(spec) {
    const roots = [];
    for (const raw of spec.dataRoots) {
        const root = expandPath(raw);
        if (!existsSync(root)) {
            roots.push({ root, present: false, sessions: 0, bytes: 0, lastActive: null });
            continue;
        }
        const state = { sessions: 0, bytes: 0, lastActive: null };
        walk(root, spec, 0, state);
        roots.push({ root, present: true, sessions: state.sessions, bytes: state.bytes, lastActive: state.lastActive ? new Date(state.lastActive).toISOString() : null });
    }
    const presentRoots = roots.filter((root) => root.present);
    return {
        tool: spec.tool,
        vendor: spec.vendor,
        present: presentRoots.length > 0,
        sessions: presentRoots.reduce((total, root) => total + root.sessions, 0),
        bytes: presentRoots.reduce((total, root) => total + root.bytes, 0),
        lastActive: presentRoots.map((root) => root.lastActive).filter(Boolean).sort().at(-1) ?? null,
        roots,
    };
}
//# sourceMappingURL=inventory.js.map