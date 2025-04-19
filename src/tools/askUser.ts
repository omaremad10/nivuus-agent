import chalk from 'chalk';
import { t, getUserInput, updateMemory } from '../utils.js';
import type { AgentMemory } from '../agent/types.js';

let agentMemoryRef: AgentMemory | null = null;
export function setAgentMemoryRef(memory: AgentMemory) {
    agentMemoryRef = memory;
}

export async function askUser(question: string): Promise<string> {
    if (agentMemoryRef) updateMemory(agentMemoryRef, "User Interaction", "Ask Question", "Attempted");
    console.log(chalk.magentaBright(`🤔 ${t('assistantQuestionPrefix')} `) + question);
    const userResponse = await getUserInput(chalk.green(t('promptUserResponse')));
    if (agentMemoryRef) updateMemory(agentMemoryRef, "User Interaction", "Ask Question", "Success");
    return typeof userResponse === 'string' ? userResponse : '';
}
