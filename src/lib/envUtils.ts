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

export function interpolateEnvVars(obj: Interpolatable): Interpolatable {
  if (typeof obj === 'string') {
    return obj.replace(/\$(\w+)|\${(\w+)}/g, (_, name1, name2) => {
      const name = name1 || name2;
      return process.env[name] || `$${name}`;
    });
  }

  if (Array.isArray(obj)) {
    return obj.map(interpolateEnvVars);
  }

  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, Interpolatable> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = interpolateEnvVars(value);
    }
    return result;
  }

  return obj;
}
