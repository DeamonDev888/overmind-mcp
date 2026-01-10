
import fs from 'fs';
import path from 'path';

const Z_PATH = '.claude/settingsZ.json';
const DOC_PATH = '.claude/settings_agent_doc.json';

try {
    // Read Source (Z)
    if (!fs.existsSync(Z_PATH)) {
        console.error(`❌ Source file ${Z_PATH} not found.`);
        process.exit(1);
    }
    const zContent = fs.readFileSync(Z_PATH, 'utf8');
    const zSettings = JSON.parse(zContent);

    // Read Target (Agent Doc)
    if (!fs.existsSync(DOC_PATH)) {
        console.error(`❌ Target file ${DOC_PATH} not found.`);
        process.exit(1);
    }
    const docContent = fs.readFileSync(DOC_PATH, 'utf8');
    const docSettings = JSON.parse(docContent);

    // 1. Copy ENV vars (Keys)
    docSettings.env = {
        ...docSettings.env,
        ...zSettings.env
    };
    
    // Ensure MODEL is preserved if it was set specifically for agent_doc
    // (It was set to sonnet-20241022 in spawn script, checked in previous status)
    // Z might have a different default.
    // We prioritize DOC settings for specific overrides, but Z for keys.
    // Actually, usually Z has the AUTH_TOKEN.
    
    // 2. Set enabledMcpjsonServers
    // User said: "modification is done at the level of 'enabledMcpjsonServers' which are configured correctly by our server"
    // This implies we should enable 'claude-code-runner'
    docSettings.enabledMcpjsonServers = [
        "claude-code-runner"
    ];

    // Write back
    fs.writeFileSync(DOC_PATH, JSON.stringify(docSettings, null, 2));
    console.log(`✅ Updated ${DOC_PATH} with keys from Z and set servers to ["claude-code-runner"]`);

} catch (e) {
    console.error('❌ Error updating settings:', e);
}
