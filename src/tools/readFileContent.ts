import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import { t, updateMemory } from '../utils.js';
import { MAX_DIRECT_READ_SIZE } from '../config/config.js';
import type { AgentMemory } from '../agent/types.js';

let agentMemoryRef: AgentMemory | null = null;
export function setAgentMemoryRef(memory: AgentMemory) {
    agentMemoryRef = memory;
}

export async function readFileContent(filepath: string): Promise<string> {
    const absPath = path.resolve(filepath);
    if (agentMemoryRef) updateMemory(agentMemoryRef, "DirectRead", absPath, "Attempted");
    console.log(chalk.cyan(t('readFileAttempt', { path: absPath })));
    try {
        const stats = await fs.stat(absPath);
        if (!stats.isFile()) throw new Error(t('readFileNotFile'));
        if (stats.size > MAX_DIRECT_READ_SIZE) throw new Error(t('readFileTooLarge', { size: stats.size, maxSize: MAX_DIRECT_READ_SIZE }));
        let content: string | null = null;
        const encodings: BufferEncoding[] = ['utf-8', 'latin1'];
        for (const enc of encodings) {
            try {
                content = await fs.readFile(absPath, enc);
                console.log(chalk.green(t('readFileReadSuccessEncoding', { encoding: enc })));
                break;
            } catch (readErr: any) {
                if (readErr?.code === 'ERR_INVALID_ARG_VALUE' || readErr instanceof TypeError) continue;
                throw readErr;
            }
        }
        if (content === null) {
            const buffer = await fs.readFile(absPath);
            if (buffer.indexOf(0) !== -1) throw new Error(t('readFileBinary'));
            else throw new Error(t('readFileEncodingError'));
        }
        console.log(chalk.green(t('readFileReadSuccess', { path: absPath })));
        if (agentMemoryRef) updateMemory(agentMemoryRef, "DirectRead", absPath, "Success");
        return t('readFileContentHeader', { path: absPath, content });
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(chalk.red(t('readFileError', { path: absPath, message: errorMessage })));
        if (agentMemoryRef) updateMemory(agentMemoryRef, "DirectRead", absPath, "Failure", errorMessage);
        return t('readFileError', { path: absPath, message: errorMessage });
    }
}
