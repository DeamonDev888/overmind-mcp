import { getWorkspaceDir, resetWorkspaceCache } from '../dist/lib/config.js';
import path from 'path';

console.log('--- Config Path Test ---');
console.log('Current __dirname:', path.dirname(new URL(import.meta.url).pathname));
console.log('Current CWD:', process.cwd());

resetWorkspaceCache();
const workspace = getWorkspaceDir();
console.log('Resolved Workspace Dir:', workspace);

if (workspace.toLowerCase().includes('workflow')) {
    console.error('❌ ERROR: Workspace resolved to Workflow subdirectory instead of Root!');
} else {
    console.log('✅ SUCCESS: Workspace resolved to Root.');
}
