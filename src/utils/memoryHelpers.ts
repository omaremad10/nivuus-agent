import chalk from 'chalk';
import { t } from '../utils.js';
import { MAX_ACTION_LOG_ENTRIES } from '../config/config.js';
import type { AgentMemory, ActionLogEntry, ActionStatus } from '../agent/types.js';

export function updateMemory(
    memory: AgentMemory | null,
    actionType: string,
    target: string,
    status: ActionStatus,
    errorMsg: string | null | undefined = null
): void {
    if (!memory || typeof memory !== 'object' || !memory.action_log) {
        if (memory && typeof memory === 'object') {
            (memory as AgentMemory).action_log = [];
        } else {
            console.error(chalk.red(t('invalidMemoryUpdate')));
            return;
        }
    }
    const timestamp = new Date().toISOString();
    const logEntry: ActionLogEntry = {
        timestamp,
        actionType,
        target,
        status
    };
    if (errorMsg) {
        logEntry.errorMsg = errorMsg;
    }
    memory.action_log.push(logEntry);
    if (memory.action_log.length > MAX_ACTION_LOG_ENTRIES) {
        memory.action_log.shift();
    }
}
