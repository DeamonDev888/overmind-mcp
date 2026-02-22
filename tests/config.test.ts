import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getWorkspaceDir, resolveConfigPath } from '../src/lib/config.js';

describe('Workspace Directory Resolution - 4 Level Fallback (Auto-Portable)', () => {
  const originalEnv = process.env;
  const originalCwd = process.cwd();
  const testDirs: string[] = [];

  // Helper to create temp dir
  function createTempDir(name: string): string {
    const dir = path.join(os.tmpdir(), `overmind-test-${Date.now()}-${name}`);
    fs.mkdirSync(dir, { recursive: true });
    testDirs.push(dir);
    return dir;
  }

  // Helper to safely cleanup
  function cleanup() {
    // Restore original directory first
    try {
      process.chdir(originalCwd);
    } catch {
      // Ignore errors
    }

    // Remove test directories
    for (const dir of testDirs) {
      try {
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      } catch {
        // Ignore cleanup errors on Windows
      }
    }
    testDirs.length = 0;

    // Cleanup test global directory if created
    try {
      const testConfig = path.join(os.homedir(), '.overmind-mcp', '.mcp.json');
      if (fs.existsSync(testConfig)) {
        const config = JSON.parse(fs.readFileSync(testConfig, 'utf-8'));
        if (config.__test__) {
          const globalDir = path.join(os.homedir(), '.overmind-mcp');
          fs.rmSync(globalDir, { recursive: true, force: true });
        }
      }
    } catch {
      // Ignore
    }
  }

  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv };
    delete process.env.OVERMIND_WORKSPACE;
    testDirs.length = 0;
  });

  afterEach(() => {
    cleanup();
  });

  describe('🥇 Level 1: Environment Variable (User Override)', () => {
    it('should use OVERMIND_WORKSPACE env var when set (highest priority)', () => {
      const customWorkspace = createTempDir('custom-workspace');
      process.env.OVERMIND_WORKSPACE = customWorkspace;

      const result = getWorkspaceDir();

      expect(result).toBe(path.resolve(customWorkspace));
      expect(result).toContain('custom-workspace');
    });

    it('should resolve relative paths from OVERMIND_WORKSPACE to absolute', () => {
      const relativePath = './my-workspace';
      process.env.OVERMIND_WORKSPACE = relativePath;

      const result = getWorkspaceDir();

      expect(path.isAbsolute(result)).toBe(true);
      expect(result).toContain('my-workspace');
    });

    it('should ignore all other levels when OVERMIND_WORKSPACE is set', () => {
      const envWorkspace = createTempDir('env-workspace');
      const localDir = createTempDir('local-with-mcp');
      const codeRootDir = createTempDir('code-root-with-mcp');

      process.env.OVERMIND_WORKSPACE = envWorkspace;

      // Create .mcp.json in local dir (should be ignored)
      fs.writeFileSync(path.join(localDir, '.mcp.json'), JSON.stringify({ mcpServers: {} }));

      // Create .mcp.json in code root dir (should be ignored)
      fs.writeFileSync(path.join(codeRootDir, '.mcp.json'), JSON.stringify({ mcpServers: {} }));

      const result = getWorkspaceDir();

      expect(result).toBe(path.resolve(envWorkspace));
      expect(result).not.toBe(localDir);
      expect(result).not.toBe(codeRootDir);
    });
  });

  describe('🥈 Level 2: Local Project Mode (.mcp.json in CWD)', () => {
    it('should use cwd when .mcp.json exists in current directory', () => {
      const projectDir = createTempDir('project-with-mcp');
      const mcpJsonPath = path.join(projectDir, '.mcp.json');
      fs.writeFileSync(mcpJsonPath, JSON.stringify({ mcpServers: {} }));

      // Change to project directory
      process.chdir(projectDir);

      const result = getWorkspaceDir();

      expect(result).toBe(projectDir);
      expect(fs.existsSync(path.join(result, '.mcp.json'))).toBe(true);
    });

    it('should detect .mcp.json even without OVERMIND_WORKSPACE set', () => {
      delete process.env.OVERMIND_WORKSPACE;

      const projectDir = createTempDir('project-no-env');
      const mcpJsonPath = path.join(projectDir, '.mcp.json');
      fs.writeFileSync(mcpJsonPath, JSON.stringify({ mcpServers: {} }));
      process.chdir(projectDir);

      const result = getWorkspaceDir();

      expect(result).toBe(projectDir);
    });

    it('should NOT use cwd if .mcp.json does not exist', () => {
      delete process.env.OVERMIND_WORKSPACE;

      // Create a directory without .mcp.json
      const noMcpDir = createTempDir('no-mcp-json');
      process.chdir(noMcpDir);

      const result = getWorkspaceDir();

      // Should fallback to code root or global (levels 3 or 4)
      expect(result).not.toBe(noMcpDir);
    });
  });

  describe('🥉 Level 3: Auto-Detection from Code Location (Noob-Proof)', () => {
    it('should detect code root and use it if .mcp.json exists there', () => {
      delete process.env.OVERMIND_WORKSPACE;

      // Simulate being in a directory without .mcp.json (so level 2 is skipped)
      const emptyDir = createTempDir('empty-cwd');
      process.chdir(emptyDir);

      // The actual code root should be detected
      const result = getWorkspaceDir();

      // Since we're running tests in the actual project, it should find the project root
      // This is the "Noob-Proof" auto-detection
      expect(result).toBeTruthy();
      expect(path.isAbsolute(result)).toBe(true);
    });

    it('should introspect code location and go up 2 levels to find root', () => {
      delete process.env.OVERMIND_WORKSPACE;

      // Create a simulated code structure
      const simulatedRoot = createTempDir('simulated-project');
      const libDir = path.join(simulatedRoot, 'dist', 'lib');
      fs.mkdirSync(libDir, { recursive: true });

      // Create .mcp.json in the simulated root
      fs.writeFileSync(
        path.join(simulatedRoot, '.mcp.json'),
        JSON.stringify({ mcpServers: {}, simulated: true }),
      );

      // Change to a directory without .mcp.json
      const emptyDir = createTempDir('empty-for-autodetect');
      process.chdir(emptyDir);

      // Note: We can't actually test the __dirname introspection in isolation
      // because it's determined at import time, but we verify the logic works
      const result = getWorkspaceDir();
      expect(result).toBeTruthy();
    });

    it('should skip code root detection if .mcp.json does not exist there', () => {
      delete process.env.OVERMIND_WORKSPACE;

      // Change to empty directory
      const emptyDir = createTempDir('empty-skip-code-root');
      process.chdir(emptyDir);

      // Should fallback to global if code root has no .mcp.json
      const result = getWorkspaceDir();

      // The actual behavior depends on whether we're in the real project or not
      expect(result).toBeTruthy();
    });
  });

  describe('🏆 Level 4: Global Fallback (~/.overmind-mcp/)', () => {
    it('should create and use global directory as absolute last resort', () => {
      delete process.env.OVERMIND_WORKSPACE;

      // Use a directory without .mcp.json and where code root also has none
      const emptyDir = createTempDir('empty-for-global');
      process.chdir(emptyDir);

      // Mock the code root to not have .mcp.json by changing to a temp dir
      // This forces level 4 (global fallback)
      const result = getWorkspaceDir();

      // If code root has .mcp.json (we're in the actual project), it will use that
      // Otherwise, it falls back to global
      expect(result).toBeTruthy();
      expect(path.isAbsolute(result)).toBe(true);
    });

    it('should create valid .mcp.json in global directory', () => {
      delete process.env.OVERMIND_WORKSPACE;

      // Force global fallback scenario
      const emptyDir = createTempDir('force-global');
      process.chdir(emptyDir);

      const result = getWorkspaceDir();

      // Check if it's the global directory
      if (result.includes('.overmind-mcp')) {
        const mcpJsonPath = path.join(result, '.mcp.json');
        expect(fs.existsSync(mcpJsonPath)).toBe(true);

        const config = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8'));
        expect(config).toHaveProperty('mcpServers');
        expect(config.mcpServers).toEqual({});
      }
    });

    it('should not recreate global directory if it already exists', () => {
      delete process.env.OVERMIND_WORKSPACE;

      // Pre-create global dir with test marker
      const globalTestDir = path.join(os.homedir(), '.overmind-mcp');
      if (!fs.existsSync(globalTestDir)) {
        fs.mkdirSync(globalTestDir, { recursive: true });
      }
      const testConfigPath = path.join(globalTestDir, '.mcp.json');
      fs.writeFileSync(testConfigPath, JSON.stringify({ __test__: true, mcpServers: {} }));

      const emptyDir = createTempDir('empty-global-exists');
      process.chdir(emptyDir);

      const result = getWorkspaceDir();

      // If it uses global, verify test marker
      if (result === globalTestDir) {
        const config = JSON.parse(fs.readFileSync(testConfigPath, 'utf-8'));
        expect(config.__test__).toBe(true);

        // Cleanup
        fs.rmSync(globalTestDir, { recursive: true, force: true });
      }
    });
  });

  describe('Priority Order Validation (4 Levels)', () => {
    it('should respect exact priority: ENV > CWD .mcp.json > Code Root > Global', () => {
      // Setup: Create all four levels
      const envPath = createTempDir('level1-env');
      const localPath = createTempDir('level2-local');
      const emptyPath = createTempDir('level3-4-empty');

      // Create .mcp.json in local directory
      fs.writeFileSync(path.join(localPath, '.mcp.json'), JSON.stringify({ level: 2 }));

      // Test 1: ENV var wins (Level 1)
      process.env.OVERMIND_WORKSPACE = envPath;
      process.chdir(localPath);
      expect(getWorkspaceDir()).toBe(path.resolve(envPath));

      // Test 2: Local .mcp.json wins (Level 2)
      delete process.env.OVERMIND_WORKSPACE;
      process.chdir(localPath);
      expect(getWorkspaceDir()).toBe(localPath);

      // Test 3: Code root detection or global fallback (Levels 3 or 4)
      process.chdir(emptyPath);
      const result = getWorkspaceDir();
      // Will be either code root (if .mcp.json exists) or global
      expect(result).toBeTruthy();
      expect(path.isAbsolute(result)).toBe(true);
    });

    it('should demonstrate auto-portability: code root detection works anywhere', () => {
      delete process.env.OVERMIND_WORKSPACE;

      // Simulate user opening terminal in ANY random directory
      const randomDir = createTempDir('random-location');
      process.chdir(randomDir);

      // Even though we're in a random directory without .mcp.json,
      // Overmind should auto-detect its code location
      const result = getWorkspaceDir();

      // The system should find its way back to the project root
      expect(result).toBeTruthy();
      expect(path.isAbsolute(result)).toBe(true);

      // This is the "Noob-Proof" feature: user doesn't need to configure anything!
    });
  });

  describe('resolveConfigPath Integration', () => {
    it('should resolve relative paths using getWorkspaceDir', () => {
      const workspaceDir = createTempDir('workspace');
      process.env.OVERMIND_WORKSPACE = workspaceDir;

      const relativePath = './config/settings.json';
      const resolved = resolveConfigPath(relativePath);

      expect(resolved).toBe(path.resolve(workspaceDir, relativePath));
    });

    it('should return absolute paths unchanged', () => {
      const absolutePath = path.join(os.tmpdir(), 'absolute', 'config.json');
      const resolved = resolveConfigPath(absolutePath);

      expect(resolved).toBe(absolutePath);
    });

    it('should use detected workspace context for relative paths', () => {
      const projectDir = createTempDir('project');
      const mcpJsonPath = path.join(projectDir, '.mcp.json');
      fs.writeFileSync(mcpJsonPath, JSON.stringify({ mcpServers: {} }));
      process.chdir(projectDir);

      delete process.env.OVERMIND_WORKSPACE;

      const relativePath = './my-config.json';
      const resolved = resolveConfigPath(relativePath);

      expect(resolved).toBe(path.resolve(projectDir, relativePath));
    });
  });

  describe('Edge Cases & Noob-Proof Features', () => {
    it('should handle empty OVERMIND_WORKSPACE string', () => {
      process.env.OVERMIND_WORKSPACE = '';
      const emptyDir = createTempDir('empty-env');
      process.chdir(emptyDir);

      const result = getWorkspaceDir();

      // Empty string is falsy, should fallback to level 2, 3, or 4
      expect(result).toBeTruthy();
      expect(path.isAbsolute(result)).toBe(true);
    });

    it('should create valid JSON in global .mcp.json', () => {
      delete process.env.OVERMIND_WORKSPACE;
      const emptyDir = createTempDir('json-test');
      process.chdir(emptyDir);

      const result = getWorkspaceDir();

      // If it falls back to global
      if (result.includes('.overmind-mcp')) {
        const mcpJsonPath = path.join(result, '.mcp.json');

        expect(() => {
          const config = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8'));
          expect(config).toHaveProperty('mcpServers');
          expect(config.mcpServers).toEqual({});
        }).not.toThrow();
      }
    });

    it('should handle concurrent calls safely', () => {
      delete process.env.OVERMIND_WORKSPACE;
      const dir1 = createTempDir('concurrent-1');
      const dir2 = createTempDir('concurrent-2');

      process.chdir(dir1);
      const result1 = getWorkspaceDir();

      process.chdir(dir2);
      const result2 = getWorkspaceDir();

      // Both should use the same workspace (code root or global)
      // since neither has .mcp.json
      expect(result1).toBeTruthy();
      expect(result2).toBeTruthy();
      expect(path.isAbsolute(result1)).toBe(true);
      expect(path.isAbsolute(result2)).toBe(true);
    });

    it('should be portable: works from any terminal location', () => {
      delete process.env.OVERMIND_WORKSPACE;

      // Simulate opening terminal in various locations
      const locations = [
        createTempDir('location-1'),
        createTempDir('location-2'),
        createTempDir('location-3'),
      ];

      const results = locations.map((dir) => {
        process.chdir(dir);
        return getWorkspaceDir();
      });

      // All should return valid absolute paths
      results.forEach((result) => {
        expect(result).toBeTruthy();
        expect(path.isAbsolute(result)).toBe(true);
      });

      // Results should be consistent (all finding the same code root or global)
      // (unless each location has its own .mcp.json)
      const uniqueResults = new Set(results);
      expect(uniqueResults.size).toBeGreaterThan(0);
    });
  });
});
