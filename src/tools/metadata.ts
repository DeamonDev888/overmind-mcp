import { z } from 'zod';
import { readdir, readFile, stat, realpath } from 'fs/promises';
import { join, extname, basename, resolve, sep } from 'path';

export const metadataSchema = z.object({
  path: z.string().default('.').describe('Chemin du projet (défaut: répertoire courant)'),
  depth: z.number().default(3).describe("Profondeur de l'arborescence (défaut: 3)"),
  includeStats: z.boolean().default(true).describe('Inclure les statistiques (défaut: true)'),
});

const IGNORED = new Set([
  'node_modules',
  '.git',
  '.github',
  'dist',
  '.next',
  'build',
  'coverage',
  '__pycache__',
  '.cache',
  '.turbo',
  '.pnpm-store',
]);

const CONFIG_FILES = [
  'package.json',
  'tsconfig.json',
  'tsconfig.base.json',
  '.env.example',
  'vite.config.ts',
  'vite.config.js',
  'vitest.config.ts',
  'eslint.config.js',
  '.eslintrc.json',
  'prettier.config.js',
  '.prettierrc',
  'Dockerfile',
  'docker-compose.yml',
];

const LANG_MAP: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript (JSX)',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript (JSX)',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.cs': 'C#',
  '.cpp': 'C++',
  '.c': 'C',
  '.md': 'Markdown',
  '.json': 'JSON',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.toml': 'TOML',
  '.sh': 'Shell',
  '.bat': 'Batch',
  '.sql': 'SQL',
  '.html': 'HTML',
  '.css': 'CSS',
  '.scss': 'SCSS',
};

interface TreeNode {
  name: string;
  type: 'file' | 'dir';
  children?: TreeNode[];
}

async function buildTree(dir: string, depth: number, currentDepth = 0): Promise<TreeNode[]> {
  if (currentDepth >= depth) return [];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: TreeNode[] = [];
  for (const entry of entries) {
    if (IGNORED.has(entry.name) || entry.name.startsWith('.') && entry.name !== '.env.example') continue;

    if (entry.isDirectory()) {
      const children = await buildTree(join(dir, entry.name), depth, currentDepth + 1);
      nodes.push({ name: entry.name, type: 'dir', children });
    } else {
      nodes.push({ name: entry.name, type: 'file' });
    }
  }

  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function renderTree(nodes: TreeNode[], prefix = ''): string {
  let out = '';
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const isLast = i === nodes.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const icon = node.type === 'dir' ? '📁 ' : '📄 ';
    out += `${prefix}${connector}${icon}${node.name}\n`;
    if (node.children?.length) {
      out += renderTree(node.children, prefix + (isLast ? '    ' : '│   '));
    }
  }
  return out;
}

interface Stats {
  totalFiles: number;
  totalLines: number;
  languages: Record<string, number>;
  filePaths: string[];
}

async function collectStats(dir: string): Promise<Stats> {
  const stats: Stats = { totalFiles: 0, totalLines: 0, languages: {}, filePaths: [] };

  async function walk(d: string) {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORED.has(entry.name)) continue;
      const fullPath = join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        const ext = extname(entry.name).toLowerCase();
        const lang = LANG_MAP[ext];
        if (lang) {
          stats.totalFiles++;
          stats.languages[lang] = (stats.languages[lang] ?? 0) + 1;
          // Store relative path from project root
          stats.filePaths.push(fullPath.slice(dir.length + 1).replace(/\\/g, '/'));
          try {
            const content = await readFile(fullPath, 'utf8');
            stats.totalLines += content.split('\n').length;
          } catch {
            // skip unreadable files
          }
        }
      }
    }
  }

  await walk(dir);
  stats.filePaths.sort();
  return stats;
}

async function getConfigs(dir: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const file of CONFIG_FILES) {
    try {
      const content = await readFile(join(dir, file), 'utf8');
      result[file] = content.length > 2000 ? content.slice(0, 2000) + '\n…(tronqué)' : content;
    } catch {
      // file absent
    }
  }
  return result;
}

function withinRoot(candidate: string, root: string): boolean {
  // Normalize: add trailing sep so /foo doesn't match /foobar
  const norm = (s: string) => {
    const withSep = s.endsWith(sep) ? s : s + sep;
    // Case-insensitive on Windows
    return process.platform === 'win32' ? withSep.toLowerCase() : withSep;
  };
  return norm(candidate).startsWith(norm(root));
}

async function resolveAbsPath(p: string): Promise<string> {
  const cwd = await realpath(process.cwd());
  if (!p || p === '.') return cwd;

  // Pre-check before stat (catches obvious traversal early)
  const candidate = resolve(cwd, p);
  if (!withinRoot(candidate, cwd)) {
    throw new Error(
      `Chemin refusé : "${p}" est en dehors du répertoire de travail. Utilisez un chemin relatif.`,
    );
  }

  let real: string;
  try {
    const s = await stat(candidate);
    if (!s.isDirectory()) throw new Error(`"${p}" n'est pas un répertoire.`);
    // Resolve symlinks and re-check — prevents symlink escape on Linux/Mac
    real = await realpath(candidate);
  } catch (e) {
    if (e instanceof Error && (e.message.startsWith('Chemin refusé') || e.message.startsWith('"')))
      throw e;
    throw new Error(`Répertoire introuvable : "${p}"`);
  }

  if (!withinRoot(real, cwd)) {
    throw new Error(
      `Chemin refusé : "${p}" pointe (via symlink) en dehors du répertoire de travail.`,
    );
  }

  return real;
}

export async function metadataTool(args: z.infer<typeof metadataSchema>) {
  const { path: rawPath, depth, includeStats } = args;

  let absPath: string;
  try {
    absPath = await resolveAbsPath(rawPath);
  } catch (e) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `❌ ${e instanceof Error ? e.message : String(e)}` }],
    };
  }
  const projectName = basename(absPath);

  let output = `# 🗂️ Metadata — \`${projectName}\`\n\n`;
  output += `> **Chemin :** \`${absPath}\`\n\n`;

  // Arborescence
  const tree = await buildTree(absPath, depth);
  output += `## 📁 Arborescence (profondeur ${depth})\n\`\`\`\n${projectName}/\n${renderTree(tree)}\`\`\`\n\n`;

  // Configs
  const configs = await getConfigs(absPath);
  if (Object.keys(configs).length > 0) {
    output += `## ⚙️ Fichiers de configuration\n`;
    for (const [file, content] of Object.entries(configs)) {
      const ext = file.endsWith('.json') ? 'json' : file.endsWith('.md') ? 'markdown' : 'yaml';
      output += `### \`${file}\`\n\`\`\`${ext}\n${content}\n\`\`\`\n\n`;
    }
  }

  // Stats
  if (includeStats) {
    const stats = await collectStats(absPath);
    output += `## 📊 Statistiques\n`;
    output += `- **Fichiers sources :** ${stats.totalFiles}\n`;
    output += `- **Lignes totales :** ${stats.totalLines.toLocaleString()}\n`;
    output += `- **Langages :**\n`;
    const sorted = Object.entries(stats.languages).sort((a, b) => b[1] - a[1]);
    for (const [lang, count] of sorted) {
      output += `  - ${lang}: ${count} fichier${count > 1 ? 's' : ''}\n`;
    }
    output += `\n## 📋 Fichiers sources (${stats.totalFiles})\n\`\`\`\n`;
    output += stats.filePaths.join('\n');
    output += `\n\`\`\`\n`;
  }

  return {
    content: [{ type: 'text' as const, text: output }],
  };
}
