#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * POSTGRES-MANAGER - Gestion PostgreSQL OverMind
 * ═══════════════════════════════════════════════════════════════════════════════
 * Script simplifié pour gérer PostgreSQL + pgvector OverMind
 *
 * Usage:
 *   overmind-postgres up     Démarrer PostgreSQL
 *   overmind-postgres down   Arrêter PostgreSQL
 *   overmind-postgres status Vérifier l'état
 *   overmind-postgres logs   Voir les logs
 *   overmind-postgres reset  Réinitialiser (⚠️  supprime les données)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { randomBytes } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_ROOT = join(__dirname, '..');
const OVERMIND_DIR = join(
  process.env.HOME || process.env.USERPROFILE || process.env.HOMEPATH || '',
  '.overmind'
);
const ENV_FILE = join(OVERMIND_DIR, '.env');

// ═══════════════════════════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════════════════════════

function logSection(title) {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log(`║  ${title.padEnd(64)} ║`);
  console.log('╚══════════════════════════════════════════════════════════════════╝');
}

function runCommand(cmd, options = {}) {
  try {
    return execSync(cmd, { stdio: 'inherit', ...options });
  } catch (error) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMANDS
// ═══════════════════════════════════════════════════════════════════════════════

function getEnvVar(name) {
  if (!existsSync(ENV_FILE)) return null;
  const content = readFileSync(ENV_FILE, 'utf8');
  const match = content.match(new RegExp(`^${name}=(.+)$`, 'm'));
  return match ? match[1].trim() : null;
}

function commandUp() {
  logSection('DÉMARRAGE POSTGRESQL OVERMIND');

  // Check si PG est déjà en cours
  const running = runCommand('docker ps --filter "name=overmind-postgres" --format "{{.Names}}"', { stdio: 'pipe' });
  if (running && running.trim().length > 0) {
    console.log('✅ PostgreSQL déjà en cours: ' + running.trim());
    return;
  }

  // Lire le password depuis .env ou générer un temporaire
  let pgPassword = getEnvVar('POSTGRES_PASSWORD');
  if (!pgPassword || pgPassword.includes('change_me')) {
    console.log('⚠️  POSTGRES_PASSWORD non trouvé dans ~/.overmind/.env');
    console.log('   Génération d\'un password temporaire...');
    pgPassword = randomBytes(18).toString('base64url');
  }

  const pgUser = getEnvVar('POSTGRES_USER') || 'postgres';
  const pgDb = getEnvVar('POSTGRES_DATABASE') || getEnvVar('POSTGRES_DB') || 'overmind_memory';
  const pgPort = getEnvVar('POSTGRES_PORT') || '5432';

  // Remove ancien container stopped
  runCommand('docker rm -f overmind-postgres-pgvector 2>/dev/null', { stdio: 'pipe' });

  console.log('🚀 Démarrage PostgreSQL + pgvector...');
  const result = runCommand(
    `docker run -d --name overmind-postgres-pgvector ` +
    `-p ${pgPort}:5432 ` +
    `-e POSTGRES_PASSWORD=${pgPassword} ` +
    `-e POSTGRES_USER=${pgUser} ` +
    `-e POSTGRES_DB=${pgDb} ` +
    `-v overmind_postgres_data:/var/lib/postgresql/data ` +
    `--restart unless-stopped ` +
    `pgvector/pgvector:pg16`,
    { stdio: 'pipe' }
  );

  if (!result) {
    console.error('❌ Erreur démarrage PostgreSQL');
    console.error('   Vérifiez que Docker est en cours: docker info');
    process.exit(1);
  }

  console.log('⏳ Attente démarrage (8s)...');
  execSync('sleep 8', { stdio: 'inherit' });

  // Activer pgvector
  runCommand(`docker exec overmind-postgres-pgvector psql -U ${pgUser} -d ${pgDb} -c "CREATE EXTENSION IF NOT EXISTS vector;"`, { stdio: 'pipe' });

  console.log('');
  console.log('✅ PostgreSQL + pgvector démarré !');
  console.log('');
  console.log('📊 Connexion:');
  console.log(`   Host: localhost:${pgPort}`);
  console.log(`   Database: ${pgDb}`);
  console.log(`   User: ${pgUser}`);
  console.log(`   Password: ${pgPassword.substring(0, 8)}... (voir ~/.overmind/.env)`);
  console.log('   Image: pgvector/pgvector:pg16');
  console.log('');
}

function commandDown() {
  logSection('ARRÊT POSTGRESQL OVERMIND');

  const result = runCommand('docker stop overmind-postgres-pgvector 2>/dev/null', { stdio: 'pipe' });
  if (result === null) {
    console.log('⚠️  Container overmind-postgres-pgvector non trouvé ou déjà arrêté');
  } else {
    console.log('');
    console.log('✅ PostgreSQL arrêté !');
    console.log('');
    console.log('💡 Les données sont conservées dans le volume Docker.');
    console.log('');
  }
}

function commandStatus() {
  logSection('ÉTAT POSTGRESQL OVERMIND');

  const running = runCommand('docker ps --filter "name=overmind-postgres" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"', { stdio: 'pipe' });
  const stopped = runCommand('docker ps -a --filter "name=overmind-postgres" --filter "status=exited" --format "{{.Names}}"', { stdio: 'pipe' });

  if (running && running.trim().length > 0) {
    console.log(running);
  } else if (stopped && stopped.trim().length > 0) {
    console.log('⚠️  Container arrêté: ' + stopped.trim());
    console.log('   Démarrez avec: overmind-postgres-mcp up');
  } else {
    console.log('❌ Aucun container PostgreSQL OverMind trouvé');
    console.log('   Démarrez avec: overmind-postgres-mcp up');
  }
}

function commandLogs() {
  logSection('LOGS POSTGRESQL OVERMIND');
  console.log('   (Ctrl+C pour sortir)');
  console.log('');

  try {
    runCommand('docker logs -f overmind-postgres-pgvector');
  } catch {
    // Ignore Ctrl+C
  }
}

function commandReset() {
  logSection('RÉINITIALISATION POSTGRESQL OVERMIND');
  console.log('');
  console.log('⚠️  ATTENTION: Cette commande va SUPPRIMER TOUTES LES DONNÉES !');
  console.log('');

  const args = process.argv.slice(2);
  if (!args.includes('--confirm')) {
    console.log('❌ Annulé. Pour confirmer, utilisez: --confirm');
    console.log('   overmind-postgres-mcp reset --confirm');
    process.exit(0);
  }

  try {
    console.log('🛑 Arrêt PostgreSQL...');
    runCommand('docker rm -f overmind-postgres-pgvector 2>/dev/null');

    console.log('🗑️  Suppression du volume Docker...');
    runCommand('docker volume rm overmind_postgres_data 2>/dev/null', { stdio: 'inherit' });

    console.log('');
    console.log('✅ PostgreSQL réinitialisé avec succès !');
    console.log('');
    console.log('📊 Prochaine étape:');
    console.log('   overmind-postgres up');
    console.log('');
  } catch (error) {
    console.error('❌ Erreur réinitialisation:', error.message);
    process.exit(1);
  }
}

function showHelp() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║     POSTGRES-MANAGER: Gestion PostgreSQL OverMind                ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log('║  Usage:                                                        ║');
  console.log('║    overmind-postgres up          Démarrer PostgreSQL           ║');
  console.log('║    overmind-postgres down        Arrêter PostgreSQL            ║');
  console.log('║    overmind-postgres status     Verifier l\'etat               ║');
  console.log('║    overmind-postgres logs      Voir les logs en temps réel   ║');
  console.log('║    overmind-postgres reset     Réinitialiser (⚠️  données)    ║');
  console.log('║                                                                ║');
  console.log('║  Configuration:                                                 ║');
  console.log('║    Host: localhost:5432                                         ║');
  console.log('║    Database: overmind_memory                                    ║');
  console.log('║    User: postgres                                              ║');
  console.log('║    Extension: pgvector (4096D)                                   ║');
  console.log('║                                                                ║');
  console.log('║  Intégration OverMind:                                          ║');
  console.log('║    • Agents stockés dans overmind_agents                       ║');
  console.log('║    • Mémoires vectorielles dans overmind_memories              ║');
  console.log('║    • Sessions dans overmind_sessions                            ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

const command = process.argv[2] || 'help';

switch (command) {
  case 'up':
    commandUp();
    break;
  case 'down':
    commandDown();
    break;
  case 'status':
    commandStatus();
    break;
  case 'logs':
    commandLogs();
    break;
  case 'reset':
    commandReset();
    break;
  case 'help':
  default:
    showHelp();
    break;
}
