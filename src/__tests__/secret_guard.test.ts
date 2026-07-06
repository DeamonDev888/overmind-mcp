/**
 * Secret Guard — Anti-Secret & Private Path Protection
 * ================================================
 * Pre-compilation gate: scans all published source files for:
 *   1. Real API keys / tokens (blocks publish if leaked)
 *   2. Hardcoded private absolute paths (blocks accidental doxxing)
 *
 * Runs as part of `pnpm run test` — fails the build BEFORE npm publish.
 *
 * Allowed in source (won't trigger):
 *   - Placeholders: sk-or-v1-..., sk-or-...here, xxxx..., <YOUR_KEY>
 *   - Prefix checks in code: if (token.startsWith('sk-cp-'))
 *   - Provider detection patterns (regex against user input)
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// ─── File collection ───────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(__dirname, '../..');

interface ScannedFile {
  relPath: string;
  absPath: string;
  content: string;
  lines: string[];
}

function collectFiles(dirs: string[], extensions: string[]): ScannedFile[] {
  const files: ScannedFile[] = [];
  const skipDirs = new Set([
    'node_modules',
    'dist',
    '.git',
    '__archive__',
    'coverage',
    '.vscode',
    '.idea',
    'scratch',
    'backup',
  ]);

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (!extensions.includes(ext)) continue;
        // Skip this test file itself and other test files
        if (fullPath.includes('__tests__')) continue;
        // Skip .example files (templates)
        if (entry.name.endsWith('.example') || entry.name.endsWith('.example.yml')) continue;
        const content = fs.readFileSync(fullPath, 'utf8');
        files.push({
          relPath: path.relative(PROJECT_ROOT, fullPath),
          absPath: fullPath,
          content,
          lines: content.split('\n'),
        });
      }
    }
  }

  for (const d of dirs) {
    walk(path.join(PROJECT_ROOT, d));
  }
  return files;
}

// ─── Secret detection ──────────────────────────────────────────────────────

interface SecretPattern {
  name: string;
  // Returns array of {line, match} for real secrets found
  check: (content: string) => { line: number; snippet: string }[];
}

/**
 * Core heuristic: a real secret has enough characters AFTER the prefix.
 * Placeholders typically end with: ..., xxxx, <, {, here, CHANGE, your_
 */
function isPlaceholder(value: string): boolean {
  // Ends with ellipsis or placeholder markers
  if (/\.\.\.$/.test(value)) return true;
  if (/<[^>]+>$/.test(value)) return true; // <YOUR_KEY>
  if (/\{[^}]+\}$/.test(value)) return true; // {key}
  // Contains placeholder keywords
  if (/(your_|change|placeholder|example|xxxx|here\b|redacted|dummy|sample)/i.test(value))
    return true;
  // Too short to be real (real keys are 30+ chars)
  if (value.length < 25) return true;
  return false;
}

const SECRET_PATTERNS: SecretPattern[] = [
  {
    name: 'OpenRouter API Key',
    check: (content) => {
      const results: { line: number; snippet: string }[] = [];
      // Real: sk-or-v1- followed by 40+ alphanumeric chars
      const re = /sk-or-v[12]-([a-zA-Z0-9]{10,})/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const fullMatch = m[0];
        if (!isPlaceholder(fullMatch)) {
          const lineNum = content.substring(0, m.index).split('\n').length;
          results.push({ line: lineNum, snippet: fullMatch.substring(0, 30) + '...' });
        }
      }
      return results;
    },
  },
  {
    name: 'Anthropic API Key',
    check: (content) => {
      const results: { line: number; snippet: string }[] = [];
      const re = /sk-ant-api[a-zA-Z0-9-]{30,}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        if (!isPlaceholder(m[0])) {
          const lineNum = content.substring(0, m.index).split('\n').length;
          results.push({ line: lineNum, snippet: m[0].substring(0, 25) + '...' });
        }
      }
      return results;
    },
  },
  {
    name: 'OpenAI API Key',
    check: (content) => {
      const results: { line: number; snippet: string }[] = [];
      const re = /sk-proj-([a-zA-Z0-9_-]{30,})/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        if (!isPlaceholder(m[0])) {
          const lineNum = content.substring(0, m.index).split('\n').length;
          results.push({ line: lineNum, snippet: m[0].substring(0, 25) + '...' });
        }
      }
      return results;
    },
  },
  {
    name: 'GitHub Token (ghp_)',
    check: (content) => {
      const results: { line: number; snippet: string }[] = [];
      // Real: ghp_ + exactly 36 chars
      const re = /ghp_([a-zA-Z0-9]{36})/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        if (!isPlaceholder(m[0])) {
          const lineNum = content.substring(0, m.index).split('\n').length;
          results.push({ line: lineNum, snippet: 'ghp_' + m[1].substring(0, 8) + '...' });
        }
      }
      return results;
    },
  },
  {
    name: 'GitHub PAT (github_pat_)',
    check: (content) => {
      const results: { line: number; snippet: string }[] = [];
      const re = /github_pat_[a-zA-Z0-9_]{30,}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const lineNum = content.substring(0, m.index).split('\n').length;
        results.push({ line: lineNum, snippet: m[0].substring(0, 25) + '...' });
      }
      return results;
    },
  },
  {
    name: 'MiniMax API Key',
    check: (content) => {
      const results: { line: number; snippet: string }[] = [];
      // Real MiniMax: sk-cp- or sk-mm- followed by 20+ chars
      const re = /sk-(?:cp|mm)-([a-zA-Z0-9]{20,})/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        if (!isPlaceholder(m[0])) {
          const lineNum = content.substring(0, m.index).split('\n').length;
          results.push({ line: lineNum, snippet: m[0].substring(0, 20) + '...' });
        }
      }
      return results;
    },
  },
  {
    name: 'xAI (Grok) API Key',
    check: (content) => {
      const results: { line: number; snippet: string }[] = [];
      const re = /xai-([a-zA-Z0-9]{30,})/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        if (!isPlaceholder(m[0])) {
          const lineNum = content.substring(0, m.index).split('\n').length;
          results.push({ line: lineNum, snippet: m[0].substring(0, 20) + '...' });
        }
      }
      return results;
    },
  },
  {
    name: 'AWS Access Key',
    check: (content) => {
      const results: { line: number; snippet: string }[] = [];
      const re = /AKIA([0-9A-Z]{16})/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const lineNum = content.substring(0, m.index).split('\n').length;
        results.push({ line: lineNum, snippet: 'AKIA' + m[1].substring(0, 8) + '...' });
      }
      return results;
    },
  },
  {
    name: 'Z.AI / GLM Token (32hex.32hex)',
    check: (content) => {
      const results: { line: number; snippet: string }[] = [];
      // Real Z.AI token: exactly 32 hex chars, dot, 32 hex chars
      const re = /([0-9a-f]{32})\.([0-9a-f]{32})/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        if (!isPlaceholder(m[0])) {
          const lineNum = content.substring(0, m.index).split('\n').length;
          results.push({
            line: lineNum,
            snippet: m[1].substring(0, 8) + '...' + m[2].substring(0, 4) + '...',
          });
        }
      }
      return results;
    },
  },
  {
    name: 'Private Key (PEM)',
    check: (content) => {
      const results: { line: number; snippet: string }[] = [];
      const re = /-----BEGIN (?:RSA |EC |DSA |OPENSSH |)PRIVATE KEY-----/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const lineNum = content.substring(0, m.index).split('\n').length;
        results.push({ line: lineNum, snippet: '-----BEGIN PRIVATE KEY-----' });
      }
      return results;
    },
  },
  {
    name: 'Discord Bot Token',
    check: (content) => {
      const results: { line: number; snippet: string }[] = [];
      // Real: <bot_id>.<timestamp>.<hash> or just the hash part (35+ chars)
      const re = /[a-zA-Z0-9]{24,26}\.[a-zA-Z0-9]{6}\.[a-zA-Z0-9]{27,38}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        if (!isPlaceholder(m[0])) {
          const lineNum = content.substring(0, m.index).split('\n').length;
          results.push({ line: lineNum, snippet: m[0].substring(0, 20) + '...' });
        }
      }
      return results;
    },
  },
  {
    name: 'Telegram Bot Token',
    check: (content) => {
      const results: { line: number; snippet: string }[] = [];
      // Format: 123456789:ABCdef...
      const re = /([0-9]{8,12}):([a-zA-Z0-9_-]{30,})/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        if (!isPlaceholder(m[0])) {
          const lineNum = content.substring(0, m.index).split('\n').length;
          results.push({ line: lineNum, snippet: m[1] + ':' + m[2].substring(0, 8) + '...' });
        }
      }
      return results;
    },
  },
  {
    name: 'Generic Bearer Token',
    check: (content) => {
      const results: { line: number; snippet: string }[] = [];
      // Bearer eyJ... (JWT) or Bearer <long token>
      const re = /Bearer\s+([a-zA-Z0-9._-]{40,})/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        if (!isPlaceholder(m[0])) {
          const lineNum = content.substring(0, m.index).split('\n').length;
          results.push({ line: lineNum, snippet: 'Bearer ' + m[1].substring(0, 15) + '...' });
        }
      }
      return results;
    },
  },
  {
    name: 'NVIDIA NIM API Key',
    check: (content) => {
      const results: { line: number; snippet: string }[] = [];
      const re = /nvapi-([a-zA-Z0-9_-]{40,})/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        if (!isPlaceholder(m[0])) {
          const lineNum = content.substring(0, m.index).split('\n').length;
          results.push({ line: lineNum, snippet: 'nvapi-' + m[1].substring(0, 12) + '...' });
        }
      }
      return results;
    },
  },
  {
    name: 'ElevenLabs API Key (sk_)',
    check: (content) => {
      const results: { line: number; snippet: string }[] = [];
      // sk_ with underscore (not sk- with dash), followed by 20+ chars
      const re = /sk_([a-zA-Z0-9]{20,})/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        if (!isPlaceholder(m[0])) {
          const lineNum = content.substring(0, m.index).split('\n').length;
          results.push({ line: lineNum, snippet: 'sk_' + m[1].substring(0, 12) + '...' });
        }
      }
      return results;
    },
  },
  {
    name: 'DeepSeek API Key',
    check: (content) => {
      const results: { line: number; snippet: string }[] = [];
      // sk- followed by 32+ hex chars (NOT sk-or, sk-ant, sk-cp, sk-mm, sk-proj)
      const re = /sk-(?!or|ant|cp|mm|proj)([a-f0-9]{20,})/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        if (!isPlaceholder(m[0])) {
          const lineNum = content.substring(0, m.index).split('\n').length;
          results.push({ line: lineNum, snippet: 'sk-' + m[1].substring(0, 8) + '...' });
        }
      }
      return results;
    },
  },
  {
    name: 'MiniMax JWT Token',
    check: (content) => {
      const results: { line: number; snippet: string }[] = [];
      // JWT tokens start with eyJ (base64-encoded {"alg...)
      const re = /eyJ([a-zA-Z0-9_-]{10,})\.([a-zA-Z0-9_-]{10,})/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        if (!isPlaceholder(m[0])) {
          const lineNum = content.substring(0, m.index).split('\n').length;
          results.push({ line: lineNum, snippet: 'eyJ' + m[1].substring(0, 8) + '...' });
        }
      }
      return results;
    },
  },
  {
    name: 'Generic ENV assignment with real secret value',
    check: (content) => {
      const results: { line: number; snippet: string }[] = [];
      const lines = content.split('\n');
      // Match VARNAME=VALUE where VARNAME suggests a secret
      // Catches: *_API_KEY, *_TOKEN, *_SECRET, *_PASSWORD, *_AUTH, *_KEY
      const re =
        /^([A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|AUTH_TOKEN|_KEY|_PASS))\s*=\s*(\S+)/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const varName = m[1];
        const value = m[2].replace(/^["']|["']$/g, '').replace(/`/g, '');
        // Skip if it's a process.env reference
        if (value.startsWith('process.env')) continue;
        // Skip placeholders
        if (isPlaceholder(value)) continue;
        // Skip if value is too short
        if (value.length < 12) continue;
        // Skip if it's a variable reference (${VAR}, $VAR)
        if (/^\$/.test(value)) continue;
        const lineNum = content.substring(0, m.index).split('\n').length;
        const lineIdx = lineNum - 1;
        const line = lines[lineIdx] || '';
        // Skip comments
        if (
          line.trim().startsWith('//') ||
          line.trim().startsWith('*') ||
          line.trim().startsWith('#')
        )
          continue;
        // Skip if the line contains process.env (it's code reading the var, not hardcoding)
        if (line.includes('process.env')) continue;
        results.push({ line: lineNum, snippet: `${varName}=${value.substring(0, 15)}...` });
      }
      return results;
    },
  },
];

// ─── Private path detection ────────────────────────────────────────────────

interface PathPattern {
  name: string;
  check: (content: string, _filePath: string) => { line: number; snippet: string }[];
}

/**
 * Allow-list: paths that are OK to reference in source.
 * - os.homedir(), os.tmpdir(), process.env.* calls
 * - Path construction: path.join(...), path.resolve(...)
 * - Documentation markers
 */
function isAllowedPathContext(lines: string[], lineIdx: number): boolean {
  // Check surrounding lines for dynamic path construction
  const context = lines.slice(Math.max(0, lineIdx - 2), lineIdx + 3).join(' ');
  if (/os\.(homedir|tmpdir)\(\)/.test(context)) return true;
  if (/path\.(join|resolve|dirname)\(/.test(context)) return true;
  if (/process\.env\.(HOME|USERPROFILE|LOCALAPPDATA|APPDATA|OVERMIND_WORKSPACE)/.test(context))
    return true;
  if (/__dirname|import\.meta\.url/.test(context)) return true;
  return false;
}

const PATH_PATTERNS: PathPattern[] = [
  {
    name: 'Windows private home path',
    check: (content, _filePath) => {
      const results: { line: number; snippet: string }[] = [];
      const lines = content.split('\n');
      // Match C:\Users\<name>\ or C:/Users/<name>/ or C:\\Users\\<name>\\
      // We look for the ACTUAL developer paths, not generic references
      const re = /C:\\\\?Users\\\\?[A-Za-z]+|C:\/Users\/[A-Za-z]+/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const lineNum = content.substring(0, m.index).split('\n').length;
        const lineIdx = lineNum - 1;
        // Allow if in a path.join() or os.homedir() context
        if (isAllowedPathContext(lines, lineIdx)) continue;
        // Allow comments and documentation
        const line = lines[lineIdx] || '';
        if (
          line.trim().startsWith('//') ||
          line.trim().startsWith('*') ||
          line.trim().startsWith('#')
        )
          continue;
        results.push({ line: lineNum, snippet: line.trim().substring(0, 80) });
      }
      return results;
    },
  },
  {
    name: 'Unix private home path (/home/<user>)',
    check: (content, _filePath) => {
      const results: { line: number; snippet: string }[] = [];
      const lines = content.split('\n');
      // Match /home/<username>/ but NOT /home/USER (placeholder)
      const re = /\/home\/([a-zA-Z]+)\//g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const username = m[1].toLowerCase();
        // Skip generic placeholders
        if (['user', 'username', 'name', 'your', 'app', 'node', 'postgres'].includes(username))
          continue;
        const lineNum = content.substring(0, m.index).split('\n').length;
        const lineIdx = lineNum - 1;
        if (isAllowedPathContext(lines, lineIdx)) continue;
        const line = lines[lineIdx] || '';
        if (
          line.trim().startsWith('//') ||
          line.trim().startsWith('*') ||
          line.trim().startsWith('#')
        )
          continue;
        results.push({ line: lineNum, snippet: line.trim().substring(0, 80) });
      }
      return results;
    },
  },
  {
    name: 'MSYS/Git-Bash private path (/c/Users/<user>)',
    check: (content, _filePath) => {
      const results: { line: number; snippet: string }[] = [];
      const lines = content.split('\n');
      const re = /\/c\/Users\/([A-Za-z]+)\//g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const lineNum = content.substring(0, m.index).split('\n').length;
        const lineIdx = lineNum - 1;
        if (isAllowedPathContext(lines, lineIdx)) continue;
        const line = lines[lineIdx] || '';
        if (
          line.trim().startsWith('//') ||
          line.trim().startsWith('*') ||
          line.trim().startsWith('#')
        )
          continue;
        results.push({ line: lineNum, snippet: line.trim().substring(0, 80) });
      }
      return results;
    },
  },
];

// ─── Test Suites ───────────────────────────────────────────────────────────

// Collect once — used by all tests
const SOURCE_FILES = collectFiles(['src', 'scripts', 'bin'], ['.ts', '.mjs', '.sh', '.cjs']);

describe('🔒 Secret Guard — Anti-Secret Protection', () => {
  it('scans all source files and finds 0 real API keys', () => {
    expect(SOURCE_FILES.length, 'Should have found source files to scan').toBeGreaterThan(0);

    const allHits: string[] = [];

    for (const file of SOURCE_FILES) {
      for (const pattern of SECRET_PATTERNS) {
        const hits = pattern.check(file.content);
        if (hits.length > 0) {
          for (const hit of hits) {
            allHits.push(`  [${pattern.name}] ${file.relPath}:${hit.line} → ${hit.snippet}`);
          }
        }
      }
    }

    if (allHits.length > 0) {
      expect.fail(
        `🚨 SECRET LEAK DETECTED — ${allHits.length} real secret(s) found:\n\n` +
          allHits.join('\n') +
          '\n\n❌ BLOCKING PUBLISH. Replace real keys with placeholders (xxx...).',
      );
    }
  });

  // ─── Pattern validation: ensure our detector actually works ────

  describe('Detector validation (pattern sanity checks)', () => {
    it('does NOT flag placeholder values', () => {
      const testCases = [
        'sk-or-v1-...',
        'sk-or-...here',
        'sk-ant-api-<YOUR_KEY>',
        'sk-proj-{your_key}',
        'OVERMIND_EMBEDDING_KEY=sk-or-v1-...',
        'OPENROUTER_API_KEY=sk-or-...here',
        'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', // all same char
      ];
      for (const tc of testCases) {
        for (const pattern of SECRET_PATTERNS) {
          const hits = pattern.check(tc);
          expect(hits.length, `"${tc}" should not match "${pattern.name}"`).toBe(0);
        }
      }
    });

    it('DOES flag real-looking secrets', () => {
      const testCases: { value: string; patternName: string }[] = [
        {
          value: 'sk-or-v1-abcdef1234567890abcdef1234567890abcdef12',
          patternName: 'OpenRouter API Key',
        },
        {
          value: 'sk-ant-api03-abcdef1234567890abcdef1234567890abcdef123456',
          patternName: 'Anthropic API Key',
        },
        {
          value: 'ghp_1234567890abcdefghijklmnopqrstuvwxyz1234',
          patternName: 'GitHub Token (ghp_)',
        },
        {
          value: 'nvapi-GE_uEb0rx-MPAtSedgcqPybOIdWCa2tgs7smHrvImZ8YPyX2EqbPysSy',
          patternName: 'NVIDIA NIM API Key',
        },
        { value: 'sk_083abcdef1234567890ABCDEF6ee1', patternName: 'ElevenLabs API Key (sk_)' },
        { value: 'sk-e8eabcdef1234567890abcdefb2f0', patternName: 'DeepSeek API Key' },
        {
          value: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkw',
          patternName: 'MiniMax JWT Token',
        },
        {
          value: 'MY_API_KEY=4jW2wIOToye2GUqfDjbpwinvYWe9r48a',
          patternName: 'Generic ENV assignment with real secret value',
        },
      ];
      for (const tc of testCases) {
        const pattern = SECRET_PATTERNS.find((p) => p.name === tc.patternName)!;
        const hits = pattern.check(tc.value);
        expect(
          hits.length,
          `"${tc.value.substring(0, 20)}..." should match "${tc.patternName}"`,
        ).toBeGreaterThan(0);
      }
    });
  });

  it('does not scan test files, .example files, or node_modules', () => {
    for (const f of SOURCE_FILES) {
      expect(f.relPath).not.toContain('__tests__');
      expect(f.relPath).not.toContain('node_modules');
      expect(f.relPath).not.toMatch(/\.example\b/);
    }
  });
});

describe('🛡️ Secret Guard — Private Path Protection', () => {
  it('scans all source files and finds 0 hardcoded private paths', () => {
    const allHits: string[] = [];

    for (const file of SOURCE_FILES) {
      for (const pattern of PATH_PATTERNS) {
        const hits = pattern.check(file.content, file.relPath);
        if (hits.length > 0) {
          for (const hit of hits) {
            allHits.push(`  [${pattern.name}] ${file.relPath}:${hit.line} → ${hit.snippet}`);
          }
        }
      }
    }

    if (allHits.length > 0) {
      expect.fail(
        `🚨 PRIVATE PATH LEAK DETECTED — ${allHits.length} hardcoded path(s) found:\n\n` +
          allHits.join('\n') +
          '\n\n❌ BLOCKING PUBLISH. Use os.homedir(), path.join(), or process.env instead.',
      );
    }
  });

  it('does NOT flag dynamic path construction (os.homedir, path.join)', () => {
    const codeWithDynamicPath = `
      const home = os.homedir();
      const ws = path.join(home, '.overmind');
      const config = path.resolve(process.env.HOME, 'config');
      // C:\\Users\\Deamon in a comment is OK
    `;
    for (const pattern of PATH_PATTERNS) {
      const hits = pattern.check(codeWithDynamicPath, 'fake.ts');
      // The comment line should be skipped, dynamic paths should be skipped
      const realHits = hits.filter((h) => !h.snippet.trim().startsWith('//'));
      expect(realHits.length, `"${pattern.name}" should not flag dynamic paths or comments`).toBe(
        0,
      );
    }
  });
});
