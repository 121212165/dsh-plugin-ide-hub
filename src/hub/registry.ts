/** Declarative registry of known IDEs' local data roots. Paths are absolute or
 * home-relative ('~'); {APPDATA} expands to the Windows roaming dir. Session
 * globs are simple suffix/prefix matchers — v0.1 does directory-level facts,
 * never parses proprietary message formats. */

export interface IdeSpec {
  tool: string;
  dataRoots: string[];
  /** files/dirs counted as "session evidence" under each root */
  sessionMatch: { suffixes?: string[]; dirNames?: string[] };
  /** prompt/rules files to unify */
  promptFiles?: string[];
  vendor: 'domestic' | 'global';
}

export function defaultRegistry(): IdeSpec[] {
  return [
    {
      tool: 'zcode',
      dataRoots: ['~/.zcode/cli', '~/.zcode/sessions'],
      sessionMatch: { dirNames: ['agents', 'artifacts', 'exec'], suffixes: ['.jsonl'] },
      promptFiles: ['~/.zcode/cli/AGENTS.md'],
      vendor: 'domestic',
    },
    {
      tool: 'claude-code',
      dataRoots: ['~/.claude/projects'],
      sessionMatch: { suffixes: ['.jsonl'] },
      promptFiles: ['~/.claude/CLAUDE.md', '~/.claude/AGENTS.md'],
      vendor: 'global',
    },
    {
      tool: 'codex',
      dataRoots: ['~/.codex/sessions'],
      sessionMatch: { suffixes: ['.jsonl'] },
      promptFiles: ['~/.codex/AGENTS.md'],
      vendor: 'global',
    },
    {
      tool: 'opencode',
      dataRoots: ['~/.local/share/opencode'],
      sessionMatch: { dirNames: ['storage', 'snapshot'] },
      promptFiles: ['~/.config/opencode/AGENTS.md'],
      vendor: 'global',
    },
    {
      tool: 'trae',
      dataRoots: ['{APPDATA}/Trae CN/User/workspaceStorage', '{APPDATA}/Trae/User/workspaceStorage'],
      sessionMatch: { dirNames: ['chat', 'sessions', 'workspaceStorage'] },
      vendor: 'domestic',
    },
    {
      tool: 'qoder',
      dataRoots: ['~/.qoder'],
      sessionMatch: { dirNames: ['canvas', 'cache'] },
      vendor: 'domestic',
    },
    {
      tool: 'catpaw',
      dataRoots: ['~/.meituan-catpaw'],
      sessionMatch: { dirNames: ['agent-host', 'logs'], suffixes: ['.jsonl'] },
      vendor: 'domestic',
    },
    {
      tool: 'dsh',
      dataRoots: ['~/.dsh/sessions'],
      sessionMatch: { dirNames: ['session-'], suffixes: ['.jsonl'] },
      vendor: 'global',
    },
  ];
}
