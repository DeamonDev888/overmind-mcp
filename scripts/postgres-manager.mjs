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
import { existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_ROOT = join(__dirname, '..');
const COMPOSE_FILE = join(PROJECT_ROOT, 'docker', 'docker-compose.yml');

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

function commandUp() {
  logSection('DÉMARRAGE POSTGRESQL OVERMIND');

  if (!existsSync(COMPOSE_FILE)) {
    console.error('❌ Fichier docker-compose.yml non trouvé');
    process.exit(1);
  }

  try {
    runCommand(`docker-compose -f "${COMPOSE_FILE}" up -d`);
    console.log('');
    console.log('✅ PostgreSQL + pgvector démarré avec succès !');
    console.log('');
    console.log('📊 Connexion:');
    console.log('   Host: localhost:5432');
    console.log('   Database: overmind_memory');
    console.log('   User: postgres');
    console.log('   Password: overmind_temp_password_change_me');
    console.log('');
    console.log('💪 Extensions: pgvector (4096D) activé');
    console.log('');
  } catch (error) {
    console.error('❌ Erreur démarrage PostgreSQL:', error.message);
    process.exit(1);
  }
}

function commandDown() {
  logSection('ARRÊT POSTGRESQL OVERMIND');

  if (!existsSync(COMPOSE_FILE)) {
    console.error('❌ Fichier docker-compose.yml non trouvé');
    process.exit(1);
  }

  try {
    runCommand(`docker-compose -f "${COMPOSE_FILE}" down`);
    console.log('');
    console.log('✅ PostgreSQL arrêté avec succès !');
    console.log('');
    console.log('💡 Les données sont conservées dans le volume Docker.');
    console.log('');
  } catch (error) {
    console.error('❌ Erreur arrêt PostgreSQL:', error.message);
    process.exit(1);
  }
}

function commandStatus() {
  logSection('ÉTAT POSTGRESQL OVERMIND');

  if (!existsSync(COMPOSE_FILE)) {
    console.error('❌ Fichier docker-compose.yml non trouvé');
    process.exit(1);
  }

  try {
    runCommand(`docker-compose -f "${COMPOSE_FILE}" ps`);
  } catch (error) {
    console.error('❌ Erreur vérification état:', error.message);
    process.exit(1);
  }
}

function commandLogs() {
  logSection('LOGS POSTGRESQL OVERMIND');
  console.log('   (Ctrl+C pour sortir)');
  console.log('');

  if (!existsSync(COMPOSE_FILE)) {
    console.error('❌ Fichier docker-compose.yml non trouvé');
    process.exit(1);
  }

  try {
    runCommand(`docker-compose -f "${COMPOSE_FILE}" logs -f`);
  } catch (error) {
    // Ignore Ctrl+C
  }
}

function commandReset() {
  logSection('RÉINITIALISATION POSTGRESQL OVERMIND');
  console.log('');
  console.log('⚠️  ATTENTION: Cette commande va SUPPRIMER TOUTES LES DONNÉES !');
  console.log('');

  const { confirm } = require('minimist')(process.argv.slice(2));
  if (!confirm) {
    console.log('❌ Annulé. Pour confirmer, utilisez: --confirm');
    console.log('   overmind-postgres reset --confirm');
    process.exit(0);
  }

  if (!existsSync(COMPOSE_FILE)) {
    console.error('❌ Fichier docker-compose.yml non trouvé');
    process.exit(1);
  }

  try {
    console.log('🛑 Arrêt PostgreSQL...');
    runCommand(`docker-compose -f "${COMPOSE_FILE}" down -v`);

    console.log('🗑️  Suppression du volume Docker...');
    runCommand('docker volume rm overmind-postgres-data', { stdio: 'inherit' });

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
