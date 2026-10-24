/** Per-IDE transcript readers. Each reader parses one tool's public JSONL
 * shape into a uniform record; unknown/malformed lines are skipped. No
 * proprietary format is written back — these are read-only passports. */
function num(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}
function dayOf(iso) {
    return iso.slice(0, 10);
}
export function claudeRecord(line) {
    const usage = line.message?.usage;
    if (line.type !== 'assistant' || !usage || !line.timestamp || !line.sessionId)
        return null;
    const input = num(usage.input_tokens);
    const output = num(usage.output_tokens);
    const cacheRead = num(usage.cache_read_input_tokens);
    const cacheWrite = num(usage.cache_creation_input_tokens);
    if (input + output + cacheRead + cacheWrite === 0)
        return null;
    return {
        tool: 'claude-code',
        sessionId: line.sessionId,
        cwd: line.cwd,
        at: line.timestamp,
        day: dayOf(line.timestamp),
        model: line.message?.model,
        inputTokens: input,
        outputTokens: output,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
    };
}
export function codexRecord(line) {
    if (line.type !== 'event_msg')
        return null;
    const payload = line.payload;
    const total = payload?.info?.total_token_usage;
    if (payload?.type !== 'token_count' || !total || !line.timestamp)
        return null;
    const input = num(total.input_tokens);
    const output = num(total.output_tokens) + num(total.reasoning_output_tokens);
    const cacheRead = num(total.cached_input_tokens);
    return {
        tool: 'codex',
        sessionId: payload.session_id ?? 'unknown',
        at: line.timestamp,
        day: dayOf(line.timestamp),
        inputTokens: input,
        outputTokens: output,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: 0,
    };
}
// ---------- resume command mapping (Orca's pattern: per-CLI resume flags) ----------
export function resumeCommand(tool, sessionId, sessionPath) {
    switch (tool) {
        case 'claude-code':
            return `claude --resume ${sessionId}`;
        case 'codex':
            return `codex resume ${sessionId}`;
        case 'dsh':
            return `dsh --resume ${sessionId}`;
        case 'zcode':
            return `zcode --resume ${sessionId}`;
        case 'opencode':
            return sessionPath ? `opencode --session ${sessionPath}` : null;
        case 'pi':
            return sessionPath ? `pi --session ${sessionPath}` : null;
        default:
            return null; // private formats: no public resume flag known yet
    }
}
//# sourceMappingURL=usage-reader.js.map