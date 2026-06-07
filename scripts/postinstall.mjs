#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * OVERMIND-MCP - POST-INSTALL AUTOMATIQUE (SIMPLIFIÉ)
 * ═══════════════════════════════════════════════════════════════════════════════
 * Script exécuté automatiquement après npm install -g overmind-mcp
 * INSTALLE UNIQUEMENT :
 * - Vérifie Docker
 * - Installe PostgreSQL + pgvector (si absent)
 * - Copie .env.example → .env
 * - Copie .mcp.json.example → .mcp.json
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { execSync, spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const INSTALL_DIR = join(
  process.env.HOME || process.env.USERPROFILE || process.env.HOMEPATH,
  '.overmind'
);

// ═══════════════════════════════════════════════════════════════════════════════
// COLORS
// ═════════════════════════════════════════════════════════════════════════════

const COLORS = {
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  white: '\x1b[37m',
  reset: '\x1b[0m'
};

function log(color, str) {
  console.log(`${color}${str}${COLORS.reset}`);
}

function logSection(title) {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log(`║  ${title.padEnd(64)} ║`);
  console.log('╚══════════════════════════════════════════════════════════════════╝');
}

function runCommand(cmd, options = {}) {
  try {
    return execSync(cmd, { stdio: 'pipe', encoding: 'utf8', ...options });
  } catch {
    return null;
  }
}

async function runCommandAsync(cmd, description) {
  return new Promise((resolve, reject) => {
    console.log(`🔧 ${description}`);
    console.log(`   $ ${cmd}`);

    const child = spawn(cmd, { shell: true, stdio: 'inherit' });

    child.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ ${description} terminé`);
        resolve(true);
      } else {
        console.error(`❌ Erreur (code ${code})`);
        reject(new Error(`Command failed with code ${code}`));
      }
    });

    child.on('error', (err) => {
      console.error('❌ Erreur:', err.message);
      reject(err);
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// INSTALLATION STEPS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Détecte si on doit proposer le mode natif (sans Docker).
 * Critères : --native explicite, OU pas de Docker + Linux.
 */
function shouldOfferNative() {
  if (process.argv.includes('--native')) return { native: true, reason: 'flag --native' };

  const isLinux = process.platform === 'linux';
  const hasDocker = runCommand('docker --version');
  if (isLinux && !hasDocker) {
    return { native: true, reason: 'Linux détecté, Docker absent' };
  }
  return { native: false };
}

async function offerNativeInstall(reason) {
  logSection('🐧 MODE NATIF SANS DOCKER DISPONIBLE');
  log(COLORS.yellow, `Raison : ${reason}`);
  log(COLORS.cyan, '');
  log(COLORS.cyan, 'Ce package supporte aussi une installation 100% native (sans Docker) :');
  log(COLORS.cyan, '  • PostgreSQL 18 + pgvector via apt');
  log(COLORS.cyan, '  • Services systemd (overmind-mcp, overmind-postgres-mcp)');
  log(COLORS.cyan, '  • Bind 127.0.0.1 (plus sûr)');
  log(COLORS.cyan, '');
  log(COLORS.green, 'Pour lancer l\'install native :');
  log(COLORS.white,   '  sudo overmind-install-native');
  log(COLORS.cyan, '');
  log(COLORS.cyan, 'Le script natif est embarqué dans le package à :');
  log(COLORS.white,   '  /usr/lib/node_modules/overmind-mcp/bin/install-overmind-native.sh');
  log(COLORS.cyan, '');
  log(COLORS.cyan, 'Si Docker est intentionnel, poursuivez ci-dessous.');
  log(COLORS.cyan, '');
}

async function checkDocker() {
  logSection('VÉRIFICATION DOCKER');

  const version = runCommand('docker --version');
  if (!version) {
    log(COLORS.red, '❌ Docker non trouvé');
    console.log('');
    log(COLORS.yellow, '📥 Installation Docker requise:');

    const platform = process.platform;
    if (platform === 'win32') {
      console.log('   Windows: Docker Desktop, Rancher Desktop, ou Podman');
      console.log('   https://www.docker.com/products/docker-desktop/');
    } else if (platform === 'darwin') {
      console.log('   macOS: Docker Desktop, Colima, OrbStack, ou Podman');
      console.log('   https://www.docker.com/products/docker-desktop/');
    } else {
      console.log('   Linux: Docker Engine, Podman, ou rootless Docker');
      console.log('   https://docs.docker.com/engine/install/');
      console.log('   Podman: https://podman.io/getting-started/installation');
    }

    log(COLORS.cyan, '\nAprès installation de Docker, relancez: npm install -g overmind-mcp');
    return false;
  }

  // Détecter le type d'implémentation Docker
  let implType = 'Docker';
  try {
    const dockerInfo = runCommand('docker info --format "{{.ServerVersion}}"');
    if (dockerInfo) {
      // Essayer de détecter Podman
      const podmanCheck = runCommand('docker info --format "{{.OperatingSystem}}"');
      if (podmanCheck && podmanCheck.toLowerCase().includes('podman')) {
        implType = 'Podman';
      }
    }
  } catch (e) {
    // Ignorer les erreurs de détection
  }

  log(COLORS.green, '✅ Docker détecté: ' + version.trim());
  if (implType !== 'Docker') {
    log(COLORS.cyan, '   Implémentation: ' + implType);
  }
  return true;
}

async function setupPostgreSQL() {
  logSection('INSTALLATION POSTGRESQL + PGVECTOR');

  // Check if already exists
  const existingContainer = runCommand(
    'docker ps --filter "name=postgres" --format "{{.Names}}"',
    { stdio: 'pipe' }
  );

  if (existingContainer) {
    log(COLORS.green, '✅ PostgreSQL + pgvector déjà installé');
    log(COLORS.cyan, '   Container: ' + existingContainer.trim());
    return true;
  }

  log(COLORS.yellow, '📦 Installation PostgreSQL + pgvector...');

  try {
    await runCommandAsync(
      'docker pull pgvector/pgvector:pg16',
      'Téléchargement image'
    );

    // Remove existing if stopped
    runCommand('docker rm -f overmind-postgres-pgvector', { stdio: 'pipe' });

    const runCmd = [
      'docker', 'run', '-d',
      '--name', 'overmind-postgres-pgvector',
      '-p', '5432:5432',
      '-e', 'POSTGRES_PASSWORD=overmind_temp_password_change_me',
      '-e', 'POSTGRES_USER=postgres',
      '-v', 'overmind_postgres_data:/var/lib/postgresql/data',
      '--restart', 'unless-stopped',
      'pgvector/pgvector:pg16'
    ].join(' ');

    await runCommandAsync(runCmd, 'Démarrage PostgreSQL');

    log(COLORS.cyan, '\n⏳ Attente démarrage PostgreSQL (20s)...');
    await new Promise(resolve => setTimeout(resolve, 20000));

    // Enable pgvector
    await runCommandAsync(
      `docker exec overmind-postgres-pgvector psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS vector;"`,
      'Activation pgvector'
    );

    log(COLORS.green, '\n✅ PostgreSQL + pgvector installés !');
    return true;
  } catch (error) {
    log(COLORS.red, '❌ Erreur installation PostgreSQL: ' + error.message);
    return false;
  }
}

async function setupConfigFiles() {
  logSection('TÉLÉCHARGEMENT CONFIGURATIONS');

  mkdirSync(INSTALL_DIR, { recursive: true });

  log(COLORS.yellow, '📥 Téléchargement fichiers de configuration...');

  const envExampleUrl = 'https://raw.githubusercontent.com/DeamonDev888/overmind-mcp/main/.env.example';
  const mcpExampleUrl = 'https://raw.githubusercontent.com/DeamonDev888/overmind-mcp/main/.mcp.json.example';

  try {
    // Télécharger .env.example
    const envExampleData = runCommand(`curl -sL --max-time 30 ${envExampleUrl}`);
    if (envExampleData) {
      writeFileSync(join(INSTALL_DIR, '.env.example'), envExampleData);
      log(COLORS.green, '✅ .env.example téléchargé');
    }

    // Télécharger .mcp.json.example
    const mcpExampleData = runCommand(`curl -sL --max-time 30 ${mcpExampleUrl}`);
    if (mcpExampleData) {
      writeFileSync(join(INSTALL_DIR, '.mcp.json.example'), mcpExampleData);
      log(COLORS.green, '✅ .mcp.json.example téléchargé');
    }

    return true;
  } catch (error) {
    log(COLORS.red, '❌ Erreur téléchargement: ' + error.message);
    return false;
  }
}

async function installPostgresMCP() {
  logSection('INSTALLATION OVERMIND-POSTGRES-MCP');

  log(COLORS.yellow, '📦 Installation du serveur MCP PostgreSQL...');

  try {
    // Vérifier si déjà installé
    const checkInstalled = runCommand('npm list -g overmind-postgres-mcp', { stdio: 'pipe' });

    if (checkInstalled && checkInstalled.includes('overmind-postgres-mcp')) {
      log(COLORS.green, '✅ overmind-postgres-mcp déjà installé');
      return true;
    }

    await runCommandAsync(
      'npm install -g overmind-postgres-mcp',
      'Installation overmind-postgres-mcp'
    );

    log(COLORS.green, '✅ overmind-postgres-mcp installé avec succès !');
    return true;
  } catch (error) {
    log(COLORS.yellow, "⚠️  Erreur installation overmind-postgres-mcp: " + error.message);
    log(COLORS.cyan, "💡 Vous pouvez l'installer manuellement: npm install -g overmind-postgres-mcp");
    return false; // Non bloquant
  }
}

function createEnvConfig() {
  logSection('CRÉATION CONFIGURATION');

  mkdirSync(INSTALL_DIR, { recursive: true });

  const envFile = join(INSTALL_DIR, '.env');
  const envExampleFile = join(INSTALL_DIR, '.env.example');
  const mcpFile = join(INSTALL_DIR, '.mcp.json');
  const mcpExampleFile = join(INSTALL_DIR, '.mcp.json.example');
  const postgresEnvFile = join(INSTALL_DIR, '.env.postgres');

  // Copier .env.example → .env si existe
  if (existsSync(envExampleFile) && !existsSync(envFile)) {
    try {
      const content = readFileSync(envExampleFile, 'utf8');
      writeFileSync(envFile, content);
      log(COLORS.green, '✅ .env créé (à partir de .env.example)');
    } catch (e) {
      log(COLORS.yellow, '⚠️ Impossible de copier .env.example: ' + e.message);
    }
  }

  // Créer .env minimal si n'existe pas
  if (!existsSync(envFile)) {
    const envContent = `# OverMind-MCP Environment Configuration
# Généré automatiquement par npm install

# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=overmind_temp_password_change_me
POSTGRES_DB=overmind_memory

# OverMind
OVERMIND_WORKSPACE=${INSTALL_DIR}
OVERMIND_MEMORY_TYPE=postgres

# OpenTelemetry (optionnel)
OTEL_ENABLED=false
`;
    writeFileSync(envFile, envContent);
    log(COLORS.green, '✅ Configuration .env créée: ' + envFile);
  }

  // Créer .env.postgres pour overmind-postgres-mcp
  if (!existsSync(postgresEnvFile)) {
    const postgresEnvContent = `# OverMind-PostgreSQL-MCP Configuration
# Généré automatiquement par OverMind-MCP

# Activer la base de données
USE_DATABASE=true

# PostgreSQL Configuration (compatible OverMind)
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DATABASE=overmind_memory
POSTGRES_USER=postgres
POSTGRES_PASSWORD=overmind_temp_password_change_me

# Additional PostgreSQL Settings
POSTGRES_SSL=false
POSTGRES_MAX_CONNECTIONS=10
POSTGRES_IDLE_TIMEOUT=30000

# Environment
NODE_ENV=production

# OpenRouter Configuration (Qwen3 Embedding 8B - 4096D)
OPENROUTER_API_KEY=sk-or-v1-your_key_here
OPENROUTER_MODEL=qwen/qwen3-embedding-8b
EMBEDDING_PROVIDER=openrouter
EMBEDDING_DIMENSIONS=4096
EMBEDDING_CACHE_SIZE=1000
`;
    writeFileSync(postgresEnvFile, postgresEnvContent);
    log(COLORS.green, '✅ Configuration .env.postgres créée: ' + postgresEnvFile);
  }

  // Copier .mcp.json.example → .mcp.json si existe
  if (existsSync(mcpExampleFile) && !existsSync(mcpFile)) {
    try {
      const content = readFileSync(mcpExampleFile, 'utf8');
      writeFileSync(mcpFile, content);
      log(COLORS.green, '✅ .mcp.json créé (à partir de .mcp.json.example)');
    } catch (e) {
      log(COLORS.yellow, '⚠️ Impossible de copier .mcp.json.example: ' + e.message);
    }
  }
}

async function startPostgreSQL() {
  logSection('VÉRIFICATION POSTGRESQL + PGVECTOR');

  try {
    // Vérifier si PostgreSQL existe déjà (n'importe quel container postgres)
    const anyPostgres = runCommand(
      'docker ps --filter "name=postgres" --filter "publish=5432" --format "{{.Names}}"',
      { stdio: 'pipe' }
    );

    if (anyPostgres) {
      log(COLORS.green, '✅ PostgreSQL déjà actif sur le port 5432');
      log(COLORS.cyan, '   Container: ' + anyPostgres.trim());
      log(COLORS.yellow, '   💡 Utilisation de PostgreSQL existant (pas de création OverMind)');
      return true;
    }

    // Vérifier si le container OverMind existe déjà
    const overmindContainer = runCommand(
      'docker ps -a --filter "name=overmind-postgres-pgvector" --format "{{.Names}}"',
      { stdio: 'pipe' }
    );

    if (overmindContainer) {
      log(COLORS.yellow, '⚠️  Container OverMind existe mais non démarré');
      await runCommandAsync(
        'docker start overmind-postgres-pgvector',
        'Démarrage container OverMind existant'
      );
      return true;
    }

    log(COLORS.yellow, '🚀 Création et démarrage PostgreSQL + pgvector...');

    await runCommandAsync(
      'docker run -d --name overmind-postgres-pgvector -p 5432:5432 -e POSTGRES_PASSWORD=overmind_temp_password_change_me -e POSTGRES_USER=postgres -v overmind_postgres_data:/var/lib/postgresql/data --restart unless-stopped pgvector/pgvector:pg16',
      'Création PostgreSQL OverMind'
    );

    log(COLORS.cyan, '\n⏳ Attente démarrage PostgreSQL (20s)...');
    await new Promise(resolve => setTimeout(resolve, 20000));

    return true;
  } catch (error) {
    log(COLORS.red, '\n⚠️  Erreur démarrage PostgreSQL: ' + error.message);
    return false;
  }
}

async function validatePostgreSQL() {
  logSection('VALIDATION POSTGRESQL');

  log(COLORS.yellow, '🔍 Vérification PostgreSQL + pgvector...\n');

  const containerName = runCommand(
    'docker ps --filter "name=postgres" --format "{{.Names}}"',
    { stdio: 'pipe' }
  );

  if (containerName) {
    log(COLORS.green, `   ✅ PostgreSQL + pgvector: ${containerName.trim()}`);
    return true;
  } else {
    log(COLORS.red, '   ❌ PostgreSQL + pgvector: Non trouvé');
    return false;
  }
}

function showSummary() {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║' + ' '.repeat(64) + '║');
  console.log('║' + COLORS.green + '           ✅ INSTALLATION TERMINÉE !' + COLORS.reset + ' '.repeat(33) + '║');
  console.log('║' + ' '.repeat(64) + '║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');
  log(COLORS.yellow, "📋 COMPOSANTS INSTALLÉS:");
  console.log('');
  console.log('┌─────────────────────────────────────────────────────────────────┐');
  console.log('│ ' + COLORS.cyan + 'Ouvrez votre interface Docker (Containers)' + COLORS.reset + '             │');
  console.log('│ ' + COLORS.cyan + 'Vous verrez le service OverMind actif:' + COLORS.reset + '                     │');
  console.log('│ ' + COLORS.green + '  • PostgreSQL + pgvector (Mémoire Vectorielle)' + COLORS.reset + '            │');
  console.log('│                                                                 │');
  console.log('│ ' + COLORS.green + '  • overmind-postgres-mcp (Serveur MCP PostgreSQL)' + COLORS.reset + '      │');
  console.log('│                                                                 │');
  console.log('│ ' + COLORS.yellow + 'Détails de connexion:' + COLORS.reset + '                                            │');
  console.log('│   • Host: localhost:5432' + '                                          │');
  console.log('│   • User: postgres' + '                                                │');
  console.log('│   • Password: overmind_temp_password_change_me (À CHANGER !)' + '    │');
  console.log('│   • Extension: vector (pgvector)' + '                                    │');
  console.log('│   • Database: overmind_memory' + '                                         │');
  console.log('└─────────────────────────────────────────────────────────────────┘');
  console.log('');
  log(COLORS.yellow, "📁 FICHIERS DE CONFIGURATION:");
  console.log("   • ~/.overmind/.env (Configuration OverMind)");
  console.log("   • ~/.overmind/.env.postgres (Configuration PostgreSQL MCP)");
  console.log("   • ~/.overmind/.mcp.json (Configuration serveurs MCP)");
  console.log('');
  log(COLORS.yellow, "🗂️  HERMES_HOME par agent (NOUVEAU en 2.8.27):");
  console.log("   • Linux/Mac:  ~/.overmind/hermes/agent_<name>/.hermes");
  console.log("   • Windows:    %LOCALAPPDATA%\\overmind\\hermes\\agent_<name>\\.hermes");
  console.log("   • Override:   export OVERMIND_AGENT_HOME=/path/to/agent/home");
  console.log("   • Migration:  node scripts/migrate-hermes-home.mjs");
  console.log('');
  log(COLORS.yellow, "🔧 SERVEURS MCP ACTIFS:");
  console.log("   • overmind (Orchestration d'agents)");
  console.log("   • memory (Gestion mémoire vectorielle)");
  console.log("   • overmind-postgres (PostgreSQL vectoriel)");
  console.log('');
  log(COLORS.yellow, "📚 DOCUMENTATION:");
  console.log("   • https://github.com/DeamonDev888/overmind-mcp");
  console.log("   • https://www.npmjs.com/package/overmind-mcp");
  console.log("   • https://github.com/DeamonDev888/PostgreSQL-MCP-Serveur");
  console.log('');
  log(COLORS.yellow, "🎉 PROCHAINE ÉTAPE:");
  console.log("   • Créez votre premier agent: overmind create-agent");
  console.log("   • Ou listez les agents: overmind list-agents");
  console.log("   • Gestion PostgreSQL: overmind-postgres up/status/down");
  console.log('');
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN
// ═════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║' + ' '.repeat(64) + '║');
  console.log('║' + COLORS.cyan + '     🚀 OVERMIND-MCP - INSTALLATION AUTOMATIQUE' + COLORS.reset + ' '.repeat(25) + '║');
  console.log('║' + ' '.repeat(64) + '║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');

  // Banner
  console.log(COLORS.cyan + 'Ce script VA installer automatiquement:' + COLORS.reset);
  console.log('  ✓ Vérifier Docker');
  console.log('  ✓ Installer PostgreSQL + pgvector (si absent)');
  console.log('  ✓ Télécharger fichiers de configuration');
  console.log('  ✓ Installer overmind-postgres-mcp');
  console.log('  ✓ Démarrer PostgreSQL + pgvector');
  console.log('  ✓ Copier .env.example → .env');
  console.log('  ✓ Copier .mcp.json.example → .mcp.json');
  console.log('  ✓ Valider PostgreSQL');
  console.log('');

  // Step 0: Offre install native (non bloquant)
  const nativeOffer = shouldOfferNative();
  if (nativeOffer.native) {
    await offerNativeInstall(nativeOffer.reason);
    if (process.argv.includes('--native-only')) {
      log(COLORS.green, '→ --native-only : on s\'arrête là. Lance sudo overmind-install-native quand prêt.');
      return;
    }
  }

  // Step 1: Check Docker
  const dockerOk = await checkDocker();
  if (!dockerOk) {
    return;
  }

  // Step 2: Setup PostgreSQL
  await setupPostgreSQL();

  // Step 3: Setup .env et .mcp.json
  createEnvConfig();

  // Step 4: Download config files
  const downloaded = await setupConfigFiles();

  // Step 5: Install overmind-postgres-mcp
  if (downloaded) {
    await installPostgresMCP();
  }

  // Step 6: Start PostgreSQL
  if (downloaded) {
    const started = await startPostgreSQL();
    if (!started) {
      log(COLORS.yellow, '\n⚠️  PostgreSQL non démarré automatiquement.');
    }
  }

  // Step 7: Validate PostgreSQL
  if (downloaded) {
    const ok = await validatePostgreSQL();
    if (ok) {
      logSection('✅ POSTGRESQL + PGVECTOR EST ACTIF');
      log(COLORS.green, '🎉 Installation réussie !');
    } else {
      logSection('⚠️  POSTGRESQL NON DÉMARRÉ');
    }
  }

  // Show final summary
  showSummary();
}

// Run main
main().catch((error) => {
  console.error('\n❌ ERREUR FATALE:', error.message);
  process.exit(1);
});
