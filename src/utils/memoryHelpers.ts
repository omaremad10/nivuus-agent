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
    // Validate memory object and initialize action_log if necessary
    if (!memory || typeof memory !== 'object' || !memory.action_log) {
        if (memory && typeof memory === 'object') {
            (memory as AgentMemory).action_log = [];
        } else {
            console.error(chalk.red(t('invalidMemoryUpdate')));
            return;
        }
    }
    // Create a new log entry with timestamp and action details
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
    // Add the new log entry to the action_log
    memory.action_log.push(logEntry);
    // Ensure the action_log does not exceed the maximum allowed entries
    if (memory.action_log.length > MAX_ACTION_LOG_ENTRIES) {
        memory.action_log.shift();
    }
}
