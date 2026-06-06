/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║   OVERMIND BRIDGE — JSON Sanitizer (Windows Path Rescue)            ║
 * ║                                                                      ║
 * ║   Répare les payloads JSON mal échappés contenant des chemins       ║
 * ║   Windows (ex: `C:\Users\Deamon\file.txt` qui casse le JSON si       ║
 * ║   pas double-échappé). Pattern inspiré de bt-sms.                   ║
 * ║                                                                      ║
 * ║   Le problème : un client envoie un body qui contient               ║
 * ║   `"path": "C:\Users\Deamon\file.txt"` — l'antislash devant `U`     ║
 * ║   est interprété comme un caractère d'échappement JSON invalide.    ║
 * ║                                                                      ║
 * ║   La solution : un sanitizer state-machine qui :                     ║
 * ║     - Détecte si on est dans une string                             ║
 * ║     - Double les `\` qui ne sont pas suivis d'un char d'échappement  ║
 * ║     - Préserve le contenu légitime                                   ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

/**
 * Tente de réparer un JSON malformé contenant des chemins Windows non échappés.
 * Retourne le JSON parsé, ou throw si irrécupérable.
 */
export function sanitizeAndParse(rawBody: string): unknown {
  // Essai 1 : parse direct
  try {
    return JSON.parse(rawBody);
  } catch {
    // Fall through
  }

  // Essai 2 : sanitizer state-machine
  const sanitized = sanitizeJsonRaw(rawBody);
  try {
    return JSON.parse(sanitized);
  } catch {
    // Fall through
  }

  // Donné, on throw
  throw new Error('JSON body is malformed and could not be sanitized');
}

/**
 * State-machine qui double les `\` non-échappés dans les strings JSON.
 * Préserve les séquences d'échappement valides (\n, \t, \\, \", etc.)
 */
export function sanitizeJsonRaw(rawBody: string): string {
  let insideString = false;
  let result = '';
  for (let i = 0; i < rawBody.length; i++) {
    const char = rawBody[i];

    if (char === '"' && (i === 0 || rawBody[i - 1] !== '\\')) {
      insideString = !insideString;
      result += char;
      continue;
    }

    if (char === '\\' && insideString) {
      const nextChar = rawBody[i + 1];
      if (nextChar === '\\') {
        // \\ : on garde, on saute le 2e
        result += '\\\\';
        i++;
        continue;
      }
      if (nextChar === '"') {
        // \" : on garde
        result += '\\"';
        i++;
        continue;
      }
      // Autres : \n, \t, \u, etc. — légitime, on garde tel quel
      if (nextChar && /[nrtbf/\\"u]/.test(nextChar)) {
        result += char;
        continue;
      }
      // \X non standard (typiquement \U de C:\Users) — on double
      result += '\\\\';
      continue;
    }

    result += char;
  }
  return result;
}

/**
 * Détecte si un body est probablement cassé par des Windows paths non échappés.
 * Heuristique simple : présence de `:\` dans le body.
 */
export function looksLikeWindowsPathIssue(rawBody: string): boolean {
  return /:\\/.test(rawBody);
}
