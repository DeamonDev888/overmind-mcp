import fs from 'fs/promises';
import path from 'path';
import { CONFIG } from './config.js';

const SESSIONS_FILE = '.claude/sessions.json';

function getSessionsPath(): string {
    // Resolve relative to CWD or setup logic similar to config
    // For simplicity, we assume .claude is in CWD or relative to project root
    return path.resolve(process.cwd(), SESSIONS_FILE);
}

export async function getLastSessionId(agentName: string): Promise<string | null> {
    try {
        const filePath = getSessionsPath();
        const content = await fs.readFile(filePath, 'utf-8');
        const sessions = JSON.parse(content);
        return sessions[agentName] || null;
    } catch (error) {
        return null; // File doesn't exist or error reading
    }
}

export async function saveSessionId(agentName: string, sessionId: string): Promise<void> {
    const filePath = getSessionsPath();
    const dir = path.dirname(filePath);
    
    try {
        await fs.mkdir(dir, { recursive: true });
        
        let sessions: Record<string, string> = {};
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            sessions = JSON.parse(content);
        } catch (e) {
            // Ignore error (file new)
        }

        sessions[agentName] = sessionId;
        await fs.writeFile(filePath, JSON.stringify(sessions, null, 2), 'utf-8');
    } catch (error) {
        console.error(`Failed to save session ID for ${agentName}:`, error);
    }
}
