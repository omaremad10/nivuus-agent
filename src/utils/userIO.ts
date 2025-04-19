import readline from 'node:readline';
import chalk from 'chalk';
import { t } from '../utils.js';

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
    const yesStr = t('commandConfirmYes').toLowerCase();
    const noStr = t('commandConfirmNo').toLowerCase();
    while (true) {
        const answer = await getUserInput(`${question} ${t('yesNo')}: `);
        const lowerAnswer = answer.toLowerCase();
        if (lowerAnswer === 'y' || lowerAnswer === 'o' || lowerAnswer === yesStr) {
            return true;
        }
        if (lowerAnswer === 'n' || lowerAnswer === noStr) {
            return false;
        }
        console.log(chalk.yellow(t('pleaseAnswerYesNo')));
    }
}
