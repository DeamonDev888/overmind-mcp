#!/usr/bin/env node
/**
 * Auto-update CHANGELOG.md when version bumps
 * Runs after `pnpm run version`
 */

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

function getCurrentVersion() {
  const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
  return pkg.version;
}

function getCommitsSinceLastTag() {
  try {
    const output = execSync('git describe --tags --abbrev=0 HEAD~1 2>/dev/null', {
      encoding: 'utf8',
      cwd: rootDir,
    }).trim();

    const commits = execSync(`git log ${output}..HEAD --oneline --no-merges`, {
      encoding: 'utf8',
      cwd: rootDir,
    });

    return commits.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function categorizeCommits(commits) {
  const features = [];
  const fixes = [];
  const docs = [];
  const infra = [];
  const deps = [];

  for (const commit of commits) {
    const msg = commit.replace(/^[a-f0-9]+ /, '');
    if (msg.startsWith('feat') || msg.startsWith('feat:')) {
      features.push(msg);
    } else if (msg.startsWith('fix') || msg.startsWith('fix:')) {
      fixes.push(msg);
    } else if (msg.startsWith('docs') || msg.startsWith('doc:')) {
      docs.push(msg);
    } else if (msg.startsWith('chore') || msg.startsWith('refactor') || msg.startsWith('infra')) {
      infra.push(msg);
    } else if (msg.startsWith('deps')) {
      deps.push(msg);
    } else {
      infra.push(msg);
    }
  }

  return { features, fixes, docs, infra, deps };
}

function formatChangelogSection(version, commits) {
  const date = new Date().toISOString().split('T')[0];
  const { features, fixes, docs, infra, deps } = categorizeCommits(commits);

  let section = `## [${version}] - ${date}\n\n`;

  if (features.length > 0) {
    section += '### 🚀 Features\n\n';
    for (const f of features) section += `- ${f}\n`;
    section += '\n';
  }

  if (fixes.length > 0) {
    section += '### 🐛 Fixes\n\n';
    for (const f of fixes) section += `- ${f}\n`;
    section += '\n';
  }

  if (docs.length > 0) {
    section += '### 📝 Documentation\n\n';
    for (const d of docs) section += `- ${d}\n`;
    section += '\n';
  }

  if (infra.length > 0) {
    section += '### 🔧 Infrastructure\n\n';
    for (const i of infra) section += `- ${i}\n`;
    section += '\n';
  }

  if (deps.length > 0) {
    section += '### 📦 Dependencies\n\n';
    for (const d of deps) section += `- ${d}\n`;
    section += '\n';
  }

  return section;
}

function updateChangelog() {
  const version = getCurrentVersion();
  const commits = getCommitsSinceLastTag();

  if (commits.length === 0) {
    console.log('No commits to add to changelog');
    return;
  }

  const changelogPath = join(rootDir, 'CHANGELOG.md');
  let changelog = readFileSync(changelogPath, 'utf8');

  // Remove existing placeholder if present
  changelog = changelog.replace(`## [${version}] - YYYY-MM-DD\n\n---\n\n`, '');

  const newSection = formatChangelogSection(version, commits);

  // Insert after the header comment block
  const insertPoint = changelog.indexOf('---\n\n## ');
  if (insertPoint !== -1) {
    changelog = changelog.slice(0, insertPoint + 5) + newSection + changelog.slice(insertPoint + 5);
  }

  writeFileSync(changelogPath, changelog);
  console.log(`✅ CHANGELOG.md updated with v${version}`);
}

updateChangelog();