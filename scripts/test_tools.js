
import { createAgent } from '../dist/tools/create_agent.js';
import { runClaudeAgent } from '../dist/tools/run_claude.js';
import fs from 'fs';
import path from 'path';

import { createPrompt, editPrompt } from '../dist/tools/manage_prompts.js';

async function runTests() {
    console.log('🧪 Starting Tool Tests (4 Tools)...');

    // --- TEST 1: CREATE_AGENT ---
    console.log('\n[1/4] Testing create_agent...');
    const agentName = 'agent_test_auto';
    try {
        const result = await createAgent({
            name: agentName,
            prompt: 'You are a test agent. Always reply "TEST_SUCCESS".',
            model: 'claude-3-haiku-20240307'
        });
        
        console.log('✅ create_agent returned:', JSON.stringify(result, null, 2));

        // Verify files exist
        const settingsPath = `.claude/settings_${agentName}.json`;
        const promptPath = `.claude/agents/${agentName}.md`;

        if (fs.existsSync(settingsPath) && fs.existsSync(promptPath)) {
            console.log('✅ Files created successfully.');
        } else {
            console.error('❌ Files missing!');
            process.exit(1);
        }

    } catch (e) {
        console.error('❌ create_agent failed:', e);
        process.exit(1);
    }

    // --- TEST 2: CREATE_PROMPT ---
    console.log('\n[2/4] Testing create_prompt...');
    const promptName = 'test_prompt_manual';
    const promptContent = '# Persona\nJe suis un prompt de test.\nTARGET_WORD\nFin';
    try {
        const result = await createPrompt({
            name: promptName,
            content: promptContent
        });
        console.log('✅ create_prompt returned:', JSON.stringify(result, null, 2));

        // Verify file
        const promptFilePath = `.claude/agents/${promptName}.md`;
        if (fs.existsSync(promptFilePath)) {
            const content = fs.readFileSync(promptFilePath, 'utf-8');
            if (content === promptContent) {
                console.log('✅ Prompt file created and content matches.');
            } else {
                console.error('❌ Content mismatch!');
            }
        } else {
            console.error('❌ Prompt file missing!');
        }

    } catch (e) {
        console.error('❌ create_prompt failed:', e);
    }

    // --- TEST 3: EDIT_PROMPT ---
    console.log('\n[3/4] Testing edit_prompt...');
    try {
        const result = await editPrompt({
            name: promptName,
            search: 'TARGET_WORD',
            replace: 'REPLACED_WORD'
        });
        console.log('✅ edit_prompt returned:', JSON.stringify(result, null, 2));

        const promptFilePath = `.claude/agents/${promptName}.md`;
        const content = fs.readFileSync(promptFilePath, 'utf-8');
        if (content.includes('REPLACED_WORD') && !content.includes('TARGET_WORD')) {
             console.log('✅ Edit confirmed in file content.');
        } else {
             console.error('❌ Edit failed or not saved.');
        }

    } catch (e) {
        console.error('❌ edit_prompt failed:', e);
    }

    // --- TEST 4: RUN_AGENT ---
    console.log('\n[4/4] Testing run_agent (Simple Echo)...');
    try {
        const output = await runClaudeAgent({
            prompt: "Reply with only the word: PASSED",
            sessionId: "test-session-123"
        });

        console.log('✅ run_agent output:', JSON.stringify(output, null, 2));

        if (JSON.stringify(output).includes("PASSED")) {
            console.log('✅ Response content verified.');
        } else {
            console.warn('⚠️ Response content did not match expected "PASSED". Check logs.');
        }

    } catch (e) {
        console.error('❌ run_agent failed:', e);
    }

    console.log('\n🎉 All 4 tests finished.');
}

runTests();
