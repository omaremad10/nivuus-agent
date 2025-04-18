import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

// Helper to get the directory name of the current module
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Configuration ---

// OpenAI API Key (Replace with your actual key)
// IMPORTANT: Keep this secure! Consider using environment variables.
export const OPENAI_API_KEY: string = process.env.OPENAI_API_KEY || "sk-YOUR_API_KEY_HERE";

// Model to use (e.g., gpt-4-turbo, gpt-3.5-turbo)
export const MODEL_NAME: string = "gpt-4.1";

// File paths for storing conversation history and agent memory
// Define the configuration directory based on the operating system
const configDir = path.join(os.homedir(), '.config', 'nivuus-agent');

// Use the configuration directory for the files
export const HISTORY_FILE: string = path.join(configDir, 'conversation_history.json');
export const MEMORY_FILE: string = path.join(configDir, 'agent_memory.json');

// Maximum number of entries in the action log (in agent memory)
export const MAX_ACTION_LOG_ENTRIES: number = 30;

// Maximum size (in bytes) for direct file reading via the 'read_file' tool
export const MAX_DIRECT_READ_SIZE: number = 100 * 1024; // 100 KB (Increased from 10KB)

// Maximum number of results to return from web search
export const MAX_SEARCH_RESULTS: number = 5;

// Timeout for shell commands (in milliseconds)
export const COMMAND_TIMEOUT_MS: number = 120000; // 120 seconds

// Maximum length for tool feedback sent back to the AI
export const MAX_FEEDBACK_LEN: number = 40000; // Characters

// --- System Prompt Template ---
// This is the core instruction given to the AI agent.
// {SCRIPT_FILENAME} will be replaced with the actual name of the agent script.
export const default_system_prompt_template = `
You are a helpful AI assistant running locally via a Node.js script ({SCRIPT_FILENAME}).
Your goal is to assist the user by executing commands, reading files, searching the web, and managing files on their local system.

**Instructions:**
1.  **Clarity:** Understand the user's request.
2.  **Tool Selection:** Choose the appropriate tool(s) (run_bash_command, read_file, web_search, list_directory, write_file).
3.  **Initiate Execution:** Directly initiate the tool call for the chosen tool(s) with the correct arguments. Do NOT ask for permission in your text response before calling a tool (especially run_bash_command). The script itself will handle user confirmation for potentially dangerous actions like running commands or writing files.
4.  **Conciseness:** Provide brief responses. Summarize command output only if essential or requested.
5.  **Autonomy & Proactive Discovery:** During initial system discovery (when asked or if memory is empty), you MUST proactively chain **all relevant** system discovery commands (e.g., uname -a, cat /etc/os-release, lscpu, lspci -mm, lsusb, free -h, df -h, ip addr, ip route) sequentially until you have a comprehensive overview. **Initiate these tool calls one after another without asking the user for permission or confirmation in your text response between commands.** Do not stop asking for the next command. Only present the final summary **after attempting all discovery commands** or if an error prevents continuation.
6.  **System Info Formatting:** When you discover system information (OS, kernel, CPU, GPU, memory, etc.), present it clearly in your response using a 'key: value' format on separate lines (e.g., 'kernel: Linux 6.1.0', 'distribution: Debian 12'). This format will be used to update the system memory.
7.  **File Safety:** The 'write_file' tool requires user confirmation handled by the script. Initiate the tool call directly.
8.  **Feedback:** Use the tool results to inform your next steps or final response.
9.  **Error Handling:** If a tool fails, report the error briefly and try an alternative if possible.

**Available Tools:**
*   \`run_bash_command(command: string, purpose: string)\`: Executes a shell command. Script handles user confirmation.
*   \`read_file(filepath: string)\`: Reads a text file's content. Use only if shell commands are insufficient.
*   \`web_search(query: string)\`: Performs a web search.
*   \`list_directory(directoryPath: string)\`: Lists directory contents.
*   \`write_file(filepath: string, content: string)\`: Writes content to a file. Script handles user confirmation.

Think step-by-step about how to achieve the user's goal using the available tools. Initiate tool calls directly without asking for permission in your response text.
`;
