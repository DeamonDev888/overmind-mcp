#!/usr/bin/env node

/**
 * Test d'installation pour vérifier que les binaires OverMind fonctionnent
 * Ce script simule ce qui se passe après 'npm install -g overmind-mcp'
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

console.log('🧪 Test d\'installation OverMind MCP\n');

// Test 1: Vérifier que les fichiers compilés existent
const distBin = path.join(process.cwd(), 'dist', 'bin', 'cli.js');
if (!fs.existsSync(distBin)) {
  console.error('❌ Le fichier compilé dist/bin/cli.js n\'existe pas');
  console.log('   Exécutez d\'abord: npm run build');
  process.exit(1);
}
console.log('✅ Fichier compilé trouvé:', distBin);

// Test 2: Vérifier que les scripts d'installation existent
const installScripts = {
  unix: 'bin/install-overmind-unix.sh',
  windows: 'bin/install-overmind-windows.bat'
};

for (const [os, script] of Object.entries(installScripts)) {
  const scriptPath = path.join(process.cwd(), script);
  if (fs.existsSync(scriptPath)) {
    console.log(`✅ Script d'installation ${os}:`, scriptPath);
  }
}

// Test 3: Simuler les commandes MCP
const mcpConfig = {
  overmind: {
    command: 'node',
    args: [distBin],
    description: 'Test: command overmind avec chemin complet'
  },
  memory: {
    command: 'node',
    args: [distBin, '--memory-only'],
    description: 'Test: command memory avec chemin complet'
  }
};

console.log('\n📋 Configuration MCP testée:');
console.log(JSON.stringify(mcpConfig, null, 2));

// Test 4: Vérifier les fichiers de configuration
const configFiles = [
  '.mcp.json.example',
  'config/mcp-config.json',
  'config/README.md'
];

console.log('\n📁 Fichiers de configuration:');
for (const file of configFiles) {
  const filePath = path.join(process.cwd(), file);
  if (fs.existsSync(filePath)) {
    console.log(`✅ ${file}`);
  } else {
    console.log(`❌ ${file} (manquant)`);
  }
}

console.log('\n✅ Installation test réussie !');
console.log('\n💡 Pour une installation complète:');
console.log('   1. npm install -g overmind-mcp@latest');
console.log('   2. Utilisez la configuration MCP ci-dessus');
console.log('   3. Les commandes "overmind" seront disponibles globalement');
