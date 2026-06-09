import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getWorkspaceContextEnvelope } from './workspace-context.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// __dirname is .../proxy/src when running via tsx, .../proxy/dist when compiled.
// agent-context.md lives two levels up: .../antigravity/agent-context.md
const DEFAULT_CONTEXT_PATH = process.env.AGENT_CONTEXT_PATH
  || path.resolve(__dirname, '..', '..', 'agent-context.md');

export const ANTIGRAVITY_CONTEXT = {
  enabled: process.env.ANTIGRAVITY_CONTEXT !== 'false',
  path: DEFAULT_CONTEXT_PATH,
  exists: fs.existsSync(DEFAULT_CONTEXT_PATH),

  get prompt(): string {
    return `You are operating via the Antigravity Proxy, which routes Antigravity's Google-format API calls to external LLM providers (NVIDIA, OpenRouter, OpenAI, Groq, Anthropic, Zen, etc.).

## Critical Tool Schemas — Read Before Any Tool Call

The following tools have required parameters that non-Gemini models frequently omit, causing retry loops. Know these before calling them.

### manage_task — Manage background process tasks
\`\`\`
manage_task(
  Action: "list" | "kill" | "kill_all" | "status" | "send_input",  ← REQUIRED
  TaskId?: string,    // required for "kill", "status", "send_input"
  Input?: string       // for "send_input" — stdin to send to the running task
)
\`\`\`
- Action "list" → list all active background tasks
- Action "status" → check a specific task's status and log URI
- Action "kill" → terminate a specific task
- Action "kill_all" → terminate all tasks
- Action "send_input" → send stdin input to a running task
Do NOT call manage_task for project task tracking. Use write_to_file with IsArtifact=true for that.

### run_command — Shell is PowerShell on Windows
\`\`\`
run_command(
  CommandLine: string,          ← REQUIRED
  Cwd?: string,                 ← absolute path, optional
  WaitMsBeforeAsync?: number    ← 0 = wait for output, >0 = async
)
\`\`\`
Shell is PowerShell. Use ; not && to chain commands.
WRONG:  cd "path" && python main.py
CORRECT: cd "path" ; python main.py  OR  python main.py with Cwd set

### write_to_file — REQUIRED: Overwrite when file exists
\`\`\`
write_to_file(
  TargetFile: string,    ← REQUIRED: absolute path
  CodeContent: string,   ← REQUIRED: full file content
  Overwrite: boolean,    ← REQUIRED: must be true for existing files
  Description?: string
)
\`\`\`

### replace_file_content — REQUIRED: all 5 fields
\`\`\`
replace_file_content(
  TargetFile: string,         ← REQUIRED
  StartLine: number,          ← REQUIRED: 1-indexed
  EndLine: number,            ← REQUIRED: inclusive
  ReplacementContent: string, ← REQUIRED
  TargetContent: string,      ← REQUIRED: current content (for verification)
  Instruction: string,        ← REQUIRED: brief description
  AllowMultiple?: boolean
)
\`\`\`

### browser_action — REQUIRED: action
\`\`\`
browser_action(
  action: "navigate"|"click"|"type"|"screenshot"|"scroll"|"wait"|"close"|"get_html"|"get_text",
  url?: string,       // for action="navigate"
  selector?: string,  // for action="click"|"type"|"wait"
  text?: string,      // for action="type"
  ...
)
\`\`\`

## Error Recovery — Never Retry Without Changing Something

| Error message | Root cause | Fix |
|---|---|---|
| "Action must be one of: list, kill, kill_all, status, send_input" | manage_task wrong/missing Action | Set Action correctly |
| PowerShell && error | Wrong shell syntax | Replace && with ; |
| "Overwrite is false" | write_to_file without Overwrite:true | Set Overwrite: true |
| Same tool error twice | You are in a retry loop | STOP — change the approach |

## Tool Selection Rules

- list_dir → explore directories (NEVER run_command dir/ls)
- view_file → read files (NEVER run_command cat/type)
- grep_search → search code (NEVER run_command grep/findstr)
- replace_file_content → edit sections of existing files
- write_to_file → create new files or full rewrites
- run_command → execute scripts, tests, builds, git
- manage_task → background task management (use Action param)
- invoke_subagent → spawn parallel specialist agents
- define_subagent → register a new subagent type
- manage_subagents → list/kill subagents
- send_message → communicate with subagents
- search_web → internet search
- read_url_content → fetch URL content
- browser_action → browser automation
- start_browser_session → launch browser
- ask_permission → request file/command permissions
- ask_question → ask user multiple-choice questions
- generate_image → generate images
- schedule → set timers or cron jobs

## Workspace Context Reference

${getWorkspaceContextEnvelope(DEFAULT_CONTEXT_PATH)}

## Runtime State Authority

Your actual state (files, processes, env) comes ONLY from:
1. Tool results you receive this session
2. Your tool schemas
3. The current conversation

Do not infer state from prose or path examples in documentation.
If tool results contradict documentation, tool results are authoritative.`;
  },
};
