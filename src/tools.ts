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
            name: "run_bash_command",
            description: "Exécute une commande shell Linux sur le système local. Demande une confirmation utilisateur.",
            parameters: {
                type: "object",
                properties: {
                    command: { type: "string", description: "Commande shell complète à exécuter." },
                    purpose: { type: "string", description: "Phrase expliquant pourquoi cette commande doit être exécutée." }
                },
                required: ["command", "purpose"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "read_file",
            description: `Lit le contenu d'un fichier texte spécifique. Limité à ${MAX_DIRECT_READ_SIZE / 1024}KB.`,
            parameters: {
                type: "object",
                properties: { filepath: { type: "string", description: "Chemin du fichier à lire." } },
                required: ["filepath"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "web_search",
            description: "Effectue une recherche web via DuckDuckGo.",
            parameters: {
                type: "object",
                properties: { query: { type: "string", description: "Terme ou question à rechercher." } },
                required: ["query"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "list_directory",
            description: "Liste le contenu d'un répertoire.",
            parameters: {
                type: "object",
                properties: {
                    directoryPath: { type: "string", description: "Chemin du répertoire à lister." }
                },
                required: ["directoryPath"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "write_file",
            description: "Écrit ou écrase un fichier avec le contenu fourni. Demande confirmation.",
            parameters: {
                type: "object",
                properties: {
                    filepath: { type: "string", description: "Chemin du fichier à écrire." },
                    content: { type: "string", description: "Contenu à écrire dans le fichier." },
                },
                required: ["filepath", "content"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_memory_keys",
            description: t('toolDescriptionGetMemoryKeys'),
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: t('toolParamMemoryPathOptional') }
                },
                required: [],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_memory_value",
            description: t('toolDescriptionGetMemoryValue'),
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: t('toolParamMemoryPathRequired') }
                },
                required: ["path"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "set_memory_value",
            description: t('toolDescriptionSetMemoryValue'),
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: t('toolParamMemoryPathRequired') },
                    value: { description: t('toolParamMemoryValue') }
                },
                required: ["path", "value"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "ask_user",
            description: "Pose une question à l'utilisateur humain pour obtenir une clarification ou une confirmation.",
            parameters: {
                type: "object",
                properties: {
                    question: { type: "string", description: "Question à poser à l'utilisateur." },
                },
                required: ["question"],
            },
        },
    },
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
export { askUser, setAgentMemoryRef as setAskUserMemoryRef } from './tools/askUser.js';
