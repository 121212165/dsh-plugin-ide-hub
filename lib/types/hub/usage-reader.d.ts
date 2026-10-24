/** Per-IDE transcript readers. Each reader parses one tool's public JSONL
 * shape into a uniform record; unknown/malformed lines are skipped. No
 * proprietary format is written back — these are read-only passports. */
export interface UsageRecord {
    tool: string;
    sessionId: string;
    cwd?: string | undefined;
    at: string;
    day: string;
    model?: string | undefined;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
}
export interface SessionRef {
    tool: string;
    sessionId: string;
    cwd?: string | undefined;
    at: string;
    /** shell command that resumes this session in the original tool */
    resumeCommand: string | null;
}
export interface ClaudeLine {
    type?: string;
    sessionId?: string;
    timestamp?: string;
    cwd?: string;
    message?: {
        model?: string;
        usage?: {
            input_tokens?: number;
            output_tokens?: number;
            cache_read_input_tokens?: number;
            cache_creation_input_tokens?: number;
        };
    };
}
export declare function claudeRecord(line: ClaudeLine): UsageRecord | null;
export interface CodexLine {
    timestamp?: string;
    type?: string;
    payload?: {
        type?: string;
        info?: {
            total_token_usage?: {
                input_tokens?: number;
                cached_input_tokens?: number;
                output_tokens?: number;
                reasoning_output_tokens?: number;
            };
        };
        session_id?: string;
        cwd?: string;
    };
}
export declare function codexRecord(line: CodexLine): UsageRecord | null;
export declare function resumeCommand(tool: string, sessionId: string, sessionPath?: string): string | null;
//# sourceMappingURL=usage-reader.d.ts.map