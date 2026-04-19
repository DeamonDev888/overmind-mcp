import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

async function runMaintenance() {
    console.log('--- 🛠️  JOB_002: MAINTENANCE WORKFLOW (ZERO TOLERANCE) ---');
    console.log('Date:', new Date().toLocaleString());

    let score = 100;
    const reports = [];

    // 1. LINT
    console.log('\n--- 🔍 1. LINT CHECK ---');
    try {
        console.log('Running: npm run lint');
        execSync('npm run lint', { stdio: 'inherit' });
        console.log('✅ LINT: 0 erreur/warning.');
        reports.push('LINT: OK');
    } catch (e) {
        console.error('❌ LINT: Échec ou warnings détectés. Tentative de correction automatique...');
        try {
            execSync('npm run lint:fix', { stdio: 'inherit' });
            execSync('npm run lint', { stdio: 'inherit' });
            console.log('✅ LINT: Corrigé via lint:fix.');
            reports.push('LINT: FIXED');
        } catch (e2) {
            console.error('❌ LINT: Échec persistent même après lint:fix.');
            score -= 25;
            reports.push('LINT: FAILED');
        }
    }

    // 2. BUILD
    console.log('\n--- 🏗️  2. BUILD CHECK ---');
    try {
        console.log('Running: npm run rebuild');
        execSync('npm run rebuild', { stdio: 'inherit' });
        console.log('✅ BUILD: 0 erreur TypeScript.');
        reports.push('BUILD: OK');
    } catch (e) {
        console.warn('⚠️ BUILD: Échec de npm run rebuild (possiblement EBUSY sur Windows). Tentative de build simple (tsc)...');
        try {
            execSync('npx tsc', { stdio: 'inherit' });
            console.log('✅ BUILD: Réussite via tsc (sans rimraf).');
            reports.push('BUILD: OK (TSC)');
        } catch (e2) {
            console.error('❌ BUILD: Erreur de compilation persistent.');
            score -= 35;
            reports.push('BUILD: FAILED');
        }
    }

    // 3. TEST
    console.log('\n--- 🧪 3. TEST CHECK ---');
    try {
        console.log('Running: npm run test');
        execSync('npm run test', { stdio: 'inherit' });
        console.log('✅ TEST: Réussite totale (vitest).');
        reports.push('TEST: OK');
    } catch (e) {
        console.error('❌ TEST: Échec de certains tests.');
        score -= 30;
        reports.push('TEST: FAILED');
    }

    // 4. ENV CHECK
    console.log('\n--- 📋 4. ENV CHECK ---');
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        const requiredKeys = [
            'POSTGRES_HOST',
            'POSTGRES_PORT',
            'POSTGRES_USER',
            'POSTGRES_PASSWORD',
            'ANTHROPIC_AUTH_TOKEN',
            'OVERMIND_EMBEDDING_DIMENSIONS'
        ];
        const missing = requiredKeys.filter(key => !envContent.includes(key));
        if (missing.length === 0) {
            console.log('✅ ENV: Toutes les variables critiques sont présentes.');
            reports.push('ENV: OK');
        } else {
            console.error('❌ ENV: Variables manquantes:', missing.join(', '));
            score -= 10;
            reports.push('ENV: INCOMPLETE');
        }
    } else {
        console.error('❌ ENV: Fichier .env introuvable.');
        score -= 10;
        reports.push('ENV: MISSING');
    }

    console.log('\n--- 🎯 RAPPORT FINAL ---');
    console.log('Score:', score + '/100');
    console.log('Détails:', reports.join(' | '));

    if (score < 100) {
        console.warn('\n⚠️ OBJECTIF 0 DÉFAUT NON ATTEINT. Le Contremaître doit intervenir.');
        process.exit(1);
    } else {
        console.log('\n✨ OBJECTIF 0 DÉFAUT ATTEINT. LE WORKFLOW EST NOMINAL.');
        process.exit(0);
    }
}

runMaintenance().catch(err => {
    console.error('❌ ERREUR CRITIQUE DANS LE JOB DE MAINTENANCE WORKFLOW:', err);
    process.exit(1);
});
