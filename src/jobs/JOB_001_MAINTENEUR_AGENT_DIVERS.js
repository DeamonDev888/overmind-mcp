import { execSync } from 'child_process';
import fs from 'fs';

async function runMaintenance() {
    console.log('--- 🛠️  JOB_001: MAINTENANCE AGENT DIVERS (ZERO TOLERANCE) ---');
    console.log('Date:', new Date().toLocaleString());

    let score = 100;
    const reports = [];

    // 1. LINT
    console.log('\n--- 🔍 1. LINT CHECK ---');
    try {
        execSync('npm run lint', { stdio: 'inherit' });
        console.log('✅ LINT: 0 erreur/warning.');
        reports.push('LINT: OK');
    } catch (e) {
        console.error('❌ LINT: Échec ou warnings détectés.');
        score -= 30;
        reports.push('LINT: FAILED');
    }

    // 2. BUILD
    console.log('\n--- 🏗️  2. BUILD CHECK ---');
    try {
        execSync('npm run build', { stdio: 'inherit' });
        console.log('✅ BUILD: 0 erreur TypeScript.');
        reports.push('BUILD: OK');
    } catch (e) {
        console.error('❌ BUILD: Erreur(s) de compilation détectée(s).');
        score -= 40;
        reports.push('BUILD: FAILED');
    }

    // 3. TEST
    console.log('\n--- 🧪 3. TEST CHECK ---');
    try {
        // According to instructions, test should run src/test-agent.ts or npm test
        execSync('npm test', { stdio: 'inherit' });
        console.log('✅ TEST: Réussite totale.');
        reports.push('TEST: OK');
    } catch (e) {
        console.error('❌ TEST: Échec de certains tests.');
        score -= 30;
        reports.push('TEST: FAILED');
    }

    console.log('\n--- 🎯 RAPPORT FINAL ---');
    console.log('Score:', score + '/100');
    console.log('Détails:', reports.join(' | '));

    if (score < 100) {
        console.warn('⚠️ OBJECTIF 0 DÉFAUT NON ATTEINT. Correction manuelle requise.');
        process.exit(1);
    } else {
        console.log('✨ OBJECTIF 0 DÉFAUT ATTEINT. SYSTÈME NOMINAL.');
    }
}

runMaintenance().catch(err => {
    console.error('❌ ERREUR CRITIQUE DANS LE JOB DE MAINTENANCE:', err);
    process.exit(1);
});
