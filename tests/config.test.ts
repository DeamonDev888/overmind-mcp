import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getWorkspaceDir, resolveConfigPath } from '../src/lib/config.js';

describe('Workspace Directory Resolution - 3 Level Fallback', () => {
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
    } catch {}

    // Remove test directories
    for (const dir of testDirs) {
      try {
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      } catch (e) {
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
    } catch (e) {
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

  describe('🥇 Level 1: Environment Variable Priority', () => {
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

    it('should ignore .mcp.json in cwd when OVERMIND_WORKSPACE is set', () => {
      const envWorkspace = createTempDir('env-workspace');
      const localDir = createTempDir('local-with-mcp');
      process.env.OVERMIND_WORKSPACE = envWorkspace;

      // Create .mcp.json in local dir (should be ignored)
      fs.writeFileSync(path.join(localDir, '.mcp.json'), JSON.stringify({ mcpServers: {} }));

      const result = getWorkspaceDir();

      expect(result).toBe(path.resolve(envWorkspace));
      expect(result).not.toBe(localDir);
    });

    it('should ignore global directory when OVERMIND_WORKSPACE is set', () => {
      const tempDir = createTempDir('test-dir');
      process.env.OVERMIND_WORKSPACE = tempDir;

      const result = getWorkspaceDir();

      expect(result).not.toContain('.overmind-mcp');
      expect(result).toBe(path.resolve(tempDir));
    });
  });

  describe('🥈 Level 2: Local Project Mode (.mcp.json detection)', () => {
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

      // Should fallback to global (level 3)
      expect(result).not.toBe(noMcpDir);
      expect(result).toContain('.overmind-mcp');
    });
  });

  describe('🥉 Level 3: Global Fallback (~/.overmind-mcp/)', () => {
    it('should create and use global directory as last resort', () => {
      delete process.env.OVERMIND_WORKSPACE;

      // Use a directory without .mcp.json
      const emptyDir = createTempDir('empty-dir');
      process.chdir(emptyDir);

      const result = getWorkspaceDir();

      expect(result).toContain('.overmind-mcp');
      expect(fs.existsSync(result)).toBe(true);

      // Verify .mcp.json was created
      const mcpJsonPath = path.join(result, '.mcp.json');
      expect(fs.existsSync(mcpJsonPath)).toBe(true);

      const config = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8'));
      expect(config).toHaveProperty('mcpServers');
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

      const emptyDir = createTempDir('empty-dir-2');
      process.chdir(emptyDir);

      const result = getWorkspaceDir();

      expect(result).toBe(globalTestDir);

      // Verify test marker still exists
      const config = JSON.parse(fs.readFileSync(testConfigPath, 'utf-8'));
      expect(config.__test__).toBe(true);

      // Cleanup
      fs.rmSync(globalTestDir, { recursive: true, force: true });
    });
  });

  describe('Priority Order Validation', () => {
    it('should respect exact priority: ENV > Local .mcp.json > Global', () => {
      // Setup: Create all three levels
      const envPath = createTempDir('level1-env');
      const localPath = createTempDir('level2-local');
      const emptyPath = createTempDir('level3-empty');

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

      // Test 3: Global fallback (Level 3)
      process.chdir(emptyPath);
      const result = getWorkspaceDir();
      expect(result).toContain('.overmind-mcp');
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

    it('should use workspace context for relative paths', () => {
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

  describe('Edge Cases', () => {
    it('should handle empty OVERMIND_WORKSPACE string', () => {
      process.env.OVERMIND_WORKSPACE = '';
      const emptyDir = createTempDir('empty-env');
      process.chdir(emptyDir);

      const result = getWorkspaceDir();

      // Empty string is falsy in JavaScript, should fallback
      expect(result).toContain('.overmind-mcp');
    });

    it('should create valid JSON in global .mcp.json', () => {
      delete process.env.OVERMIND_WORKSPACE;
      const emptyDir = createTempDir('json-test');
      process.chdir(emptyDir);

      const result = getWorkspaceDir();
      const mcpJsonPath = path.join(result, '.mcp.json');

      expect(() => {
        const config = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8'));
        expect(config).toHaveProperty('mcpServers');
        expect(config.mcpServers).toEqual({});
      }).not.toThrow();
    });

    it('should handle concurrent calls safely', () => {
      delete process.env.OVERMIND_WORKSPACE;
      const dir1 = createTempDir('concurrent-1');
      const dir2 = createTempDir('concurrent-2');

      process.chdir(dir1);
      const result1 = getWorkspaceDir();

      process.chdir(dir2);
      const result2 = getWorkspaceDir();

      // Both should use global since no .mcp.json
      expect(result1).toContain('.overmind-mcp');
      expect(result2).toContain('.overmind-mcp');
      expect(result1).toBe(result2);
    });
  });
});
