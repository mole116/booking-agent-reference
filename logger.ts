import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, 'logs');
const AGENT_LOG = path.join(LOG_DIR, 'agent.log');
const SERVER_LOG = path.join(LOG_DIR, 'server.log');

fs.mkdirSync(LOG_DIR, { recursive: true });

function timestamp(): string {
  return new Date().toISOString();
}

function writeLine(file: string, line: string): void {
  fs.appendFileSync(file, line + '\n', 'utf-8');
}

function fmt(label: string, data: unknown): string {
  const json = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return `[${timestamp()}] [${label}]\n${json}\n${'─'.repeat(80)}`;
}

// ─── Server logger ────────────────────────────────────────────────────────────

export const serverLog = {
  request(method: string, path: string, body?: unknown): void {
    writeLine(SERVER_LOG, fmt(`HTTP ${method} ${path}`, body ?? '(no body)'));
  },
  response(method: string, path: string, status: number, body?: unknown): void {
    writeLine(SERVER_LOG, fmt(`HTTP ${method} ${path} → ${status}`, body ?? '(no body)'));
  },
  error(context: string, err: unknown): void {
    writeLine(SERVER_LOG, fmt(`ERROR ${context}`, err instanceof Error ? err.stack ?? err.message : err));
  },
};

// ─── Agent logger ─────────────────────────────────────────────────────────────

export const agentLog = {
  turnStart(sessionId: string, userMessage: string): void {
    writeLine(AGENT_LOG, fmt(`TURN START  session=${sessionId}`, { userMessage }));
  },

  step(sessionId: string, step: {
    stepNumber: number;
    text: string;
    toolCalls: Array<{ toolName: string; args: unknown }>;
    finishReason?: string;
    usage?: { inputTokens?: number; outputTokens?: number };
  }): void {
    const entry: Record<string, unknown> = {
      session: sessionId,
      step: step.stepNumber,
      finishReason: step.finishReason,
      tokens: step.usage,
    };

    if (step.text) entry['assistantText'] = step.text;

    if (step.toolCalls.length > 0) {
      entry['toolCalls'] = step.toolCalls.map(tc => ({
        tool: tc.toolName,
        args: tc.args,
      }));
    }

    writeLine(AGENT_LOG, fmt(`STEP ${step.stepNumber}  session=${sessionId}`, entry));
  },

  toolResult(sessionId: string, toolName: string, result: unknown): void {
    writeLine(AGENT_LOG, fmt(`TOOL RESULT  ${toolName}  session=${sessionId}`, result));
  },

  uiActions(sessionId: string, ui: { kind: string; actions: unknown[] }): void {
    writeLine(AGENT_LOG, fmt(`UI ACTIONS  session=${sessionId}`, ui));
  },

  turnEnd(sessionId: string, reply: string, bookingChanged: boolean): void {
    writeLine(AGENT_LOG, fmt(`TURN END  session=${sessionId}`, { reply, bookingChanged }));
  },

  error(sessionId: string, err: unknown): void {
    writeLine(AGENT_LOG, fmt(`AGENT ERROR  session=${sessionId}`, err instanceof Error ? err.stack ?? err.message : err));
  },
};
