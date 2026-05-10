#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * OVERMIND-MCP - POST-INSTALL AUTOMATIQUE
 * ═════════════════════════════════════════════════════════════════════════════
 * Script exécuté automatiquement après npm install -g overmind-mcp
 * INSTALLE ET DÉMARRE TOUT AUTOMATIQUEMENT :
 * - Vérifie Docker
 * - Installe PostgreSQL + pgvector (si absent)
 * - Copie .env.example → .env
 * - Copie .mcp.json.example → .mcp.json
 * - Télécharge et démarre TOUTE l'infrastructure Docker
 * - Valide tous les services
 * - Montre où les voir dans Docker Desktop
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
// ═════════════════════════════════════════════════════════════════════════════

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

    log(COLORS.cyan, '\nAprès installation de Docker, relancez: npm install -g overmind-mcp');
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
  logSection('TÉLÉCHARGEMENT INFRASTRUCTURE');

  mkdirSync(INSTALL_DIR, { recursive: true });

  log(COLORS.yellow, '📥 Téléchargement fichiers docker-compose...');

  const composeUrl = 'https://raw.githubusercontent.com/DeamonDev888/overmind-mcp/main/docker-compose.yml';
  const exportersUrl = 'https://raw.githubusercontent.com/DeamonDev888/overmind-mcp/main/docker-compose.exporters.yml';
  const envExampleUrl = 'https://raw.githubusercontent.com/DeamonDev888/overmind-mcp/main/.env.example';
  const mcpExampleUrl = 'https://raw.githubusercontent.com/DeamonDev888/overmind-mcp/main/.mcp.json.example';

  try {
    // Télécharger docker-compose.yml
    const composeData = runCommand(`curl -sL ${composeUrl}`);
    if (composeData) {
      writeFileSync(join(INSTALL_DIR, 'docker-compose.yml'), composeData);
      log(COLORS.green, '✅ docker-compose.yml téléchargé');
    }

    // Télécharger docker-compose.exporters.yml
    const exportersData = runCommand(`curl -sL ${exportersUrl}`);
    if (exportersData) {
      writeFileSync(join(INSTALL_DIR, 'docker-compose.exporters.yml'), exportersData);
      log(COLORS.green, '✅ docker-compose.exporters.yml téléchargé');
    }

    // Télécharger .env.example
    const envExampleData = runCommand(`curl -sL ${envExampleUrl}`);
    if (envExampleData) {
      writeFileSync(join(INSTALL_DIR, '.env.example'), envExampleData);
      log(COLORS.green, '✅ .env.example téléchargé');
    }

    // Télécharger .mcp.json.example
    const mcpExampleData = runCommand(`curl -sL ${mcpExampleUrl}`);
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

function createEnvConfig() {
  logSection('CRÉATION CONFIGURATION');

  mkdirSync(INSTALL_DIR, { recursive: true });

  const envFile = join(INSTALL_DIR, '.env');
  const envExampleFile = join(INSTALL_DIR, '.env.example');
  const mcpFile = join(INSTALL_DIR, '.mcp.json');
  const mcpExampleFile = join(INSTALL_DIR, '.mcp.json.example');

  // Copier .env.example → .env si existe
  if (existsSync(envExampleFile) && !existsSync(envFile)) {
    let envContent;

    if (process.platform === 'win32') {
      envContent = runCommand(`type "${envExampleFile}"`, { stdio: 'pipe' });
    } else {
      envContent = runCommand(`cat "${envExampleFile}"`, { stdio: 'pipe' });
    }

    if (envContent) {
      writeFileSync(envFile, envContent);
      log(COLORS.green, '✅ .env créé (à partir de .env.example)');
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
POSTGRES_DB=overmind

# OpenTelemetry (optionnel)
OTEL_ENABLED=false

# Workspace
OVERMIND_WORKSPACE=${INSTALL_DIR}
`;
    writeFileSync(envFile, envContent);
    log(COLORS.green, '✅ Configuration .env créée: ' + envFile);
  }

  // Copier .mcp.json.example → .mcp.json si existe
  if (existsSync(mcpExampleFile) && !existsSync(mcpFile)) {
    let mcpContent;

    if (process.platform === 'win32') {
      mcpContent = runCommand(`type "${mcpExampleFile}"`, { stdio: 'pipe' });
    } else {
      mcpContent = runCommand(`cat "${mcpExampleFile}"`, { stdio: 'pipe' });
    }

    if (mcpContent) {
      writeFileSync(mcpFile, mcpContent);
      log(COLORS.green, '✅ .mcp.json créé (à partir de .mcp.json.example)');
    }
  }
}

async function startInfrastructure() {
  logSection('DÉMARRAGE AUTOMATIQUE INFRASTRUCTURE COMPLÈTE');

  const composeFile = join(INSTALL_DIR, 'docker-compose.yml');

  if (!existsSync(composeFile)) {
    log(COLORS.yellow, '⚠️  docker-compose.yml non trouvé. Téléchargement...');
    const downloaded = await setupInfrastructure();
    if (!downloaded) {
      return false;
    }
  }

  try {
    log(COLORS.yellow, '🚀 Démarrage automatique de TOUS les services...');
    log(COLORS.cyan, '   (PostgreSQL, RabbitMQ, Temporal, Prometheus, Grafana, Jaeger, Redis)');

    await runCommandAsync(
      `cd "${INSTALL_DIR}" && docker-compose -f docker-compose.yml pull`,
      'Téléchargement images Docker'
    );

    await runCommandAsync(
      `cd "${INSTALL_DIR}" && docker-compose -f docker-compose.yml up -d`,
      'Démarrage infrastructure complète'
    );

    log(COLORS.cyan, '\n⏳ Attente démarrage des services (20s)...');
    await new Promise(resolve => setTimeout(resolve, 20000));

    return true;
  } catch (error) {
    log(COLORS.red, '\n⚠️  Erreur démarrage infrastructure: ' + error.message);
    log(COLORS.yellow, '\n💡 Solution manuelle:');
    log(COLORS.white, '   cd ~/.overmind');
    log(COLORS.white, '   docker-compose up -d');
    return false;
  }
}

async function validateServices() {
  logSection('VALIDATION DES SERVICES');

  log(COLORS.yellow, '🔍 Vérification des containers Docker...\n');

  const services = [
    { name: 'PostgreSQL + pgvector', filter: 'postgres', color: COLORS.green },
    { name: 'RabbitMQ', filter: 'rabbitmq', color: COLORS.green },
    { name: 'Temporal', filter: 'temporal', color: COLORS.green },
    { name: 'Prometheus', filter: 'prometheus', color: COLORS.green },
    { name: 'Grafana', filter: 'grafana', color: COLORS.green },
    { name: 'Jaeger', filter: 'jaeger', color: COLORS.green },
    { name: 'Redis', filter: 'redis', color: COLORS.green },
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

function showSummary() {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║' + ' '.repeat(64) + '║');
  console.log('║' + COLORS.green + '           ✅ INSTALLATION TERMINÉE !' + COLORS.reset + ' '.repeat(33) + '║');
  console.log('║' + ' '.repeat(64) + '║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');
  log(COLORS.yellow, '📋 SERVICES ACTIFS DANS DOCKER DESKTOP:');
  console.log('');
  console.log('┌─────────────────────────────────────────────────────────────────┐');
  console.log('│ ' + COLORS.cyan + 'Ouvrez Docker Desktop → onglet "Containers"' + COLORS.reset + '            │');
  console.log('│ ' + COLORS.cyan + 'Vous verrez tous les services OverMind actifs:' + COLORS.reset + '              │');
  console.log('│ ' + COLORS.green + '  • PostgreSQL + pgvector' + COLORS.reset + '                                   │');
  console.log('│ ' + COLORS.green + '  • RabbitMQ (Message Broker)' + COLORS.reset + '                              │');
  console.log('│ ' + COLORS.green + '  • Temporal (Workflow Engine)' + COLORS.reset + '                                │');
  console.log('│ ' + COLORS.green + '  • Prometheus (Métriques)' + COLORS.reset + '                                   │');
  console.log('│ ' + COLORS.green + '  • Grafana (Dashboards)' + COLORS.reset + '                                   │');
  console.log('│ ' + COLORS.green + '  • Jaeger (Tracing)' + COLORS.reset + '                                        │');
  console.log('│ ' + COLORS.green + '  • Redis (Cache)' + COLORS.reset + '                                            │');
  console.log('│                                                                 │');
  console.log('│ ' + COLORS.yellow + 'URLs utiles:' + COLORS.reset + '                                                      │');
  console.log('│   • Prometheus:  ' + COLORS.cyan + 'http://localhost:9090' + COLORS.reset + '                             │');
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
  console.log('  ✓ Télécharger docker-compose.yml et configs');
  console.log('  ✓ Démarrer TOUS les services Docker automatiquement');
  console.log('  ✓ Copier .env.example → .env');
  console.log('  ✓ Copier .mcp.json.example → .mcp.json');
  console.log('  ✓ Valider tous les services');
  console.log('  ✓ Montrer où les voir dans Docker Desktop');
  console.log('');

  // Step 1: Check Docker
  const dockerOk = await checkDocker();
  if (!dockerOk) {
    return;
  }

  // Step 2: Setup PostgreSQL
  await setupPostgreSQL();

  // Step 3: Setup .env et .mcp.json
  createEnvConfig();

  // Step 4: Download infrastructure files
  const downloaded = await setupInfrastructure();

  // Step 5: Start ALL services automatically
  if (downloaded) {
    const started = await startInfrastructure();
    if (!started) {
      log(COLORS.yellow, '\n⚠️  Infrastructure non démarrée automatiquement.');
      log(COLORS.yellow, '   PostgreSQL fonctionne, mais les autres services ne sont pas actifs.');
    }
  }

  // Step 6: Validate ALL services
  if (downloaded) {
    const allOk = await validateServices();
    if (allOk) {
      logSection('✅ TOUS LES SERVICES SONT ACTIFS');
      log(COLORS.green, '🎉 Installation complète réussie !');
    } else {
      logSection('⚠️  CERTAINS SERVICES NON DÉMARRÉS');
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
