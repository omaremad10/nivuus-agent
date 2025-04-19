import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import { t, updateMemory, getUserConfirmation } from '../utils.js';
import type { AgentMemory, ActionStatus } from '../agent/types.js';

let agentMemoryRef: AgentMemory | null = null;
export function setAgentMemoryRef(memory: AgentMemory) {
    agentMemoryRef = memory;
}

export async function writeFileWithConfirmation(filepath: string, content: string): Promise<string> {
    const absolutePath = path.resolve(filepath);
    const actionType = "File Write";
    const target = absolutePath;
    let status: ActionStatus = "Attempted";
    let feedback = "";
    let errorMsg: string | null = null;
    if (agentMemoryRef) updateMemory(agentMemoryRef, actionType, target, status);
    try {
        console.log(chalk.blue(chalk.bold(t('fileWriteConfirmPrompt'))));
        console.log(chalk.yellow(t('fileWriteConfirmProposed', { filepath: absolutePath })));
        const contentSnippet = content.substring(0, 200) + (content.length > 200 ? "..." : "");
        console.log(chalk.blue(t('fileWriteConfirmContent', { contentSnippet })));
        const confirm = await getUserConfirmation(t('confirmWrite'));
        if (!confirm) {
            status = "Cancelled";
            feedback = t('fileWriteCancelled');
            console.log(chalk.yellow(feedback));
            if (agentMemoryRef) updateMemory(agentMemoryRef, actionType, target, status, null);
            return feedback;
        }
        console.log(chalk.cyan(t('fileWriteAttempt', { filepath: absolutePath })));
        await fs.writeFile(absolutePath, content, 'utf-8');
        status = "Success";
        feedback = t('fileWriteSuccess', { filepath: absolutePath });
        console.log(chalk.green(feedback));
        if (agentMemoryRef) updateMemory(agentMemoryRef, actionType, target, status, null);
        return feedback;
    } catch (error: unknown) {
        status = "Failure";
        errorMsg = error instanceof Error ? error.message : String(error);
        feedback = t('fileWriteError', { filepath: absolutePath, message: errorMsg });
        console.error(chalk.red(feedback));
        if (agentMemoryRef) updateMemory(agentMemoryRef, actionType, target, status, errorMsg);
        return `Error: ${feedback}`;
    }
}
