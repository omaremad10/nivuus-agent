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
import { COMMAND_TIMEOUT_MS, MAX_DIRECT_READ_SIZE, MAX_SEARCH_RESULTS } from './config.js';
// Import types from agent.ts
import type { AgentMemory, ActionStatus } from './agent.js';

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

// --- Tool Implementations ---

// 1. Execute a Bash command
export async function runCommand(command: string, purpose: string): Promise<string> { // Added purpose parameter type
    // Reinstate Confirmation block
    console.log(chalk.blue(chalk.bold(t('commandConfirmPrompt')))); // Use t()
    console.log(chalk.yellow(t('commandConfirmProposed', { command }))); // Use t()
    console.log(chalk.blue(t('commandConfirmPurpose', { purpose: Buffer.from(purpose || t('notSpecified'), 'utf-8').toString() }))); // Use t()
    const confirm = await getUserConfirmation(t('confirmExecute')); // Use t()

    if (!confirm) {
        console.log(chalk.yellow(t('executionCancelled'))); // Use t()
        if (agentMemoryRef) updateMemory(agentMemoryRef, "Command", command, "Cancelled");
        return t('executionCancelled'); // Return translated string
    }
    // End Reinstate Confirmation block

    // Log the command and purpose before execution (more concise)
    // console.log(chalk.dim(`Executing command: $ ${command} (Purpose: ${purpose || t('notSpecified')})`)); // Keep this commented out as confirmation block is back

    // Use the injected memory reference with correct status type
    if (agentMemoryRef) updateMemory(agentMemoryRef, "Command", command, "Attempted");
    console.log(chalk.cyan(t('commandStartExecution', { command }))); // Use t()

    return new Promise((resolve) => {
        const stdoutChunks: string[] = []; // Explicit type
        const stderrChunks: string[] = []; // Explicit type
        let stdoutOutput = "";
        let stderrOutput = "";
        let timedOut = false;

        // Define options separately for clarity
        const spawnOptions: SpawnOptions = {
            shell: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: COMMAND_TIMEOUT_MS,
            // encoding is not a direct option here
        };

        const childProcess: ChildProcess = spawn(command, [], spawnOptions);

        // Check if stdout/stderr exist before attaching listeners
        if (childProcess.stdout) {
            childProcess.stdout.setEncoding('utf-8'); // Set encoding on the stream
            childProcess.stdout.on('data', (data: string | Buffer) => stdoutChunks.push(data.toString()));
        }
        if (childProcess.stderr) {
            childProcess.stderr.setEncoding('utf-8'); // Set encoding on the stream
            childProcess.stderr.on('data', (data: string | Buffer) => stderrChunks.push(data.toString()));
        }

        childProcess.on('error', (err: Error) => {
            console.log(chalk.red(t('commandSpawnError', { message: err.message }))); // Use t()
            stderrChunks.push(`Spawn error: ${err.message}`);
        });
        childProcess.on('timeout', () => {
            const timeoutSeconds = COMMAND_TIMEOUT_MS / 1000;
            console.log(chalk.red(t('commandTimeoutError', { timeout: timeoutSeconds }))); // Use t()
            stderrChunks.push(t('commandTimeoutErrorMsg', { timeout: timeoutSeconds })); // Use t()
            timedOut = true;
            // Explicitly kill the process on timeout
            if (!childProcess.killed) {
                childProcess.kill();
            }
        });
        childProcess.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
            stdoutOutput = stdoutChunks.join('');
            stderrOutput = stderrChunks.join('');
            const finalCode = timedOut ? -1 : (code ?? (signal ? -2 : -1)); // -2 for signal
            const signalInfo = signal ? `, Signal: ${signal}` : '';
            console.log(chalk.cyan(t('commandEndExecution', { code: finalCode, signalInfo }))); // Use t()
            // Ensure process is killed if not already
            if (!childProcess.killed) {
                childProcess.kill();
            }
            let fullRawOutput = "";
            if (stdoutOutput) fullRawOutput += `${t('commandOutputStdout')}\n${stdoutOutput.trim()}\n`; // Use t()
            if (stderrOutput) fullRawOutput += `${t('commandOutputStderr')}\n${stderrOutput.trim()}\n`; // Use t()
            if (!fullRawOutput && !timedOut && finalCode !== 0) fullRawOutput = t('commandOutputNoOutputCode', { code: finalCode, signalInfo }); // Use t()
            if (!fullRawOutput && finalCode === 0) fullRawOutput = t('commandOutputNoOutputSuccess'); // Use t()
            // Log the raw output before returning
            console.log(chalk.grey(t('commandRawOutputTitle'))); // Use t()
            console.log(chalk.grey(fullRawOutput.substring(0, 500) + (fullRawOutput.length > 500 ? '...' : ''))); // Limit display
            console.log(chalk.grey(t('commandRawOutputEnd'))); // Use t()
            // Use correct status type
            const finalStatus: ActionStatus = finalCode === 0 ? "Success" : "Failure";
            if (agentMemoryRef) updateMemory(agentMemoryRef, "Command", command, finalStatus, stderrOutput.trim());
            resolve(fullRawOutput.trim());
        });
    });
}

// 2. Read a file
export async function readFileContent(filepath: string): Promise<string> {
    const absPath = path.resolve(filepath);
    // Confirmation disabled
    if (agentMemoryRef) updateMemory(agentMemoryRef, "DirectRead", absPath, "Attempted");
    console.log(chalk.cyan(t('readFileAttempt', { path: absPath }))); // Use t()

    try {
        const stats = await fs.stat(absPath);
        if (!stats.isFile()) throw new Error(t('readFileNotFile')); // Use t()
        if (stats.size > MAX_DIRECT_READ_SIZE) throw new Error(t('readFileTooLarge', { size: stats.size, maxSize: MAX_DIRECT_READ_SIZE })); // Use t()

        let content: string | null = null;
        const encodings: BufferEncoding[] = ['utf-8', 'latin1']; // Explicit type
        for (const enc of encodings) {
            try {
                // Pass encoding directly
                content = await fs.readFile(absPath, enc);
                console.log(chalk.green(t('readFileReadSuccessEncoding', { encoding: enc }))); // Use t()
                break;
            } catch (readErr: any) { // Catch as any initially
                // Check error code safely
                if (readErr?.code === 'ERR_INVALID_ARG_VALUE' || readErr instanceof TypeError) continue;
                throw readErr; // Rethrow other errors
            }
        }

        if (content === null) {
            const buffer = await fs.readFile(absPath);
            if (buffer.indexOf(0) !== -1) throw new Error(t('readFileBinary')); // Use t()
            else throw new Error(t('readFileEncodingError')); // Use t()
        }

        console.log(chalk.green(t('readFileReadSuccess', { path: absPath }))); // Use t()
        if (agentMemoryRef) updateMemory(agentMemoryRef, "DirectRead", absPath, "Success");
        return t('readFileContentHeader', { path: absPath, content }); // Use t()
    } catch (error: unknown) { // Catch as unknown
        // Use type guard
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(chalk.red(t('readFileError', { path: absPath, message: errorMessage }))); // Use t()
        if (agentMemoryRef) updateMemory(agentMemoryRef, "DirectRead", absPath, "Failure", errorMessage);
        return t('readFileError', { path: absPath, message: errorMessage }); // Return translated error
    }
}

// 3. Web Search
export async function performWebSearch(query: string): Promise<string> {
    // Confirmation disabled
    if (agentMemoryRef) updateMemory(agentMemoryRef, "WebSearch", query, "Attempted");
    console.log(chalk.cyan(t('webSearchAttempt', { query }))); // Use t()

    try {
        const response = await axios.get('https://html.duckduckgo.com/html/', {
            params: { q: query },
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://duckduckgo.com/'
            },
            timeout: 15000 // Add a timeout for the web request
        });

        const results: { href: string; title: string; body: string }[] = [];
        // Improved regex to be less sensitive to minor HTML variations
        const resultRegex = /<a class="result__a"[^>]*href="(.*?)"[^>]*>(.*?)<\/a>.*?<a class="result__snippet"[^>]*>(.*?)<\/a>/gs;
        let match;
        while ((match = resultRegex.exec(response.data)) !== null && results.length < MAX_SEARCH_RESULTS) {
            // More robust HTML cleaning and entity decoding
            const decodeEntities = (encodedString: string | undefined): string => { // Add type and handle undefined
                if (!encodedString) return ''; // Return empty string if input is undefined
                const translate_re = /&(nbsp|amp|quot|lt|gt);/g;
                const translate: { [key: string]: string } = { // Add index signature
                    "nbsp":" ", "amp" : "&", "quot": '"', "lt"  : "<", "gt"  : ">"
                };
                return encodedString.replace(translate_re, (match: string, entity: string): string => { // Add types
                    return translate[entity] ?? match; // Use fallback if entity not found
                }).replace(/&#(\d+);/gi, (match: string, numStr: string): string => { // Add types
                    const num = parseInt(numStr, 10);
                    return String.fromCharCode(num);
                });
            }
            // Use optional chaining and provide fallbacks
            const href = decodeEntities(match?.[1]?.trim());
            const title = decodeEntities(match?.[2]?.replace(/<.*?>/g, '')?.trim());
            const body = decodeEntities(match?.[3]?.replace(/<.*?>/g, '')?.trim());

            results.push({ href, title, body });
        }

        if (results.length === 0) {
            if (agentMemoryRef) updateMemory(agentMemoryRef, "WebSearch", query, "Success (No Results)");
            return t('webSearchNoResults', { query }); // Use t()
        } else {
            let resultsText = t('webSearchResultsTitle', { query }) + '\n\n'; // Use t()
            results.forEach((res, i) => {
                resultsText += t('webSearchResultEntry', { // Use t()
                    index: i + 1,
                    title: res.title,
                    body: res.body.substring(0, 250),
                    href: res.href
                }) + '\n\n';
            });
            if (agentMemoryRef) updateMemory(agentMemoryRef, "WebSearch", query, "Success");
            return resultsText.trim();
        }
    } catch (error: unknown) { // Catch as unknown
        let errorMsg: string;
        // Use type guards
        if (axios.isAxiosError(error)) {
            if (error.code === 'ECONNABORTED') {
                errorMsg = t('webSearchTimeoutError'); // Use t()
            } else if (error.response) {
                errorMsg = t('webSearchHttpError', { status: error.response.status, statusText: error.response.statusText }); // Use t()
            } else {
                errorMsg = error.message; // Network error without response
            }
        } else if (error instanceof Error) {
            errorMsg = error.message;
        } else {
            errorMsg = String(error);
        }
        console.log(chalk.red(t('webSearchError', { query, message: errorMsg }))); // Use t()
        if (agentMemoryRef) updateMemory(agentMemoryRef, "WebSearch", query, "Failure", errorMsg);
        return t('webSearchError', { query, message: errorMsg }); // Return translated error
    }
}

// 4. List a directory (New function)
export async function listDirectory(directoryPath: string): Promise<string> {
    const absPath = path.resolve(directoryPath);
    // No confirmation for this function
    if (agentMemoryRef) updateMemory(agentMemoryRef, "ListDirectory", absPath, "Attempted");
    console.log(chalk.cyan(t('listDirectoryAttempt', { path: absPath }))); // Use t()

    try {
        const stats = await fs.stat(absPath);
        if (!stats.isDirectory()) {
            throw new Error(t('listDirectoryNotDir')); // Use t()
        }

        const entries = await fs.readdir(absPath, { withFileTypes: true });
        let output = t('listDirectoryContentHeader', { path: absPath }) + '\n'; // Use t()
        if (entries.length === 0) {
            output += t('listDirectoryEmpty') + '\n'; // Use t()
        } else {
            entries.forEach(entry => {
                output += t('listDirectoryEntry', { name: entry.name, isDir: entry.isDirectory() ? '/' : '' }) + '\n'; // Use t()
            });
        }

        console.log(chalk.green(t('listDirectorySuccess', { path: absPath }))); // Use t()
        if (agentMemoryRef) updateMemory(agentMemoryRef, "ListDirectory", absPath, "Success");
        return output.trim();

    } catch (error: unknown) { // Catch as unknown
        // Use type guard
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(chalk.red(t('listDirectoryError', { path: absPath, message: errorMessage }))); // Use t()
        if (agentMemoryRef) updateMemory(agentMemoryRef, "ListDirectory", absPath, "Failure", errorMessage);
        return t('listDirectoryError', { path: absPath, message: errorMessage }); // Return translated error
    }
}

// 5. Write File Content (New Function)
export async function writeFileWithConfirmation(filepath: string, content: string): Promise<string> {
    const absolutePath = path.resolve(filepath);
    const actionType = "File Write";
    const target = absolutePath;
    let status: ActionStatus = "Attempted"; // Initialize status
    let feedback = "";
    let errorMsg: string | null = null;

    // Log attempt immediately
    if (agentMemoryRef) updateMemory(agentMemoryRef, actionType, target, status);

    try {
        console.log(chalk.blue(chalk.bold(t('fileWriteConfirmPrompt'))));
        console.log(chalk.yellow(t('fileWriteConfirmProposed', { filepath: absolutePath })));
        // Show a snippet of the content
        const contentSnippet = content.substring(0, 200) + (content.length > 200 ? "..." : "");
        console.log(chalk.blue(t('fileWriteConfirmContent', { contentSnippet })));

        const confirm = await getUserConfirmation(t('confirmWrite'));

        if (!confirm) {
            status = "Cancelled";
            feedback = t('fileWriteCancelled');
            console.log(chalk.yellow(feedback));
            if (agentMemoryRef) updateMemory(agentMemoryRef, actionType, target, status, null);
            return feedback;
        }

        // Proceed with writing
        console.log(chalk.cyan(t('fileWriteAttempt', { filepath: absolutePath })));
        await fs.writeFile(absolutePath, content, 'utf-8');
        status = "Success";
        feedback = t('fileWriteSuccess', { filepath: absolutePath });
        console.log(chalk.green(feedback));
        if (agentMemoryRef) updateMemory(agentMemoryRef, actionType, target, status, null);
        return feedback;

    } catch (error: unknown) { // Catch as unknown
        status = "Failure";
        // Use type guard
        errorMsg = error instanceof Error ? error.message : String(error);
        feedback = t('fileWriteError', { filepath: absolutePath, message: errorMsg });
        console.error(chalk.red(feedback));
        if (agentMemoryRef) updateMemory(agentMemoryRef, actionType, target, status, errorMsg);
        // Return the error message to the AI
        return `Error: ${feedback}`;
    }
}

// 6. Get Memory Keys
export async function get_memory_keys(path?: string): Promise<string[]> {
    console.log(chalk.yellow(t('memoryGettingKeys', { path: path || 'root' })));
    if (!agentMemoryRef) {
        throw new Error(t('errorMemoryNotInitialized'));
    }
    try {
        const target = path ? get(agentMemoryRef, path) : agentMemoryRef;
        if (target === undefined || target === null) {
             console.log(chalk.yellow(t('memoryPathNotFound', { path: path || 'root' })));
             return []; // Return empty array if path doesn't exist or value is null/undefined
        }
        if (typeof target !== 'object') {
             throw new Error(t('errorMemoryPathNotObject', { path: path || 'root' }));
        }
        const keyList = keys(target);
        console.log(chalk.green(t('memoryGetKeysSuccess', { path: path || 'root' })));
        return keyList;
    } catch (error: any) {
        console.error(chalk.red(t('memoryGetKeysError', { path: path || 'root', message: error.message })));
        throw new Error(t('memoryGetKeysErrorFeedback', { path: path || 'root', message: error.message }));
    }
}

// 7. Get Memory Value
export async function get_memory_value(path: string): Promise<any> {
     console.log(chalk.yellow(t('memoryGettingValue', { path })));
     if (!agentMemoryRef) {
        throw new Error(t('errorMemoryNotInitialized'));
    }
     if (!path) {
         throw new Error(t('errorMemoryPathRequired'));
     }
    try {
        // Use lodash 'has' to check if the path exists, even if the value is null or undefined
        if (!has(agentMemoryRef, path)) {
             console.log(chalk.yellow(t('memoryPathNotFound', { path })));
             // Return a specific indicator or throw an error? Returning null might be ambiguous.
             // Let's return a specific string indicating not found.
             return `Error: Path not found in memory: ${path}`;
        }
        const value = get(agentMemoryRef, path);
        console.log(chalk.green(t('memoryGetValueSuccess', { path })));
        // Return the raw value. The AI will receive it stringified.
        return value;
    } catch (error: any) {
        console.error(chalk.red(t('memoryGetValueError', { path, message: error.message })));
        throw new Error(t('memoryGetValueErrorFeedback', { path, message: error.message }));
    }
}

// 8. Set Memory Value
export async function set_memory_value(path: string, value: any): Promise<string> {
    console.log(chalk.yellow(t('memorySettingValue', { path })));
     if (!agentMemoryRef) {
        throw new Error(t('errorMemoryNotInitialized'));
    }
     if (!path) {
         throw new Error(t('errorMemoryPathRequired'));
     }
    try {
        // Use lodash 'set' which handles creating nested paths
        set(agentMemoryRef, path, value);
        console.log(chalk.green(t('memorySetValueSuccess', { path })));
        // Log the update visually (similar to parseAndUpdateSystemInfo)
        console.log(chalk.dim(`[Memory Update Tool] ${path} = ${JSON.stringify(value)}`));
        return t('memorySetValueSuccessFeedback', { path });
    } catch (error: any) {
        console.error(chalk.red(t('memorySetValueError', { path, message: error.message })));
        throw new Error(t('memorySetValueErrorFeedback', { path, message: error.message }));
    }
}

// --- Tool Definitions for OpenAI ---
// Description uses MAX_DIRECT_READ_SIZE imported
export const tools = [
    {
        type: "function",
        function: {
            name: "run_bash_command",
            description: "Executes a Linux shell command on the local system. Useful for getting system info, listing files, etc. Output will be shown live. Requires user confirmation.",
            parameters: {
                type: "object",
                properties: {
                    command: { type: "string", description: "The full shell command to execute (e.g., 'ls -l /home', 'uname -a')." },
                    purpose: { type: "string", description: "A short sentence explaining WHY this command needs to be executed." } // Added purpose parameter
                },
                required: ["command", "purpose"], // purpose is now required
            },
        },
    },
    {
        type: "function",
        function: {
            name: "read_file",
            description: `Reads the full content of a SPECIFIC text file on the local system. Confirmation disabled. Use ONLY if 'head', 'tail', or 'grep' via bash are insufficient. Limited to ${MAX_DIRECT_READ_SIZE / 1024}KB. For larger files or specific parts, use shell commands like head, tail, or grep via run_bash_command.`, // Updated description
            parameters: {
                type: "object",
                properties: { filepath: { type: "string", description: "The absolute or relative path to the file to read (e.g., '/etc/fstab', './config.txt')." } },
                required: ["filepath"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "web_search",
            description: "Performs a web search via DuckDuckGo to get external information. No confirmation required.",
            parameters: {
                type: "object",
                properties: { query: { type: "string", description: "The search term or question." } },
                required: ["query"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "list_directory",
            description: "Lists the contents (files and subdirectories) of a specified directory on the local system. No confirmation required.",
            parameters: {
                type: "object",
                properties: {
                    directoryPath: { type: "string", description: "The absolute or relative path to the directory to list (e.g., '/home/user', '.')." }
                },
                required: ["directoryPath"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "write_file", // New tool definition
            description: "Writes or overwrites a file with the provided content. Requires user confirmation before execution.",
            parameters: {
                type: "object",
                properties: {
                    filepath: {
                        type: "string",
                        description: "The relative or absolute path to the file to write.",
                    },
                    content: {
                        type: "string",
                        description: "The content to write into the file.",
                    },
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
                    path: {
                        type: "string",
                        description: t('toolParamMemoryPathOptional')
                    }
                },
                required: [], // Path is optional
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
                    path: {
                        type: "string",
                        description: t('toolParamMemoryPathRequired')
                    }
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
                    path: {
                        type: "string",
                        description: t('toolParamMemoryPathRequired')
                    },
                    value: {
                        // Can be any type, description clarifies it will be stored
                        description: t('toolParamMemoryValue')
                    }
                },
                required: ["path", "value"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "ask_user",
            description: "Asks the human user a question to get clarification, confirmation, or necessary input to proceed. Use this ONLY when you are blocked and require user interaction.",
            parameters: {
                type: "object",
                properties: {
                    question: {
                        type: "string",
                        description: "The question to ask the user.",
                    },
                },
                required: ["question"],
            },
        },
    },
];

// Fonction d'implémentation pour ask_user
export async function askUser(question: string): Promise<string> {
    // Log the attempt
    if (agentMemoryRef) updateMemory(agentMemoryRef, "User Interaction", "Ask Question", "Attempted");
    // Utilise getUserInput pour poser la question formatée
    // Ajout de t() pour la traduction potentielle des préfixes/suffixes
    console.log(chalk.magentaBright(`🤔 ${t('assistantQuestionPrefix')} `) + question); // Correction: Supprimer le 2ème argument
    const userResponse = await getUserInput(chalk.green(t('promptUserResponse'))); // Correction: Supprimer le 2ème argument
    // Log success (getting a response is success, content est handled by agent)
    if (agentMemoryRef) updateMemory(agentMemoryRef, "User Interaction", "Ask Question", "Success");
    // Retourne la réponse de l'utilisateur. getUserInput devrait gérer les cas de non-string.
    return typeof userResponse === 'string' ? userResponse : '';
}
