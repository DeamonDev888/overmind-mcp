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
export function interpolateEnvVars(
  obj: Interpolatable,
  visited: WeakSet<object> = new WeakSet(),
): Interpolatable {
  if (typeof obj === 'string') {
    // Replace unresolved vars with empty string instead of literal $VAR
    return obj.replace(/\$(\w+)|\${(\w+)}/g, (_, name1, name2) => {
      const name = name1 || name2;
      return process.env[name] ?? '';
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
