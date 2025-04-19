import readline from 'node:readline';
import chalk from 'chalk';
import { t } from './utils.js';

let activeReadlineInterface: readline.Interface | null = null;

export function closeActiveReadlineInterface(): void {
    if (activeReadlineInterface) {
        activeReadlineInterface.close();
        activeReadlineInterface = null;
    }
}

export function getUserInput(prompt: string): Promise<string> {
    closeActiveReadlineInterface();
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    activeReadlineInterface = rl;
    return new Promise<string>((resolve) => {
        rl.question(prompt, (answer) => {
            resolve(answer.trim());
        });
    }).finally(() => {
        if (activeReadlineInterface === rl) {
            rl.close();
            activeReadlineInterface = null;
        } else if (!activeReadlineInterface) {
            rl.close();
        }
    });
}

export async function getUserConfirmation(question: string): Promise<boolean> {
    return new Promise((resolve) => {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        process.stdout.write(`${question} ${t('yesNo')}: `);
        function onKeypress(key: string) {
            const k = key.toLowerCase();
            if (k === 'y' || k === 'o') {
                process.stdout.write(k + '\n');
                cleanup();
                resolve(true);
            } else if (k === 'n') {
                process.stdout.write(k + '\n');
                cleanup();
                resolve(false);
            } else if (k === '\u0003') { // Ctrl+C
                cleanup();
                process.exit();
            }
        }
        function cleanup() {
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdin.removeListener('data', onKeypress);
        }
        process.stdin.on('data', onKeypress);
    });
}
