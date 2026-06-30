process.title = "MCP-OVERMIND"; // [V16] Window identification
// launch.js — compiled launcher for Workflow
// Prebuild copies this to dist/bin/launch.js

const { exec, spawn } = require("child_process");
const fs   = require("fs");
const path = require("path");

const SCRIPT_DIR = path.resolve(__dirname, "..");
const LOG_DIR    = path.join(SCRIPT_DIR, "logs");
const PORT       = "3099";
const NAME       = "Workflow";
const BUILD_CMD  = "npm run build";

function log(msg) {
  console.log(`[{new Date().toISOString()}] [{NAME}] ${msg}`);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function killPort(port) {
  return new Promise((resolve) => {
    const cmd = `powershell -c "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Format-Table -HideTableHeaders -Property OwningProcess | ForEach-Object {$_.Trim()} | Where-Object {$_}"`;
    exec(cmd, { cwd: SCRIPT_DIR, windowsHide: true }, (err, stdout) => {
      const pids = (stdout || "").trim().split("\n").map((p) => p.trim()).filter(Boolean);
      if (pids.length === 0) { log(`Port ${port} — no process`); resolve(); return; }
      for (const pid of pids) {
        log(`Port ${port}  PID ${pid} killed`);
        exec(`taskkill /F /PID ${pid}`, { windowsHide: true }, () => {});
      }
      setTimeout(resolve, 500);
    });
  });
}

function build() {
  return new Promise((resolve) => {
    log("[BUILD] Starting...");
    exec(BUILD_CMD, { cwd: SCRIPT_DIR, windowsHide: true }, (err) => {
      if (err && !fs.existsSync(path.join(SCRIPT_DIR, "dist"))) {
        log("[FAIL] Build failed — no dist");
        resolve(false);
      } else {
        log("[OK] Build complete");
        resolve(true);
      }
    });
  });
}

function launch() {
  const logFile = path.join(LOG_DIR, `${NAME}.log`);
  const errFile = path.join(LOG_DIR, `${NAME}.err.log`);
  const out = fs.openSync(logFile, "a");
  const err = fs.openSync(errFile, "a");
  const env = { ...process.env, ...{} };
  const child = spawn("node", ['--max-old-space-size=256', '--no-warnings', '--env-file=.env', 'dist/bin/cli.js', '--transport', 'httpStream', '--port', '3099'], {
    cwd: SCRIPT_DIR,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", out, err],
    env,
  });
  child.unref();
  log(`[SPAWN] PID=${child.pid}`);
}

async function main() {
  log("[START] Launching...");
  ensureDir(LOG_DIR);
  await killPort(PORT);
  const ok = await build();
  if (!ok) { console.error("[ABORT] Build failed"); process.exit(1); }
  launch();
  log("[DONE] Server launched. Check ${LOG_DIR}/${NAME}.log");
}

main().catch(console.error);
