import type { MatrixEntry } from './compare.config.js';
import type { EvalCase } from './lib.js';

/** Default per-case timeout for matrix runs: 5 minutes (local models are slow). */
export const DEFAULT_CASE_TIMEOUT_MS = 300_000;

export interface CompareOptions {
  /** Output path for the JSON report (undefined = the default location). */
  out?: string;
  /** Matrix-entry names to run (undefined = all entries). */
  configNames?: string[];
  /** Case IDs to run (undefined = all cases). */
  caseIds?: string[];
  /** Per-case timeout in milliseconds. */
  timeoutMs: number;
}

function collectValues(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) {
      values.push(...args[i + 1].split(',').map(v => v.trim()).filter(Boolean));
      i++;
    }
  }
  return values;
}

/**
 * Parse eval:matrix CLI arguments.
 *   --out <path>        where to write the JSON report
 *   --config <name>     run only this matrix entry (repeatable, comma-separated ok)
 *   --case <id>         run only this case (repeatable, comma-separated ok)
 *   --timeout <seconds> per-case timeout (default: 300)
 */
export function parseCompareArgs(args: string[]): CompareOptions {
  const outFlagIdx = args.indexOf('--out');
  const out = outFlagIdx !== -1 ? args[outFlagIdx + 1] : undefined;

  const timeoutFlagIdx = args.indexOf('--timeout');
  let timeoutMs = DEFAULT_CASE_TIMEOUT_MS;
  if (timeoutFlagIdx !== -1) {
    const seconds = Number(args[timeoutFlagIdx + 1]);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new Error(`Invalid --timeout value "${args[timeoutFlagIdx + 1]}" — expected seconds, e.g. --timeout 120`);
    }
    timeoutMs = seconds * 1000;
  }

  const configNames = collectValues(args, '--config');
  const caseIds = collectValues(args, '--case');

  return {
    out,
    configNames: configNames.length > 0 ? configNames : undefined,
    caseIds: caseIds.length > 0 ? caseIds : undefined,
    timeoutMs,
  };
}

/** Pick matrix entries by name. Unknown names fail loudly with the valid list. */
export function selectConfigs(matrix: MatrixEntry[], names?: string[]): MatrixEntry[] {
  if (!names || names.length === 0) return matrix;
  return names.map(name => {
    const entry = matrix.find(e => e.name === name);
    if (!entry) {
      throw new Error(
        `Unknown configuration "${name}". Available: ${matrix.map(e => e.name).join(', ')}`,
      );
    }
    return entry;
  });
}

/** Pick cases by ID. Unknown IDs fail loudly with the valid list. */
export function selectCases(allCases: EvalCase[], ids?: string[]): EvalCase[] {
  if (!ids || ids.length === 0) return allCases;
  return ids.map(id => {
    const c = allCases.find(c => c.id === id);
    if (!c) {
      throw new Error(
        `Unknown case "${id}". Available: ${allCases.map(c => c.id).join(', ')}`,
      );
    }
    return c;
  });
}
