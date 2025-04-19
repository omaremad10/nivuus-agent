import { spawn, ChildProcess, SpawnOptions } from 'node:child_process'; // Import necessary types
import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import axios, { AxiosError } from 'axios'; // Import AxiosError
// Correct lodash import for ESM compatibility
import lodash from 'lodash';
const { get, set, keys, has } = lodash;

// Import from files in the same directory
import { getUserConfirmation, updateMemory, t, getUserInput } from './utils.js'; // Import t and getUserInput
import { COMMAND_TIMEOUT_MS, MAX_DIRECT_READ_SIZE, MAX_SEARCH_RESULTS } from './config/config.js';
// Import types from agent.ts
import type { AgentMemory, ActionStatus } from './agent/types.js';

// References that will be injected by agent.js
let agentMemoryRef: AgentMemory | null = null;
let scriptFilenameRef: string = 'unknown_script.js';

export function setAgentMemoryRef(memory: AgentMemory) {
    if (memory && typeof memory === 'object') {
        agentMemoryRef = memory;
    } else {
        console.error(chalk.red("Attempted to inject an invalid memory reference into tools.js"));
    }
}

export function setScriptFilenameRef(filename: string) {
    scriptFilenameRef = filename;
}

// Centralisation de la définition des outils OpenAI pour l'agent
export const tools = [
    {
        type: "function",
        function: {
            name: "read_file",
            description: `Read the content of a specific text file. Limited to ${MAX_DIRECT_READ_SIZE / 1024}KB.`,
            parameters: {
                type: "object",
                properties: { filepath: { type: "string", description: "Path of the file to read." } },
                required: ["filepath"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "list_directory",
            description: "List the contents of a directory.",
            parameters: {
                type: "object",
                properties: {
                    directoryPath: { type: "string", description: "Path of the directory to list." }
                },
                required: ["directoryPath"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "write_file",
            description: "Write or overwrite a file with the provided content. ",
            parameters: {
                type: "object",
                properties: {
                    filepath: { type: "string", description: "Path of the file to write." },
                    content: { type: "string", description: "Content to write into the file." },
                },
                required: ["filepath", "content"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_memory_keys",
            description: "List all memory keys at the given path (or root if not specified).",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Memory path (optional)." }
                },
                required: [],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_memory_value",
            description: "Get the value stored at the given memory path.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Memory path (required)." }
                },
                required: ["path"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "set_memory_value",
            description: "Set or update a value at the given memory path in the agent's persistent memory. You MUST use this tool for any information, fact, or user preference you want to remember or persist between sessions. Never store persistent knowledge in your text responses—always use set_memory_value for memory.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Memory path (required)." },
                    value: { description: "Value to store at the memory path." }
                },
                required: ["path", "value"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "web_search",
            description: "Perform a web search using DuckDuckGo.",
            parameters: {
                type: "object",
                properties: { query: { type: "string", description: "Term or question to search for." } },
                required: ["query"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "ask_user",
            description: "Ask a question to the human user to get clarification or confirmation.",
            parameters: {
                type: "object",
                properties: {
                    question: { type: "string", description: "Question to ask the user." },
                },
                required: ["question"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "run_bash_command",
            description: "Execute a Linux shell command on the local system. ",
            parameters: {
                type: "object",
                properties: {
                    command: { type: "string", description: "Full shell command to execute." },
                    purpose: { type: "string", description: "Phrase explaining why this command should be executed." }
                },
                required: ["command", "purpose"],
            },
        },
    }
];

// Index des outils découpés
export { runCommand, setAgentMemoryRef as setRunCommandMemoryRef } from './tools/runCommand.js';
export { readFileContent, setAgentMemoryRef as setReadFileContentMemoryRef } from './tools/readFileContent.js';
export { performWebSearch, setAgentMemoryRef as setPerformWebSearchMemoryRef } from './tools/performWebSearch.js';
export { listDirectory, setAgentMemoryRef as setListDirectoryMemoryRef } from './tools/listDirectory.js';
export { writeFileWithConfirmation, setAgentMemoryRef as setWriteFileWithConfirmationMemoryRef } from './tools/writeFileWithConfirmation.js';
export {
  get_memory_keys,
  get_memory_value,
  set_memory_value,
  setAgentMemoryRef as setMemoryToolsMemoryRef
} from './tools/memoryTools.js';
