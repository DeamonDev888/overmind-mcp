import { describe, it, expect } from 'vitest';
import { metadataTool } from '../tools/metadata.js';

// ─── HELPERS ─────────────────────────────────────────────────────────────────

async function expectBlocked(path: string) {
  const result = await metadataTool({ path, depth: 2, includeStats: false });
  expect(result.isError, `path "${path}" devrait être bloqué`).toBe(true);
  expect(result.content[0].text).toMatch(/Chemin refusé|introuvable/);
  return result.content[0].text;
}

async function expectOk(path: string) {
  const result = await metadataTool({ path, depth: 2, includeStats: false });
  expect(result.isError, `path "${path}" devrait être autorisé`).toBeUndefined();
  return result.content[0].text;
}

// ─── CAS NOMINAUX ─────────────────────────────────────────────────────────────

describe('metadata — cas nominaux', () => {
  it('. → CWD', async () => {
    const text = await expectOk('.');
    expect(text).toMatch(/Arborescence/);
    expect(text).toMatch(/package\.json/);
  });

  it('chaîne vide → CWD', async () => {
    const text = await expectOk('');
    expect(text).toMatch(/Arborescence/);
  });

  it('src/ → sous-dossier valide', async () => {
    const text = await expectOk('src');
    expect(text).toMatch(/tools|services/);
  });

  it('src/tools → sous-sous-dossier valide', async () => {
    const text = await expectOk('src/tools');
    expect(text).toMatch(/metadata\.ts/);
  });

  it('includeStats: false → pas de section Statistiques', async () => {
    const result = await metadataTool({ path: '.', depth: 2, includeStats: false });
    expect(result.content[0].text).not.toMatch(/Statistiques/);
  });

  it('depth 0 → arborescence vide (pas de fils)', async () => {
    const result = await metadataTool({ path: '.', depth: 0, includeStats: false });
    const text = result.content[0].text;
    expect(text).toMatch(/Arborescence/);
    // depth 0 : aucun enfant listé
    expect(text).not.toMatch(/├──|└──/);
  });
});

// ─── TRAVERSAL & PATH INJECTION ──────────────────────────────────────────────

describe('metadata — traversal / injection', () => {
  it('../ → erreur', async () => {
    await expectBlocked('..');
  });

  it('../../etc → erreur', async () => {
    await expectBlocked('../../etc');
  });

  it('src/../../.. → erreur', async () => {
    await expectBlocked('src/../../..');
  });

  it('src/../../../Windows → erreur', async () => {
    await expectBlocked('src/../../../Windows');
  });

  // Encodage URL : %2e%2e = ".."
  it('%2e%2e/%2e%2e/etc → pas interprété comme traversal (traité comme dossier inexistant)', async () => {
    const result = await metadataTool({ path: '%2e%2e/%2e%2e/etc', depth: 2, includeStats: false });
    // resolve() ne décode pas l'URL, donc c'est un dossier inexistant
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Chemin refusé|introuvable/);
  });

  // Double slash
  it('//etc/passwd → erreur', async () => {
    await expectBlocked('//etc/passwd');
  });

  // Null byte
  it('src\x00/../../../etc → erreur', async () => {
    await expectBlocked('src\x00/../../../etc');
  });
});

// ─── CHEMINS ABSOLUS ─────────────────────────────────────────────────────────

describe('metadata — chemins absolus hors CWD', () => {
  it('/tmp → erreur', async () => {
    await expectBlocked('/tmp');
  });

  it('/etc/passwd → erreur', async () => {
    await expectBlocked('/etc/passwd');
  });

  it('C:\\Windows → erreur', async () => {
    await expectBlocked('C:\\Windows');
  });

  it('C:/Users → erreur', async () => {
    await expectBlocked('C:/Users');
  });

  // UNC Windows
  it('\\\\server\\share → erreur', async () => {
    await expectBlocked('\\\\server\\share');
  });

  // file:// URL
  it('file:///etc/passwd → erreur (traité comme dossier inexistant/refusé)', async () => {
    const result = await metadataTool({ path: 'file:///etc/passwd', depth: 2, includeStats: false });
    expect(result.isError).toBe(true);
  });
});

// ─── DOSSIERS INEXISTANTS ─────────────────────────────────────────────────────

describe('metadata — dossiers inexistants', () => {
  it('src/ghost → introuvable', async () => {
    await expectBlocked('src/ghost');
  });

  it('totally/fake/path → introuvable', async () => {
    await expectBlocked('totally/fake/path');
  });
});
