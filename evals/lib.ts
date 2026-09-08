import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runAgent, type AgentOptions } from '../agent.js';

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
}

export const EVALS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DB_PATH = path.resolve(EVALS_DIR, '..', 'database.json');
export const SEED_PATH = path.resolve(EVALS_DIR, 'seed.json');
export const BACKUP_PATH = path.resolve(EVALS_DIR, '..', 'database.eval-backup.json');

/** Run one scenario against the agent and assert DB state and tool-call order. */
export async function runCase(c: EvalCase, agentOptions?: AgentOptions): Promise<CaseResult> {
  fs.copyFileSync(SEED_PATH, DB_PATH);

  const callsPerTurn: string[][] = [];
  let history: any[] = [];

  try {
    for (const turn of c.turns) {
      const result = await runAgent(turn, history, `eval-${c.id}`, agentOptions);
      history = result.history;
      callsPerTurn.push(result.toolsCalled);
    }
  } catch (err) {
    return {
      id: c.id, description: c.description, passed: false,
      reason: `Agent threw: ${err instanceof Error ? err.message : err}`,
      toolsCalledPerTurn: callsPerTurn,
    };
  }

  if (c.expect) {
    const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    if (!c.expect(db)) {
      return { id: c.id, description: c.description, passed: false, reason: 'DB assertion failed', toolsCalledPerTurn: callsPerTurn };
    }
  }

  if (c.expectTools && !c.expectTools(callsPerTurn)) {
    return {
      id: c.id, description: c.description, passed: false,
      reason: `Tool assertion failed`,
      toolsCalledPerTurn: callsPerTurn,
    };
  }

  return { id: c.id, description: c.description, passed: true, toolsCalledPerTurn: callsPerTurn };
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
