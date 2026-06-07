/**
 * Environment variable interpolation utility for Overmind.
 * Allows settings.json to use $VAR or ${VAR} syntax to reference values from .env
 */

type Interpolatable =
  | string
  | number
  | boolean
  | null
  | undefined
  | Interpolatable[]
  | { [key: string]: Interpolatable };

// Track visited objects to prevent infinite recursion from circular references
// Resolve variable names referenced in settings.json so the caller can log warnings
const unresolvedVars: string[] = [];

export function interpolateEnvVars(
  obj: Interpolatable,
  visited: WeakSet<object> = new WeakSet(),
): Interpolatable {
  if (typeof obj === 'string') {
    // Match $VAR and ${VAR}. The closing '}' MUST be inside the match so it does
    // not leak into the output. The previous regex `\$(\w+)|\${\w+}` (a) had only
    // one capture group (so `name2` was always undefined, and `${VAR}` crashed
    // on `process.env[undefined]`), and (b) did not consume the '}' — leaking
    // it as literal text. Fixed: explicit capture group on each alternation branch,
    // closing brace consumed by the first branch.
    return obj.replace(/\$\{(\w+)\}|\$(\w+)/g, (_, braced, bare) => {
      const name = braced || bare;
      // Defensive: should never happen, but if name is undefined (no capture
      // matched), treat as literal text rather than crashing on process.env[undefined].
      if (name === undefined) return _;
      const value = process.env[name];
      if (value === undefined) unresolvedVars.push(name);
      return value ?? '';
    });
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => interpolateEnvVars(item, visited));
  }

  if (obj !== null && typeof obj === 'object') {
    // Circular reference detection
    if (visited.has(obj)) {
      return obj; // Break cycle
    }
    visited.add(obj);

    const result: Record<string, Interpolatable> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = interpolateEnvVars(value, visited);
    }
    return result;
  }

  return obj;
}

/** Returns the list of env var names that were referenced but not found. Resets the list. */
export function consumeUnresolvedVars(): string[] {
  const vars = [...unresolvedVars];
  unresolvedVars.length = 0;
  return vars;
}
