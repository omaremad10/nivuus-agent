import readline from 'node:readline';
import chalk from 'chalk';
import { t } from '../utils.js';
import { currentLocale } from '../utils.js';

let activeReadlineInterface: readline.Interface | null = null;

export function closeActiveReadlineInterface(): void {
    if (activeReadlineInterface) {
        activeReadlineInterface.close();
        activeReadlineInterface = null;
    }
}

export function getUserInput(prompt: string): Promise<string> {
    closeActiveReadlineInterface();
    return new Promise<string>((resolve) => {
        const lines: string[] = [''];
        let currentLine = 0;
        let cursor = 0;
        let lastWasEmpty = false;
        let lastLines = 1; // Always at least 1 input line
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        // Show prompt and instruction only once
        process.stdout.write(prompt);
        process.stdout.write(chalk.gray('\n' + t('inputEndInstruction') + '\n'));
        redraw();
        function redraw() {
            // Move to the bottom of the input block before clearing/redrawing
            if (lastLines > 1) {
                process.stdout.write(`\x1b[${lastLines - 1}E`);
            }
            // Move to the top of the input block
            if (lastLines > 1) {
                process.stdout.write(`\x1b[${lastLines - 1}F`);
            }
            // Clear only the old user input lines
            for (let i = 0; i < lastLines; i++) {
                process.stdout.write('\x1b[2K\r');
                if (i < lastLines - 1) process.stdout.write('\x1b[1B');
            }
            // Move back to the top of the block to reprint
            if (lastLines > 1) {
                process.stdout.write(`\x1b[${lastLines - 1}F`);
            }
            // Print all user input lines
            for (let i = 0; i < lines.length; i++) {
                process.stdout.write((i === currentLine ? '> ' : '  ') + lines[i]);
                if (i < lines.length - 1) process.stdout.write('\n');
            }
            // Move cursor up if needed
            if (lines.length - 1 - currentLine > 0) {
                process.stdout.write(`\x1b[${lines.length - 1 - currentLine}A`);
            }
            // Place cursor at the correct column
            process.stdout.write(`\r\x1b[${2 + cursor}C`);
            lastLines = lines.length;
        }
        function cleanup() {
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdin.removeListener('data', onData);
            process.stdout.write('\n');
        }
        function onData(chunk: string) {
            // Handle paste (multiple characters at once)
            for (let i = 0; i < chunk.length; i++) {
                const c = chunk[i];
                if (c === '\u0003') { // Ctrl+C
                    cleanup();
                    process.exit();
                } else if (c === '\r' || c === '\n') { // Enter
                    if (lines[currentLine] === '') {
                        if (lastWasEmpty) {
                            cleanup();
                            resolve(lines.join('\n').replace(/\n+$/,''));
                            return;
                        }
                        lastWasEmpty = true;
                    } else {
                        lastWasEmpty = false;
                    }
                    lines.splice(currentLine + 1, 0, '');
                    currentLine++;
                    cursor = 0;
                } else if (c === '\u007f' || c === '\b') { // Backspace
                    if (lines[currentLine] && cursor > 0) {
                        lines[currentLine] = lines[currentLine]!.slice(0, cursor - 1) + lines[currentLine]!.slice(cursor);
                        cursor--;
                    } else if (cursor === 0 && currentLine > 0) {
                        const prev = lines[currentLine - 1];
                        const curr = lines[currentLine];
                        if (typeof prev === 'string' && typeof curr === 'string') {
                            cursor = prev.length;
                            lines[currentLine - 1] = prev + curr;
                            lines.splice(currentLine, 1);
                            currentLine--;
                        }
                    }
                } else if (chunk.slice(i, i+3) === '\u001b[A') { // Up arrow
                    i += 2;
                    if (currentLine > 0) {
                        currentLine--;
                        cursor = Math.min(cursor, lines[currentLine]?.length ?? 0);
                    }
                } else if (chunk.slice(i, i+3) === '\u001b[B') { // Down arrow
                    i += 2;
                    if (currentLine < lines.length - 1) {
                        currentLine++;
                        cursor = Math.min(cursor, lines[currentLine]?.length ?? 0);
                    }
                } else if (chunk.slice(i, i+3) === '\u001b[D') { // Left arrow
                    i += 2;
                    if (cursor > 0) {
                        cursor--;
                    } else if (currentLine > 0 && lines[currentLine - 1] !== undefined) {
                        currentLine--;
                        cursor = lines[currentLine]?.length ?? 0;
                    }
                } else if (chunk.slice(i, i+3) === '\u001b[C') { // Right arrow
                    i += 2;
                    if (lines[currentLine] && cursor < lines[currentLine]!.length) {
                        cursor++;
                    } else if (currentLine < lines.length - 1) {
                        currentLine++;
                        cursor = 0;
                    }
                } else if (typeof c === 'string' && c >= ' ' && c.length === 1 && lines[currentLine] !== undefined) { // Printable character
                    lines[currentLine] = lines[currentLine]!.slice(0, cursor) + c + lines[currentLine]!.slice(cursor);
                    cursor++;
                }
            }
            redraw();
        }
        process.stdin.on('data', onData);
    });
}

function getUserKey(question: string, answers: string[]) : Promise<string> {
    return new Promise((resolve) => {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        const answersString = answers.join(', ');
        process.stdout.write(`${question} (${answersString}): `);
        function onKeypress(key: string) {
            const k = key.toLowerCase();
            if (answers.includes(k)) {
                process.stdout.write(k + '\n');
                cleanup();
                resolve(k);
            } else if (k === '\u0003') { // Ctrl+C
                cleanup();
                process.exit();
            }
            else {
                process.stdout.write(chalk.red(`\n${t('invalidInput', { answers: answersString })}\n`));
                process.stdout.write(`${question} (${answersString}): `);
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

export async function getUserConfirmation(question: string): Promise<boolean> {
    // Key choices according to language
    const yesKey = t('commandConfirmYes').charAt(0).toLowerCase();
    const noKey = t('commandConfirmNo').charAt(0).toLowerCase();
    const result = await getUserKey(question, [yesKey, noKey]);

    if (result === yesKey) {
        return true;
    } else if (result === noKey) {
        return false;
    } else {
        console.error(chalk.red(t('invalidYesNoInput')));
        return false;
    }
}

/**
 * Displays a list of choices and allows the user to select an option or enter a custom response.
 * @param question The question to display
 * @param choices Array of proposed choices (strings)
 * @param otherLabel Label for the "Other" option (default: "Other...")
 * @returns The value chosen or entered by the user
 */
export async function selectFromChoices(question: string, choices: string[], otherLabel = t('otherLabel')): Promise<string> {
    const otherNum = choices.length + 1;
    const choicesWithOtherStrings = [...choices, otherLabel].map((choice, idx) => `${idx + 1}`);
    console.log(chalk.white(`${otherNum}. ${otherLabel}`));
    const response = await getUserKey(chalk.green(`${question} (1-${otherNum}): `), choicesWithOtherStrings);
    const num = parseInt(response, 10);
    if (!isNaN(num) && num >= 1 && num <= choices.length) {
        return choices[num - 1] ?? '';
    } else if (num === otherNum) {
        const custom = await getUserInput(chalk.green(t('customResponsePrompt')));
        return custom;
    } else {
        console.error(chalk.red(t('invalidNumberInput')));
        return '';
    }
}
