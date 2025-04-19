import { spawn, ChildProcess, SpawnOptions } from 'node:child_process';
import chalk from 'chalk';
import { t, updateMemory, getUserConfirmation } from '../utils.js';
import { COMMAND_TIMEOUT_MS } from '../config/config.js';
import type { AgentMemory, ActionStatus } from '../agent/types.js';

let agentMemoryRef: AgentMemory | null = null;
export function setAgentMemoryRef(memory: AgentMemory) {
    agentMemoryRef = memory;
}

export async function runCommand(command: string, purpose: string): Promise<string> {
    // Reinstate Confirmation block
    console.log(chalk.blue(chalk.bold(t('commandConfirmPrompt'))));
    console.log(chalk.yellow(t('commandConfirmProposed', { command }))); 
    console.log(chalk.blue(t('commandConfirmPurpose', { purpose: Buffer.from(purpose || t('notSpecified'), 'utf-8').toString() }))); 
    const confirm = await getUserConfirmation(t('confirmExecute'));

    if (!confirm) {
        console.log(chalk.yellow(t('executionCancelled')));
        if (agentMemoryRef) updateMemory(agentMemoryRef, "Command", command, "Cancelled");
        return t('executionCancelled');
    }
    // End Reinstate Confirmation block

    if (agentMemoryRef) updateMemory(agentMemoryRef, "Command", command, "Attempted");
    console.log(chalk.cyan(t('commandStartExecution', { command })));

    return new Promise((resolve) => {
        const stdoutChunks: string[] = [];
        const stderrChunks: string[] = [];
        let stdoutOutput = "";
        let stderrOutput = "";
        let timedOut = false;

        const spawnOptions: SpawnOptions = {
            shell: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: COMMAND_TIMEOUT_MS,
        };

        const childProcess: ChildProcess = spawn(command, [], spawnOptions);

        if (childProcess.stdout) {
            childProcess.stdout.setEncoding('utf-8');
            childProcess.stdout.on('data', (data: string | Buffer) => stdoutChunks.push(data.toString()));
        }
        if (childProcess.stderr) {
            childProcess.stderr.setEncoding('utf-8');
            childProcess.stderr.on('data', (data: string | Buffer) => stderrChunks.push(data.toString()));
        }

        childProcess.on('error', (err: Error) => {
            console.log(chalk.red(t('commandSpawnError', { message: err.message })));
            stderrChunks.push(`Spawn error: ${err.message}`);
        });
        childProcess.on('timeout', () => {
            const timeoutSeconds = COMMAND_TIMEOUT_MS / 1000;
            console.log(chalk.red(t('commandTimeoutError', { timeout: timeoutSeconds })));
            stderrChunks.push(t('commandTimeoutErrorMsg', { timeout: timeoutSeconds }));
            timedOut = true;
            if (!childProcess.killed) {
                childProcess.kill();
            }
        });
        childProcess.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
            stdoutOutput = stdoutChunks.join('');
            stderrOutput = stderrChunks.join('');
            const finalCode = timedOut ? -1 : (code ?? (signal ? -2 : -1));
            const signalInfo = signal ? `, Signal: ${signal}` : '';
            console.log(chalk.cyan(t('commandEndExecution', { code: finalCode, signalInfo })));
            if (!childProcess.killed) {
                childProcess.kill();
            }
            let fullRawOutput = "";
            if (stdoutOutput) fullRawOutput += `${t('commandOutputStdout')}\n${stdoutOutput.trim()}\n`;
            if (stderrOutput) fullRawOutput += `${t('commandOutputStderr')}\n${stderrOutput.trim()}\n`;
            if (!fullRawOutput && !timedOut && finalCode !== 0) fullRawOutput = t('commandOutputNoOutputCode', { code: finalCode, signalInfo });
            if (!fullRawOutput && finalCode === 0) fullRawOutput = t('commandOutputNoOutputSuccess');
            console.log(chalk.grey(t('commandRawOutputTitle')));
            console.log(chalk.grey(fullRawOutput.substring(0, 500) + (fullRawOutput.length > 500 ? '...' : '')));
            console.log(chalk.grey(t('commandRawOutputEnd')));
            const finalStatus: ActionStatus = finalCode === 0 ? "Success" : "Failure";
            if (agentMemoryRef) updateMemory(agentMemoryRef, "Command", command, finalStatus, stderrOutput.trim());
            resolve(fullRawOutput.trim());
        });
    });
}
