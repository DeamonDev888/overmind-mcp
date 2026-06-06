/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║   OVERMIND BRIDGE — ArgParser (Zero-Dep CLI Parser)                  ║
 * ║                                                                      ║
 * ║   Parser d'arguments minimaliste, cohérent avec le style du projet.  ║
 * ║   Supporte :                                                          ║
 * ║     - Flags courts (-v) et longs (--verbose)                         ║
 * ║     - Valeurs via = ou espace (--port 3100, --port=3100)             ║
 * ║     - Valeurs répétées (--include a --include b)                     ║
 * ║     - Booléens negations (--no-auth)                                 ║
 * ║     - Stdin auto-détection                                            ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

export type ArgValue = string | boolean | number | string[];

export interface ParsedArgs {
  /** Premier arg = subcommand (ex: 'server', 'call', 'scenario') */
  command: string | undefined;
  /** Tous les args après le subcommand, indexés par flag (sans le --) */
  flags: Record<string, ArgValue>;
  /** Positionals (args sans flag) */
  positionals: string[];
  /** Args bruts pour debug */
  raw: string[];
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Parse process.argv.slice(2). Le premier non-flag devient `command`.
 */
export function parseArgs(argv: string[] = process.argv.slice(2)): ParsedArgs {
  const flags: Record<string, ArgValue> = {};
  const positionals: string[] = [];
  let command: string | undefined;
  let commandConsumed = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    // --flag=value
    if (arg.startsWith('--') && arg.includes('=')) {
      const eqIdx = arg.indexOf('=');
      const key = arg.slice(2, eqIdx);
      const value = arg.slice(eqIdx + 1);
      flags[key] = coerceValue(value, true);
      if (!commandConsumed) {
        command = key; // au cas où le subcommand est en --foo=bar (rare)
        commandConsumed = true;
      }
      continue;
    }

    // --flag value | --flag
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      // Booléen si prochain arg est un autre flag ou rien
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = coerceValue(next, false);
        i++; // consomme la valeur
      }
      continue;
    }

    // -f value | -f | -abc (flags courts combinés)
    if (arg.startsWith('-') && arg.length > 1) {
      // Combinés : -abc → a, b, c tous booléens
      if (/^-[a-z]+$/i.test(arg)) {
        for (const ch of arg.slice(1)) {
          flags[ch] = true;
        }
        continue;
      }
      // -v value
      const key = arg.slice(1);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = coerceValue(next, false);
        i++;
      }
      continue;
    }

    // Positionnel
    if (!commandConsumed) {
      command = arg;
      commandConsumed = true;
    } else {
      positionals.push(arg);
    }
  }

  return { command, flags, positionals, raw: argv };
}

/**
 * Récupère un flag avec valeur par défaut et coercion de type.
 */
export function getFlag<T extends ArgValue>(
  args: ParsedArgs,
  name: string,
  defaultValue?: T,
): T | undefined {
  const value = args.flags[name];
  if (value === undefined) return defaultValue;
  return value as T;
}

/**
 * Récupère un flag, throw si manquant.
 */
export function requireFlag<T extends ArgValue>(args: ParsedArgs, name: string): T {
  const value = args.flags[name];
  if (value === undefined) {
    throw new Error(`Missing required flag: --${name}`);
  }
  return value as T;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function coerceValue(raw: string, fromEquals: boolean): string | number | boolean {
  // Si --flag=true / false
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  // Si nombre
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  // Sinon string brut
  return raw;
}

// ─── Stdin detection ───────────────────────────────────────────────────────

/**
 * Vérifie si stdin a des données piped (TTY = false).
 */
export function hasStdinData(): boolean {
  return !process.stdin.isTTY;
}

/**
 * Lit stdin en entier (utf-8).
 */
export async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}
