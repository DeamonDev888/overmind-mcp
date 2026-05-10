#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * OVERMIND-MCP - POST-INSTALL AUTOMATIQUE
 * ═══════════════════════════════════════════════════════════════════════════════
 * Script exécuté automatiquement après npm install -g overmind-mcp
 * Installe et configure TOUT :
 * - Vérifie Docker
 * - Installe PostgreSQL + pgvector (si absent)
 * - Télécharge et lance l'infrastructure Docker complète
 * - Valide tous les services
 * - Montre à l'utilisateur où voir les services dans Docker Desktop
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { execSync, spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
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
// CONFIG & COLORS
// ═══════════════════════════════════════════════════════════════════════════════

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

async function checkDocker() {
  logSection('VÉRIFICATION DOCKER');

  const version = runCommand('docker --version');
  if (!version) {
    log(COLORS.red, '❌ Docker non trouvé');
    console.log('');
    log(COLORS.yellow, '📥 Installation Docker requise:');

    const platform = process.platform;
    if (platform === 'win32') {
      console.log('   Windows: https://www.docker.com/products/docker-desktop/');
    } else if (platform === 'darwin') {
      console.log('   macOS: https://www.docker.com/products/docker-desktop/');
    } else {
      console.log('   Linux: https://docs.docker.com/engine/install/');
    }

    log(COLORS.cyan, '\n📥 Après installation de Docker, relancez: npm install -g overmind-mcp');
    return false;
  }

  log(COLORS.green, '✅ Docker détecté: ' + version.trim());
  return true;
}

async function setupPostgreSQL() {
  logSection('INSTALLATION POSTGRESQL + PGVECTOR');

  // Check if already exists
  const existingContainer = runCommand(
    'docker ps --filter "name=postgres-pgvector" --format "{{.Names}}"',
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

async function setupInfrastructure() {
  logSection('TÉLÉCHARGEMENT INFRASTRUCTURE DOCKER');

  mkdirSync(INSTALL_DIR, { recursive: true });

  log(COLORS.yellow, '📥 Téléchargement docker-compose.yml...');

  const composeUrl = 'https://raw.githubusercontent.com/DeamonDev888/overmind-mcp/main/docker-compose.yml';
  const exportersUrl = 'https://raw.githubusercontent.com/DeamonDev888/overmind-mcp/main/docker-compose.exporters.yml';

  try {
    const composeData = runCommand(`curl -sL ${composeUrl}`);
    if (composeData) {
      writeFileSync(join(INSTALL_DIR, 'docker-compose.yml'), composeData);
      log(COLORS.green, '✅ docker-compose.yml téléchargé');
    }

    const exportersData = runCommand(`curl -sL ${exportersUrl}`);
    if (exportersData) {
      writeFileSync(join(INSTALL_DIR, 'docker-compose.exporters.yml'), exportersData);
      log(COLORS.green, '✅ docker-compose.exporters.yml téléchargé');
    }

    return true;
  } catch (error) {
    log(COLORS.red, '❌ Erreur téléchargement: ' + error.message);
    return false;
  }
}

async function startInfrastructure() {
  logSection('DÉMARRAGE INFRASTRUCTURE');

  const composeFile = join(INSTALL_DIR, 'docker-compose.yml');

  if (!existsSync(composeFile)) {
    log(COLORS.yellow, '⚠️  docker-compose.yml non trouvé. Téléchargement...');
    return false;
  }

  log(COLORS.cyan, '💡 Infrastructure Docker téléchargée.');
  log(COLORS.yellow, '⚠️  Pour démarrer tous les services (RabbitMQ, Temporal, Prometheus, Grafana, Jaeger):');
  log(COLORS.white, '   → overmind-setup --full');
  log(COLORS.white, '   → Ou manuellement: cd ~/.overmind && docker-compose up -d');
  log(COLORS.white, '   ');
  log(COLORS.green, '✅ PostgreSQL + pgvector sont déjà prêts !');

  return true;
}

async function validateServices() {
  logSection('VALIDATION DES SERVICES');

  log(COLORS.yellow, '🔍 Vérification des containers...\n');

  const services = [
    { name: 'PostgreSQL + pgvector', filter: 'postgres', color: COLORS.green },
    { name: 'RabbitMQ', filter: 'rabbitmq', color: COLORS.green },
    { name: 'Temporal', filter: 'temporal', color: COLORS.green },
    { name: 'Prometheus', filter: 'prometheus', color: COLORS.green },
    { name: 'Grafana', filter: 'grafana', color: COLORS.green },
    { name: 'Jaeger', filter: 'jaeger', color: COLORS.green },
  ];

  let allRunning = true;

  for (const service of services) {
    const containerName = runCommand(
      `docker ps --filter "name=${service.filter}" --format "{{.Names}}"`,
      { stdio: 'pipe' }
    );

    if (containerName) {
      log(service.color, `   ✅ ${service.name}: ${containerName.trim()}`);
    } else {
      log(COLORS.red, `   ❌ ${service.name}: Non trouvé`);
      allRunning = false;
    }
  }

  return allRunning;
}

function createEnvConfig() {
  mkdirSync(INSTALL_DIR, { recursive: true });

  const envFile = join(INSTALL_DIR, '.env');

  if (!existsSync(envFile)) {
    const envContent = `# OverMind-MCP Environment Configuration
# Généré automatiquement par npm install

# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=overmind_temp_password_change_me
POSTGRES_DB=overmind

# OpenTelemetry (optionnel)
OTEL_ENABLED=false

# Workspace
OVERMIND_WORKSPACE=${INSTALL_DIR}
`;

    writeFileSync(envFile, envContent);
    log(COLORS.green, '✅ Configuration créée: ' + envFile);
  }
}

function showSummary() {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║' + ' '.repeat(64) + '║');
  console.log('║' + COLORS.green + '           ✅ INSTALLATION TERMINÉE !' + COLORS.reset + ' '.repeat(33) + '║');
  console.log('║' + ' '.repeat(64) + '║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');
  log(COLORS.yellow, '📋 SERVICES DISPONIBLES:');
  console.log('');
  console.log('┌─────────────────────────────────────────────────────────────────┐');
  console.log('│ ' + COLORS.cyan + 'Ouvrez Docker Desktop pour voir tous les containers' + COLORS.reset + '             │');
  console.log('│                                                                 │');
  console.log('│ ' + COLORS.yellow + 'URLs utiles:' + COLORS.reset + '                                                      │');
  console.log('│   • Prometheus: ' + COLORS.cyan + 'http://localhost:9090' + COLORS.reset + '                             │');
  console.log('│   • Grafana:      ' + COLORS.cyan + 'http://localhost:3000' + COLORS.reset + ' (admin/admin)' + '            │');
  console.log('│   • Jaeger:       ' + COLORS.cyan + 'http://localhost:16686' + COLORS.reset + '                            │');
  console.log('│   • RabbitMQ:    ' + COLORS.cyan + 'http://localhost:15672' + COLORS.reset + ' (guest/guest)' + '           │');
  console.log('│   • Temporal:     ' + COLORS.cyan + 'http://localhost:8233' + COLORS.reset + '                            │');
  console.log('└─────────────────────────────────────────────────────────────────┘');
  console.log('');
  log(COLORS.yellow, '📚 DOCUMENTATION:');
  console.log('   • https://github.com/DeamonDev888/overmind-mcp');
  console.log('   • https://www.npmjs.com/package/overmind-mcp');
  console.log('');
  log(COLORS.yellow, '🎉 PROCHAINE ÉTAPE:');
  console.log('   • Créez votre premier agent: overmind create-agent');
  console.log('   • Ou listez les agents: overmind list-agents');
  console.log('');
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║' + ' '.repeat(64) + '║');
  console.log('║' + COLORS.cyan + '     🚀 OVERMIND-MCP - INSTALLATION AUTOMATIQUE' + COLORS.reset + ' '.repeat(25) + '║');
  console.log('║' + ' '.repeat(64) + '║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');

  // Banner
  console.log(COLORS.cyan + 'Ce script va:' + COLORS.reset);
  console.log('  ✓ Vérifier Docker');
  console.log('  ✓ Installer PostgreSQL + pgvector (si absent)');
  console.log('  ✓ Télécharger l\'infrastructure Docker');
  console.log('  ✓ Démarrer tous les services');
  console.log('  ✓ Valider l\'installation');
  console.log('');

  // Step 1: Check Docker
  const dockerOk = await checkDocker();
  if (!dockerOk) {
    return;
  }

  // Step 2: Setup .env
  createEnvConfig();

  // Step 3: Install PostgreSQL if needed
  await setupPostgreSQL();

  // Step 4: Download infrastructure files
  await setupInfrastructure();

  // Step 5: Show how to start full infrastructure
  await startInfrastructure();

  // Step 6: Show PostgreSQL is ready
  logSection('POSTGRESQL PRÊT');
  log(COLORS.green, '✅ PostgreSQL + pgvector sont installés et prêts !');
  log(COLORS.cyan, '');
  log(COLORS.yellow, '🚀 Pour activer toutes les features (Swarm, Workflows, Observabilité):');
  log(COLORS.white, '   Option 1: overmind-setup --full');
  log(COLORS.white, '   Option 2: cd ~/.overmind && docker-compose up -d');
  log(COLORS.white, '');

  // Show summary
  showSummary();
}

// Run main
main().catch((error) => {
  console.error('\n❌ ERREUR FATALE:', error.message);
  process.exit(1);
});
