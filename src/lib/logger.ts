import pino from 'pino';
import path from 'path';
import fs from 'fs';

/**
 * ============================================================================
 * 🚀 SUPER-PINO LOGGER - Workflow Edition (Overmind)
 * ============================================================================
 */

const REDACT_PATHS = [
  '*.password',
  '*.api_key',
  '*.apiKey',
  '*.token',
  '*.auth_token',
  '*.authToken',
  '*.secret',
  '*.access_token',
  '*.accessToken',
  'req.headers.authorization',
  '*.email',
  '*.credential',
];

const DEFAULT_LOG_DIR = path.join(process.cwd(), 'logs');
const DEFAULT_LOG_FILE = path.join(DEFAULT_LOG_DIR, 'nexus-workflow.log');

let PKG_VERSION = '2.7.0';
try {
  const pkgPath = path.resolve(process.cwd(), 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    PKG_VERSION = pkg.version || PKG_VERSION;
  }
} catch { /* fallback */ }

function getFileTargets(): string[] {
  const raw = process.env.LOG_FILES ?? '';
  const paths = raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const userPaths = paths.map((p) => (path.isAbsolute(p) ? p : path.resolve(process.cwd(), p)));
  // Only include default log file + user paths (removed hardcoded global path)
  return [DEFAULT_LOG_FILE, ...userPaths];
}

const fileTargets = getFileTargets();

const transport = pino.transport({
  targets: [
    {
      target: 'pino-pretty',
      level: process.env.LOG_LEVEL || 'debug',
      options: {
        destination: 2,
        colorize: true,
        translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
        ignore: 'pid,hostname,service,version',
        messageFormat: '\x1b[32m[{module}]\x1b[0m {msg}',
        errorLikeObjectKeys: ['err', 'error'],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    },
    ...fileTargets.map((filePath) => ({
      target: 'pino-roll',
      level: process.env.LOG_LEVEL || 'info',
      options: {
        file: filePath,
        frequency: 'daily',
        dateFormat: 'yyyy-MM-dd',
        size: '50m',
        limit: { count: 30 },
        mkdir: true,
      },
    })),
  ],
});

export const rootLogger = pino(
  {
    name: 'workflow-mcp',
    level: process.env.LOG_LEVEL || 'info',
    redact: {
      paths: REDACT_PATHS,
      censor: '[CONFIDENTIEL]',
    },
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
    },
    base: {
      service: 'workflow-mcp-orchestrator',
      version: PKG_VERSION,
    },
  },
  transport,
);

// Specialized Child Loggers
export const orchestratorLogger = rootLogger.child({ module: 'ORCHESTRATOR' });
export const agentLogger = rootLogger.child({ module: 'AGENT' });
export const mcpLogger = rootLogger.child({ module: 'MCP' });
export const jobLogger = rootLogger.child({ module: 'JOB' });

rootLogger.info({ targets: fileTargets }, '[SHIELD] Super-Pino V2.0 initialized for Workflow-MCP');

export default rootLogger;
