import { PostgresMemoryProvider } from '../dist/memory/PostgresMemoryProvider.js';

async function testDbCreation() {
  const provider = new PostgresMemoryProvider();
  console.log('🧪 Test de création de base avec gestion améliorée...');

  try {
    // Test avec une base qui existe déjà
    await provider['ensureDatabaseExists']('agent_sniperbot_analyst');
    console.log('✅ Test 1: Base existante gérée correctement');

    // Test avec une nouvelle base
    await provider['ensureDatabaseExists']('agent_test_fix_' + Date.now());
    console.log('✅ Test 2: Nouvelle base créée avec succès');

    console.log('🎉 Tous les tests ont réussi !');
  } catch (error) {
    console.error('❌ Erreur lors du test:', error.message);
    process.exit(1);
  }
}

testDbCreation();
