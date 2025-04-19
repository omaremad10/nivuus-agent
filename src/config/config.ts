import path from 'node:path';
import os from 'node:os';

// Helper to get the directory name of the current module
// const __dirname = path.dirname(fileURLToPath(import.meta.url)); // Remove this line, rely on global __dirname

// --- Configuration ---

// OpenAI API Key (Replace with your actual key)
// IMPORTANT: Keep this secure! Consider using environment variables.
export const OPENAI_API_KEY: string = process.env.OPENAI_API_KEY || "sk-YOUR_API_KEY_HERE";

// Model to use (e.g., gpt-4-turbo, gpt-3.5-turbo)
export const MODEL_NAME: string = "gpt-4.1";

export { HISTORY_FILE, MEMORY_FILE, MAX_ACTION_LOG_ENTRIES, MAX_DIRECT_READ_SIZE, MAX_SEARCH_RESULTS, COMMAND_TIMEOUT_MS, MAX_FEEDBACK_LEN } from './configPaths.js';
export { default_system_prompt_template } from './systemPrompt.js';
