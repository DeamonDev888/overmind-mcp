#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SETUP SCRIPT - Installation Automatique OverMind
 * ═══════════════════════════════════════════════════════════════════════════════
 * Script principal qui installe TOUTES les dépendances nécessaires à OverMind:
 * - Docker (si pas présent)
 * - PostgreSQL + pgvector (si pas présent)
 * - RabbitMQ
 * - Temporal
 * - Configuration automatique
 *
 * Usage:
 *   overmind-setup [--full]
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { execSync, spawn } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createInterface } from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');
const INSTALL_DIR = join(process.env.HOME || process.env.USERPROFILE || process.env.HOMEPATH, '.overmind');

// ═══════════════════════════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════════════════════════

function logSection(title) {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log(`║  ${title.padEnd(64)} ║`);
  console.log('╚══════════════════════════════════════════════════════════════════╝');
}

function runCommand(cmd, description) {
  console.log(`\n🔧 ${description}`);
  console.log(`   $ ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit' });
    console.log(`✅ ${description} terminé`);
    return true;
  } catch (error) {
    console.error(`❌ Erreur: ${error.message}`);
    return false;
  }
}

function runCommandAsync(cmd, description) {
  return new Promise((resolve, reject) => {
    console.log(`\n🔧 ${description}`);
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

async function promptYesNo(question) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise((resolve) => {
    rl.question(`${question} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().startsWith('y'));
    });
  });

  return answer;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHECKS
// ═══════════════════════════════════════════════════════════════════════════════

function checkDocker() {
  try {
    execSync('docker --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function checkPostgreSQL() {
  try {
    execSync('docker ps --filter "name=postgres" --format "{{.Names}}"', { stdio: 'pipe' });
    return true;
  } catch {
    try {
      execSync('psql --version', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INSTALLATION STEPS
// ═══════════════════════════════════════════════════════════════════════════════

async function installDocker() {
  logSection('INSTALLATION DOCKER');

  if (checkDocker()) {
    console.log('✅ Docker est déjà installé');
    return true;
  }

  console.log('ℹ️  Docker non trouvé.');
  console.log('');
  console.log('📥 Docker Desktop est requis pour OverMind-MCP:');
  console.log('   - Windows: https://www.docker.com/products/docker-desktop/');
  console.log('   - Mac: https://www.docker.com/products/docker-desktop/');
  console.log('');
  console.log('📋 Instructions:');
  console.log('   1. Téléchargez et installez Docker Desktop');
  console.log('   2. Démarrez Docker Desktop');
  console.log('   3. Relancez: overmind-setup --full');
  console.log('');

  const answer = await promptYesNo('Voulez-vous ouvrir le site de téléchargement maintenant ?');
  if (answer) {
    const url = process.platform === 'win32'
      ? 'https://www.docker.com/products/docker-desktop/'
      : 'https://www.docker.com/products/docker-desktop/';

    try {
      execSync(`start ${url}`, { stdio: 'inherit' });
      console.log('✅ Navigateur ouvert. Attendez l\'installation de Docker.');
    } catch {
      console.log('⚠️  Impossible d\'ouvrir le navigateur automatiquement.');
      console.log(`   Ouvrez manuellement: ${url}`);
    }
  }

  return false;
}

async function installPostgreSQL() {
  logSection('INSTALLATION POSTGRESQL + PGVECTOR');

  if (checkPostgreSQL()) {
    console.log('✅ PostgreSQL est déjà installé');
    return true;
  }

  console.log('🐳 Installation PostgreSQL + pgvector en Docker...');
  console.log('');

  try {
    // Pull and start PostgreSQL container
    console.log('📥 Téléchargement image pgvector/pgvector:pg16...');
    execSync('docker pull pgvector/pgvector:pg16', { stdio: 'inherit' });

    console.log('🚀 Démarrage container PostgreSQL...');
    const runCommand = `docker run -d --name overmind-postgres-pgvector \\
      -p 5432:5432 \\
      -e POSTGRES_PASSWORD=overmind_temp_password_change_me \\
      -e POSTGRES_USER=postgres \\
      -v overmind_postgres_data:/var/lib/postgresql/data \\
      --restart unless-stopped \\
      pgvector/pgvector:pg16`;

    await runCommandAsync(runCommand, 'Démarrage PostgreSQL');

    // Wait for PostgreSQL to be ready
    console.log('⏳ Attente démarrage PostgreSQL (30s)...');
    await new Promise((resolve) => setTimeout(resolve, 30000));

    // Verify pgvector
    console.log('🔍 Vérification pgvector...');
    await runCommandAsync(
      'docker exec overmind-postgres-pgvector psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS vector;"',
      'Activation pgvector'
    );

    console.log('✅ PostgreSQL + pgvector installés avec succès !');
    return true;

  } catch (error) {
    console.error('❌ Erreur installation PostgreSQL:', error.message);
    return false;
  }
}

function setupConfigurationFiles() {
  logSection('CONFIGURATION OVERMIND');

  // Create install directory
  if (!existsSync(INSTALL_DIR)) {
    mkdirSync(INSTALL_DIR, { recursive: true });
    console.log('✅ Dossier créé:', INSTALL_DIR);
  }

  // Copy docker-compose file
  const dockerComposePath = join(projectRoot, 'docker', 'docker-compose.yml');
  const destComposePath = join(INSTALL_DIR, 'docker-compose.yml');

  if (existsSync(dockerComposePath)) {
    copyFileSync(dockerComposePath, destComposePath);
    console.log('✅ docker-compose.yml copié');
  }

  // Copy .env.example if .env doesn't exist
  const envExamplePath = join(projectRoot, '.env.example');
  const envPath = join(INSTALL_DIR, '.env');

  if (!existsSync(envPath) && existsSync(envExamplePath)) {
    copyFileSync(envExamplePath, envPath);
    console.log('✅ .env créé (à éditer avec vos credentials)');
  }

  // Copy postgres-manager script
  const dockerManagerPath = join(__dirname, 'postgres-manager.mjs');
  const destManagerPath = join(INSTALL_DIR, 'postgres-manager.mjs');

  if (existsSync(dockerManagerPath)) {
    copyFileSync(dockerManagerPath, destManagerPath);
    console.log('✅ Scripts Docker installés');
  }

  return true;
}

async function startDockerServices() {
  logSection('DÉMARRAGE SERVICES DOCKER');

  const composeFile = join(INSTALL_DIR, 'docker-compose.yml');

  console.log('🚀 Démarrage PostgreSQL + pgvector...');
  try {
    await runCommandAsync(
      `docker-compose -f "${composeFile}" up -d`,
      'Démarrage PostgreSQL'
    );
    console.log('✅ PostgreSQL + pgvector démarré');
    return true;
  } catch (error) {
    console.error('❌ Erreur démarrage Docker:', error.message);
    return false;
  }
}

async function createOvermindDatabase() {
  logSection('CRÉATION BASE OVERMIND');

  const setupDbPath = join(__dirname, 'setup-overmind-db.mjs');
  const destDbDir = INSTALL_DIR;
  const destDbPath = join(destDbDir, 'setup-overmind-db.mjs');

  try {
    if (!existsSync(destDbDir)) {
      mkdirSync(destDbDir, { recursive: true });
    }
    copyFileSync(setupDbPath, destDbPath);

    await runCommandAsync(
      `node "${destDbPath}"`,
      'Initialisation DB OverMind'
    );
    return true;
  } catch (error) {
    console.error('❌ Erreur création DB:', error.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const isFull = args.includes('--full');

  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║                                                                ║');
  console.log('║     🧠 OVERMIND-MCP: SETUP AUTOMATISÉ COMPLET                   ║');
  console.log('║                                                                ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');

  if (!isFull) {
    console.log('ℹ️  USAGE: overmind-setup [--full]');
    console.log('');
    console.log('   --full: Installe TOUTES les dépendances (Docker, PostgreSQL, etc.)');
    console.log('           et configure OverMind automatiquement');
    console.log('');
    console.log('   Sans --full: Prépare juste les fichiers de configuration');
    console.log('');

    return;
  }

  // Step 1: Check Docker
  const hasDocker = checkDocker();
  if (!hasDocker) {
    const installed = await installDocker();
    if (!installed) {
      console.log('\n❌ SETUP ANNULÉ - Docker est requis pour le mode complet');
      console.log('   Installez Docker Desktop et relancez: overmind-setup --full');
      process.exit(1);
    }
  }

  // Step 2: Check PostgreSQL
  const hasPostgreSQL = checkPostgreSQL();
  if (!hasPostgreSQL) {
    const installed = await installPostgreSQL();
    if (!installed) {
      console.log('\n❌ SETUP ANNULÉ - PostgreSQL est requis pour le mode complet');
      process.exit(1);
    }
  }

  // Step 3: Setup configuration files
  setupConfigurationFiles();

  // Step 4: Start Docker services
  const servicesStarted = await startDockerServices();
  if (!servicesStarted) {
    console.log('\n❌ SETUP ANNULÉ - Impossible de démarrer les services');
    process.exit(1);
  }

  // Step 5: Create OverMind database
  const dbCreated = await createOvermindDatabase();
  if (!dbCreated) {
    console.log('\n❌ SETUP ANNULÉ - Impossible de créer la base OverMind');
    process.exit(1);
  }

  // Success!
  logSection('✅ SETUP COMPLET TERMINÉ AVEC SUCCÈS');

  console.log(`
🎉 OVERMIND-MCP EST PRÊT !

📋 SERVICES ACTIFS:
   ✅ PostgreSQL + pgvector (Vector DB 4096D)
   ✅ RabbitMQ (Message Broker)
   ✅ Temporal (Workflow Orchestrator)
   ✅ OverMind Agents (prêt à l'emploi)

🌐 INTERFACES:
   📊 RabbitMQ Management: http://localhost:15672
   📈 Temporal Web:       http://localhost:8088
   🗄️  PostgreSQL:         localhost:5432

🚀 COMMANDES DISPONIBLES:
   overmind create-agent --name expert --runner claude
   overmind run-agent --runner claude --prompt "Analyse..."
   overmind-infra up/down/status/logs

📚 DOCUMENTATION:
   - https://deamondev888.github.io/overmind-mcp/
   - https://github.com/DeamonDev888/overmind-mcp
   - Discord: https://discord.gg/4AR82phtBz

💡 PREMIER TEST:
   overmind create-agent --name test --runner claude --prompt "Test d'OverMind"

═══════════════════════════════════════════════════════════════════════
`);
}

// Run main
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('\n❌ ERREUR FATALE:', error.message);
    process.exit(1);
  });
}
