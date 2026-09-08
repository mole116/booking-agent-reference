import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runAgent, type AgentOptions, type TokenUsage } from '../agent.js';

export interface EvalCase {
  id: string;
  description: string;
  turns: string[];
  expect?: (db: any) => boolean;
  expectTools?: (callsPerTurn: string[][]) => boolean;
}

export interface CaseResult {
  id: string;
  description: string;
  passed: boolean;
  reason?: string;
  toolsCalledPerTurn: string[][];
  /** Wall-clock time for the whole case, in milliseconds. */
  durationMs: number;
  /** Tokens used across every turn of the case. */
  usage: TokenUsage;
}

export const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

/** Error thrown by withTimeout when the promise does not settle in time. */
export class CaseTimeoutError extends Error {
  constructor(
    public readonly timeoutMs: number,
    label: string,
  ) {
    super(`Timed out after ${Math.round(timeoutMs / 1000)}s: ${label}`);
    this.name = 'CaseTimeoutError';
  }
}

/**
 * Race a promise against a timeout. On timeout the promise keeps running in
 * the background (its late result is discarded) but the caller moves on.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new CaseTimeoutError(ms, label)), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      err => { clearTimeout(timer); reject(err); },
    );
  });
}

export const EVALS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DB_PATH = path.resolve(EVALS_DIR, '..', 'database.json');
export const SEED_PATH = path.resolve(EVALS_DIR, 'seed.json');
export const BACKUP_PATH = path.resolve(EVALS_DIR, '..', 'database.eval-backup.json');

/** Run one scenario against the agent and assert DB state and tool-call order. */
export async function runCase(c: EvalCase, agentOptions?: AgentOptions): Promise<CaseResult> {
  fs.copyFileSync(SEED_PATH, DB_PATH);

  const startedAt = Date.now();
  const callsPerTurn: string[][] = [];
  const usage: TokenUsage = { ...ZERO_USAGE };
  let history: any[] = [];

  const finish = (passed: boolean, reason?: string): CaseResult => ({
    id: c.id,
    description: c.description,
    passed,
    reason,
    toolsCalledPerTurn: callsPerTurn,
    durationMs: Date.now() - startedAt,
    usage,
  });

  try {
    for (const turn of c.turns) {
      const result = await runAgent(turn, history, `eval-${c.id}`, agentOptions);
      history = result.history;
      callsPerTurn.push(result.toolsCalled);
      usage.inputTokens += result.usage.inputTokens;
      usage.outputTokens += result.usage.outputTokens;
      usage.totalTokens += result.usage.totalTokens;
    }
  } catch (err) {
    return finish(false, `Agent threw: ${err instanceof Error ? err.message : err}`);
  }

  if (c.expect) {
    const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    if (!c.expect(db)) {
      return finish(false, 'DB assertion failed');
    }
  }

  if (c.expectTools && !c.expectTools(callsPerTurn)) {
    return finish(false, 'Tool assertion failed');
  }

  return finish(true);
}

/** Back up the live database so an eval run can freely overwrite it. */
export function backupDb(): void {
  fs.copyFileSync(DB_PATH, BACKUP_PATH);
}

/** Restore the live database from the backup and remove the backup file. */
export function restoreDb(): void {
  fs.copyFileSync(BACKUP_PATH, DB_PATH);
  fs.unlinkSync(BACKUP_PATH);
}
