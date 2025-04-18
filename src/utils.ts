import readline from 'node:readline';
import fs from 'node:fs/promises';
import chalk from 'chalk';
import { MAX_ACTION_LOG_ENTRIES } from './config.js';
import { strings } from './locales.js'; // Import strings
import type { AgentMemory, ActionLogEntry, ActionStatus } from './agent.js'; // Import types

// --- State for managing active readline interface ---
let activeReadlineInterface: readline.Interface | null = null;

/**
 * Closes the currently active readline interface, if any.
 * This is crucial for handling SIGINT gracefully.
 */
export function closeActiveReadlineInterface(): void {
    if (activeReadlineInterface) {
        activeReadlineInterface.close();
        activeReadlineInterface = null; // Clear the reference
        // console.log(chalk.dim('[utils] Closed active readline interface.')); // Optional debug log
    }
}
// --- End State ---

// Define available locales explicitly based on the strings object
type Locale = keyof typeof strings;

// --- Locale Detection and Translation ---
let currentLocale: Locale = 'en'; // Default to English
try {
    // Use optional chaining and provide a fallback for locale string
    const systemLocale = Intl.DateTimeFormat().resolvedOptions().locale ?? process.env.LANG ?? 'en-US';
    // Ensure split result is handled safely
    const langPart = systemLocale.split(/[-_]/)[0]?.toLowerCase();
    // Check if langPart is a valid key of strings
    if (langPart && langPart in strings) {
        currentLocale = langPart as Locale;
    }
    console.log(chalk.dim(`Detected locale: ${systemLocale}, using language: ${currentLocale}`));
} catch (e) {
    console.error(chalk.yellow("Could not detect system locale, defaulting to English."), e);
}

// Define the type for translation keys based on the 'en' locale (assuming all locales have the same keys)
type TranslationKey = keyof typeof strings.en;

// Translation function
export function t(key: TranslationKey, params: Record<string, string | number | boolean> = {}): string {
    // Ensure key access is type-safe
    let str = strings[currentLocale]?.[key] ?? strings.en[key]; // Fallback to English
    if (!str) {
        console.warn(chalk.yellow(`Missing translation key: ${key} for locale: ${currentLocale}`));
        return `[${key}]`; // Return key as fallback
    }
    // Replace placeholders like {paramName}
    for (const [paramKey, paramValue] of Object.entries(params)) {
        str = str.replace(`{${paramKey}}`, String(paramValue));
    }
    return str;
}

// --- User Interaction ---
/**
 * Prompts the user for input using readline.
 * Manages the active readline interface for SIGINT handling.
 * @param prompt The prompt message to display.
 * @returns A promise that resolves with the user's trimmed input.
 */
export function getUserInput(prompt: string): Promise<string> {
    // Ensure any lingering interface is closed before creating a new one
    closeActiveReadlineInterface();

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    activeReadlineInterface = rl; // Store the reference

    return new Promise<string>((resolve) => {
        rl.question(prompt, (answer) => {
            resolve(answer.trim());
        });
    }).finally(() => {
        // Clean up the interface reference *if* it's still the one we created.
        // It might have been closed already by the SIGINT handler.
        if (activeReadlineInterface === rl) {
            rl.close();
            activeReadlineInterface = null;
        } else if (!activeReadlineInterface) {
            // If it was closed by SIGINT, rl might still need closing if the promise resolved *after* SIGINT handling started
             rl.close();
        }
    });
}

/**
 * Prompts the user for a yes/no confirmation.
 * Accepts 'y', 'o' (yes/oui) or 'n' (no/non), case-insensitive.
 * @param question The question to ask.
 * @returns A promise that resolves to true if the user confirms, false otherwise.
 */
export async function getUserConfirmation(question: string): Promise<boolean> {
    // Get translated versions once
    const yesStr = t('commandConfirmYes').toLowerCase();
    const noStr = t('commandConfirmNo').toLowerCase();

    while (true) {
        const answer = await getUserInput(`${question} ${t('yesNo')}: `); // Use t()
        const lowerAnswer = answer.toLowerCase();

        // Check for positive confirmation ('y', 'o', or translated 'yes')
        if (lowerAnswer === 'y' || lowerAnswer === 'o' || lowerAnswer === yesStr) {
            return true;
        }
        // Check for negative confirmation ('n' or translated 'no')
        if (lowerAnswer === 'n' || lowerAnswer === noStr) {
            return false;
        }
        console.log(chalk.yellow(t('pleaseAnswerYesNo'))); // Use t()
    }
}

// --- Data Persistence ---
// Make loadData generic to handle different data types and default values
export async function loadData<T>(filePath: string, defaultData: T): Promise<T> {
    try {
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data) as T;
    } catch (error) {
        // Use type assertion for error code
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            console.log(chalk.yellow(t('fileNotFound', { filePath })));
            return defaultData; // Return default if file doesn't exist
        } else {
            console.error(chalk.red(t('errorLoadingData', { filePath })), error);
            // Decide how to handle other errors: exit, return default, or throw
            // For robustness, returning default might be safer
            return defaultData;
        }
    }
}

export async function saveData(filePath: string, data: any): Promise<void> {
    try {
        await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
        // console.log(chalk.dim(`Data saved to ${filePath}`)); // Optional: confirmation message
    } catch (error) {
        console.error(chalk.red(t('errorSavingData', { filePath })), error);
        // Consider re-throwing or handling more gracefully depending on context
        throw error; // Re-throw to indicate save failure
    }
}

// --- Agent Memory Management ---
// Explicitly type parameters
export function updateMemory(
    memory: AgentMemory | null,
    actionType: string,
    target: string,
    status: ActionStatus,
    errorMsg: string | null | undefined = null
): void {
    // Check if memory is valid
    if (!memory || typeof memory !== 'object' || !memory.action_log) {
        // Initialize action_log if memory exists but action_log doesn't
        if (memory && typeof memory === 'object') {
            (memory as AgentMemory).action_log = [];
        } else {
            console.error(chalk.red(t('invalidMemoryUpdate')));
            return;
        }
    }

    const timestamp = new Date().toISOString();
    // Use the imported ActionLogEntry type
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

    // Keep the log size manageable
    if (memory.action_log.length > MAX_ACTION_LOG_ENTRIES) {
        memory.action_log.shift(); // Remove the oldest entry
    }

    // Note: System info and notes are updated elsewhere or directly
    // console.log(chalk.dim(`Memory updated: ${actionType} - ${target} (${status})`)); // Optional log
}