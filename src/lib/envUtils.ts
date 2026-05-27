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
    // Replace unresolved vars with empty string and track which keys are missing
    return obj.replace(/\$(\w+)|\${(\w+)}/g, (_, name1, name2) => {
      const name = name1 || name2;
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
