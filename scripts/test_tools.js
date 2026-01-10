
import { createAgent } from '../dist/tools/create_agent.js';
import { runClaudeAgent } from '../dist/tools/run_claude.js';
import { createPrompt, editPrompt } from '../dist/tools/manage_prompts.js';
import { listAgents, deleteAgent, updateAgentConfig } from '../dist/tools/manage_agents.js';
import fs from 'fs';
import path from 'path';

async function runTests() {
    console.log('🧪 Starting Tool Tests (7 Tools)...');
    const agentName = 'agent_test_full';

    // --- TEST 1: CREATE_AGENT ---
    console.log('\n[1/7] Testing create_agent...');
    try {
        const result = await createAgent({
            name: agentName,
            prompt: 'You are a test agent. Always reply "TEST_SUCCESS".',
            model: 'claude-3-haiku-20240307'
        });
        
        console.log('✅ create_agent returned:', JSON.stringify(result, null, 2));

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

    // --- TEST 2: LIST_AGENTS ---
    console.log('\n[2/7] Testing list_agents...');
    try {
        const result = await listAgents({ details: true });
        console.log('✅ list_agents returned:', JSON.stringify(result, null, 2));
        
        if (result.content[0].text.includes(agentName)) {
            console.log(`✅ found '${agentName}' in list.`);
        } else {
            console.warn(`⚠️ '${agentName}' NOT found in list.`);
        }
    } catch (e) {
        console.error('❌ list_agents failed:', e);
    }

    // --- TEST 3: UPDATE_AGENT_CONFIG ---
    console.log('\n[3/7] Testing update_agent_config...');
    try {
        const result = await updateAgentConfig({
            name: agentName,
            model: 'claude-3-opus-20240229',
            env: { 'TEST_VAR': 'updated_value' }
        });
        console.log('✅ update_agent_config returned:', JSON.stringify(result, null, 2));

        const settingsPath = `.claude/settings_${agentName}.json`;
        const content = fs.readFileSync(settingsPath, 'utf8');
        const json = JSON.parse(content);

        if (json.env.ANTHROPIC_MODEL === 'claude-3-opus-20240229' && json.env.TEST_VAR === 'updated_value') {
            console.log('✅ Config update verified on disk.');
        } else {
            console.error('❌ Config mismatch on disk:', json);
        }
    } catch (e) {
        console.error('❌ update_agent_config failed:', e);
    }

    // --- TEST 4: CREATE_PROMPT ---
    console.log('\n[4/7] Testing create_prompt...');
    const promptName = 'test_prompt_standalone';
    const promptContent = '# Persona\nStandalone test.\nTARGET\nEnd';
    try {
        const result = await createPrompt({
            name: promptName,
            content: promptContent
        });
        console.log('✅ create_prompt returned:', JSON.stringify(result, null, 2));
        if (fs.existsSync(`.claude/agents/${promptName}.md`)) console.log('✅ Prompt file exists.');
    } catch (e) {
        console.error('❌ create_prompt failed:', e);
    }

    // --- TEST 5: EDIT_PROMPT ---
    console.log('\n[5/7] Testing edit_prompt...');
    try {
        const result = await editPrompt({
            name: promptName,
            search: 'TARGET',
            replace: 'HIT'
        });
        console.log('✅ edit_prompt returned:', JSON.stringify(result, null, 2));
        const content = fs.readFileSync(`.claude/agents/${promptName}.md`, 'utf8');
        if (content.includes('HIT')) console.log('✅ Edit verified.');
    } catch (e) {
        console.error('❌ edit_prompt failed:', e);
    }

    // --- TEST 6: RUN_AGENT ---
    console.log('\n[6/7] Testing run_agent...');
    try {
        // Warning: This runs with the default settingsM.json (usually agent_news), NOT necessarily the one we just created
        // unless we switch context. But we assume the global 'run_agent' tool works generally.
        // To properly test the NEW agent, we'd need to spawn the server with that specific settings file.
        // Here we just test that the tool execution itself is healthy.
        const output = await runClaudeAgent({
            prompt: "Say only 'TEST_OK'",
            sessionId: "test-7-tools"
        });
        console.log('✅ run_agent output:', JSON.stringify(output, null, 2));
    } catch (e) {
        console.error('❌ run_agent failed:', e);
    }

    // --- TEST 7: DELETE_AGENT ---
    console.log('\n[7/7] Testing delete_agent...');
    try {
        // Delete the full agent
        const result1 = await deleteAgent({ name: agentName });
        console.log('✅ delete_agent (full) result:', JSON.stringify(result1, null, 2));
        
        // Cleanup the standalone prompt too (deleteAgent handles prompts, checking validation)
        // Since deleteAgent expects a matching settings file which won't exist for standalone prompt...
        // Wait, deleteAgent tries to delete both. If settings missing, it just reports error but deletes prompt?
        // Let's explicitly try to delete the standalone prompt using fs to be clean, 
        // OR use deleteAgent which might complain about missing settings but should delete md.
        // Let's stick to cleaning up the main agent test.
        
        if (!fs.existsSync(`.claude/settings_${agentName}.json`)) {
            console.log('✅ Settings file deleted.');
        } else {
             console.error('❌ Settings file still exists!');
        }
    } catch (e) {
        console.error('❌ delete_agent failed:', e);
    }

    // Cleanup standalone prompt manually or ignore
    try { fs.unlinkSync(`.claude/agents/${promptName}.md`); } catch(e){}

    console.log('\n🎉 All 7 tests finished.');
}

runTests();
