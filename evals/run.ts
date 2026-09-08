import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runAgent } from '../agent.js';
import { cases } from './cases.js';

export interface EvalCase {
  id: string;
  description: string;
  turns: string[];
  expect?: (db: any) => boolean;
  expectTools?: (callsPerTurn: string[][]) => boolean;
}

interface CaseResult {
  id: string;
  description: string;
  passed: boolean;
  reason?: string;
  toolsCalledPerTurn: string[][];
}

interface Report {
  runAt: string;
  passed: number;
  failed: number;
  total: number;
  results: CaseResult[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '..', 'database.json');
const SEED_PATH = path.resolve(__dirname, 'seed.json');
const BACKUP_PATH = path.resolve(__dirname, '..', 'database.eval-backup.json');
const DEFAULT_OUT = path.resolve(__dirname, 'results.json');

async function runCase(c: EvalCase): Promise<CaseResult> {
  fs.copyFileSync(SEED_PATH, DB_PATH);

  const callsPerTurn: string[][] = [];
  let history: any[] = [];

  try {
    for (const turn of c.turns) {
      const result = await runAgent(turn, history, `eval-${c.id}`);
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

async function main() {
  const args = process.argv.slice(2);
  const outFlagIdx = args.indexOf('--out');
  const outPath = outFlagIdx !== -1 ? path.resolve(args[outFlagIdx + 1]) : DEFAULT_OUT;
  const filter = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--out');

  const toRun = filter ? cases.filter(c => c.id === filter) : cases;

  if (toRun.length === 0) {
    console.error(`No cases match "${filter}"`);
    process.exit(1);
  }

  console.log(`\n=== Booking Agent Evals — ${toRun.length} case(s) ===\n`);

  fs.copyFileSync(DB_PATH, BACKUP_PATH);
  const results: CaseResult[] = [];

  try {
    for (const c of toRun) {
      process.stdout.write(`  ${c.id} ... `);
      const result = await runCase(c);
      results.push(result);

      if (result.passed) {
        console.log('PASS');
      } else {
        console.log(`FAIL\n    ✗ ${result.reason}`);
        console.log(`    Tools per turn: ${result.toolsCalledPerTurn.map((t, i) => `turn ${i + 1}: [${t.join(', ')}]`).join('  |  ')}`);
      }
    }
  } finally {
    fs.copyFileSync(BACKUP_PATH, DB_PATH);
    fs.unlinkSync(BACKUP_PATH);
  }

  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;

  const report: Report = {
    runAt: new Date().toISOString(),
    passed,
    failed,
    total: results.length,
    results,
  };

  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`\n${passed}/${results.length} passed  —  results written to ${path.relative(process.cwd(), outPath)}\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  if (fs.existsSync(BACKUP_PATH)) {
    fs.copyFileSync(BACKUP_PATH, DB_PATH);
    fs.unlinkSync(BACKUP_PATH);
  }
  process.exit(1);
});
