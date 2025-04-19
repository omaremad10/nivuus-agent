import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import { t, updateMemory } from '../utils.js';
import type { AgentMemory } from '../agent/types.js';

let agentMemoryRef: AgentMemory | null = null;
export function setAgentMemoryRef(memory: AgentMemory) {
    agentMemoryRef = memory;
}

export async function listDirectory(directoryPath: string): Promise<string> {
    const absPath = path.resolve(directoryPath);
    if (agentMemoryRef) updateMemory(agentMemoryRef, "ListDirectory", absPath, "Attempted");
    console.log(chalk.cyan(t('listDirectoryAttempt', { path: absPath })));
    try {
        const stats = await fs.stat(absPath);
        if (!stats.isDirectory()) {
            throw new Error(t('listDirectoryNotDir'));
        }
        const entries = await fs.readdir(absPath, { withFileTypes: true });
        let output = t('listDirectoryContentHeader', { path: absPath }) + '\n';
        if (entries.length === 0) {
            output += t('listDirectoryEmpty') + '\n';
        } else {
            entries.forEach(entry => {
                output += t('listDirectoryEntry', { name: entry.name, isDir: entry.isDirectory() ? '/' : '' }) + '\n';
            });
        }
        console.log(chalk.green(t('listDirectorySuccess', { path: absPath })));
        if (agentMemoryRef) updateMemory(agentMemoryRef, "ListDirectory", absPath, "Success");
        return output.trim();
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(chalk.red(t('listDirectoryError', { path: absPath, message: errorMessage })));
        if (agentMemoryRef) updateMemory(agentMemoryRef, "ListDirectory", absPath, "Failure", errorMessage);
        return t('listDirectoryError', { path: absPath, message: errorMessage });
    }
}
