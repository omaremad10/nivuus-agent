import { OpenAI } from "openai";
// Add necessary type imports from openai
import type {
    ChatCompletionTool,
    ChatCompletionMessageParam,
    ChatCompletionContentPartText // Import this type if needed for content handling
} from 'openai/resources/chat/completions';
import chalk from "chalk";
// Import AxiosError for type checking
import axios, { AxiosError } from "axios"; // For web search
import path from 'node:path';
import ora from 'ora'; // Spinner
import fs from 'node:fs'; // Synchronous fs for emergency save
import fsp from 'node:fs/promises'; // Asynchronous fs for directory creation
import nodeCleanup from 'node-cleanup'; // Import node-cleanup

// Import from modules in src/
import {
    OPENAI_API_KEY as DEFAULT_OPENAI_API_KEY, // Rename the import
    MODEL_NAME,
    HISTORY_FILE,
    MEMORY_FILE,
    default_system_prompt_template,
    MAX_FEEDBACK_LEN
} from '../config/config.js';
import {
    runCommand,
    readFileContent,
    performWebSearch,
    listDirectory,
    writeFileWithConfirmation,
    askUser, // <-- Importer la nouvelle fonction
    setAgentMemoryRef as setToolsMemoryRef,
    setScriptFilenameRef as setToolsScriptRef,
    tools,
    get_memory_keys,
    get_memory_value,
    set_memory_value
} from '../tools.js';
import {
    loadData,
    saveData,
    updateMemory,
    getUserInput,
    t, // Import the translation function
    closeActiveReadlineInterface // <-- Import the new function
} from '../utils.js';
import { parseAndUpdateSystemInfo } from './helpers.js';
import type { ActionStatus, ChatMessage, ActionLogEntry, AgentMemory } from './types.js';

// --- Determine API Key to Use ---
let apiKeyToUse: string | undefined;
const apiKeyArgPrefix = '--api-key=';
const apiKeyArg = process.argv.find(arg => arg.startsWith(apiKeyArgPrefix));

if (apiKeyArg) {
    apiKeyToUse = apiKeyArg.substring(apiKeyArgPrefix.length);
    console.log(chalk.dim("Using API key from command line argument."));
} else if (process.env.OPENAI_API_KEY) {
    apiKeyToUse = process.env.OPENAI_API_KEY;
    console.log(chalk.dim("Using API key from environment variable OPENAI_API_KEY."));
} else {
    apiKeyToUse = DEFAULT_OPENAI_API_KEY; // Use the renamed default import
    console.log(chalk.dim("Using default API key from config.ts."));
}

// --- Global Initialization ---
// Use the determined API key
const openai = new OpenAI({ apiKey: apiKeyToUse });
// Determine the filename of agent.js itself using CommonJS global
const SCRIPT_FILENAME = path.basename(__filename);

let conversationHistory: ChatMessage[] = [];
// Initialize agentMemory here to inject it
let agentMemory: AgentMemory = { system_info: {}, action_log: [], notes: "" };

// Inject references into the tools.js module
setToolsMemoryRef(agentMemory);
setToolsScriptRef(SCRIPT_FILENAME); // Inject the correct script name

// Mapping of callable function names (now imported from tools.js)
const availableFunctions: { [key: string]: Function } = {
    "run_bash_command": runCommand,
    "read_file": readFileContent,
    "web_search": performWebSearch,
    "list_directory": listDirectory, // Added listDirectory
    "write_file": writeFileWithConfirmation, // <-- Add the mapping
    "ask_user": askUser, // <-- Ajouter le mapping
    "get_memory_keys": get_memory_keys,
    "get_memory_value": get_memory_value,
    "set_memory_value": set_memory_value,
};

// --- Main Async Function ---
// Export main to be called by index.js
export async function main() {

    // --- Ensure Config Directory Exists ---
    const configDirPath = path.dirname(HISTORY_FILE); // Get directory from one of the config files
    try {
        await fsp.mkdir(configDirPath, { recursive: true });
        console.log(chalk.dim(`Ensured config directory exists: ${configDirPath}`));
    } catch (mkdirError) {
        console.error(chalk.red(`Error creating config directory ${configDirPath}:`), mkdirError);
        // Decide if this is fatal. For now, let's try to continue,
        // but loading/saving might fail later.
    }
    // --- End Ensure Config Directory ---


    // --- Global Error Handlers ---
    process.on('uncaughtException', (err, origin) => {
        console.error(chalk.red.bold('\n*** UNCAUGHT EXCEPTION ***'));
        console.error(`Error: ${err}`);
        console.error(`Origin: ${origin}`);
        console.error(err.stack);
        // Attempt emergency save
        console.log(chalk.yellow(t('sigintDetected'))); // Use t()
        try {
            // Note: fs.writeFileSync is synchronous, necessary here as we are exiting
            fs.writeFileSync(MEMORY_FILE, JSON.stringify(agentMemory, null, 2), 'utf-8');
            fs.writeFileSync(HISTORY_FILE, JSON.stringify(conversationHistory, null, 2), 'utf-8');
            console.log(chalk.green(t('saveCompleted'))); // Use t()
        } catch (saveError) {
            console.error(chalk.red(t('saveError')), saveError); // Use t()
        }
        process.exit(1); // Exit with error code
    });

    process.on('unhandledRejection', (reason, promise) => {
        console.error(chalk.red.bold('\n*** UNHANDLED PROMISE REJECTION ***'));
        console.error('Reason:', reason);
        // Don't necessarily exit here, but log it.
    });
    // --- End Global Error Handlers ---

    // --- Setup node-cleanup (Re-enable Save) ---
    nodeCleanup((exitCode, signal) => {
        // Remove the debug log
        // console.error(`\n[node-cleanup DEBUG] Handler triggered! Signal: ${signal}, Exit Code: ${exitCode}`);

        // Log the trigger reason
        if (signal) {
            console.log(chalk.yellow.bold(`\n[node-cleanup] Received signal: ${signal}. Performing synchronous save...`));
        } else if (exitCode !== null) {
            // This case (exitCode 0, signal undefined) seems to be triggered by Ctrl+C during readline
            console.log(chalk.yellow.bold(`\n[node-cleanup] Exiting (Code: ${exitCode}, Signal: ${signal}). Performing synchronous save...`));
        } else {
            console.log(chalk.yellow.bold(`\n[node-cleanup] Performing synchronous save on exit...`));
        }

        // Re-enable saving
        try {
            // Use synchronous file writing ONLY. Async operations are not guaranteed here.
            console.log(chalk.dim(`[node-cleanup] Saving memory to: ${MEMORY_FILE}`));
            fs.writeFileSync(MEMORY_FILE, JSON.stringify(agentMemory, null, 2), 'utf-8');
            console.log(chalk.dim(`[node-cleanup] Saved memory.`));

            console.log(chalk.dim(`[node-cleanup] Saving history to: ${HISTORY_FILE}`));
            fs.writeFileSync(HISTORY_FILE, JSON.stringify(conversationHistory, null, 2), 'utf-8');
            console.log(chalk.dim(`[node-cleanup] Saved history.`));

            console.log(chalk.green(t('saveCompleted')));
            return true; // Indicate cleanup was successful
        } catch (saveError) {
            console.error(chalk.red(t('saveError')), saveError);
            return false; // Indicate cleanup failed
        }
    });
    // --- End node-cleanup setup ---

    // API Key Check
    // Use the determined API key for the check
    if (!apiKeyToUse || apiKeyToUse === "sk-YOUR_API_KEY_HERE" || !apiKeyToUse.startsWith("sk-")) {
        console.log(chalk.red(chalk.bold(t('errorApiKeyNotConfigured')))); // Use t()
        console.log(chalk.yellow(t('errorApiKeyInstructions'))); // Use t()
        // Add instruction about command line argument
        console.log(chalk.yellow("You can also pass the key using --api-key=YOUR_KEY"));
        process.exit(1);
    }
     // Web search module check (axios is imported)
    if (!axios) {
         console.log(chalk.yellow(t('warningAxiosMissing'))); // Use t()
         // Could disable the tool here if needed
    }

    // Build the final system prompt using the template and current script name
    const final_system_prompt = default_system_prompt_template.replace('{SCRIPT_FILENAME}', SCRIPT_FILENAME);

    // Initial data loading (paths relative to CWD where index.js is run)
    // Provide explicit types for loadData calls
    conversationHistory = await loadData<ChatMessage[]>(HISTORY_FILE, [{ role: "system", content: final_system_prompt }]);
    // Reload agentMemory from file, then reinject the reference
    agentMemory = await loadData<AgentMemory>(MEMORY_FILE, { system_info: {}, action_log: [], notes: "" });
    setToolsMemoryRef(agentMemory); // Reinject reference after loading

    // --- Clean up potentially incomplete tool call from last run ---
    if (conversationHistory.length > 0) {
        const lastMessage = conversationHistory[conversationHistory.length - 1];
        // Check if the last message is from the assistant and has pending tool calls
        if (lastMessage && lastMessage.role === 'assistant' && lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
            console.log(chalk.yellow(t('removedLastToolCallRequest'))); // Use t() for the message
            conversationHistory.pop(); // Remove the last message
        }
    }
    // --- End cleanup ---


    // Ensure the system prompt is always the first message and up-to-date
    // Use optional chaining for safety
    if (conversationHistory.length === 0 || conversationHistory[0]?.role !== "system" || conversationHistory[0]?.content !== final_system_prompt) {
        // If history is empty, or first message is not the correct system prompt,
        // replace or prepend the system prompt.
        // This handles cases where the prompt might have been updated or the history was corrupted.
        // Ensure the role is correctly typed
        const systemMessage: ChatMessage = { role: "system", content: final_system_prompt };
        // Use optional chaining for safety
        if (conversationHistory.length > 0 && conversationHistory[0]?.role === "system") {
            conversationHistory[0] = systemMessage; // Replace existing system prompt
        } else {
            // Ensure the role is correctly typed when unshifting
            conversationHistory.unshift(systemMessage); // Prepend new system prompt
        }
        // console.log(chalk.dim("System prompt ensured/updated in history.")); // Optional log
    }

    // --- Main Conversation Loop ---
    console.log(chalk.blue(t('promptInstruction'))); // Use t()

    console.log(chalk.blue(chalk.bold(t('agentStarted', { modelName: MODEL_NAME })))); // Use t()
    console.log(chalk.cyan(t('mainScript', { scriptFilename: SCRIPT_FILENAME }))); // Use t()
    console.log(chalk.cyan(t('promptInstruction'))); // Use t()

    // Determine the first prompt to send to the AI
    const defaultInstruction = t('defaultInstruction');
    let isFirstIteration = true; // Pour gérer le tout premier message

    // Handler for CTRL+C (SIGINT) - Prioritize Save
    process.on('SIGINT', () => { // Keep synchronous
        // Use console.log for synchronous logging in signal handlers
        console.log(chalk.yellow.bold('\n[SIGINT] Signal received. Prioritizing immediate save...')); // Log start

        // --- Attempt Synchronous Save FIRST ---
        try {
            console.log(chalk.dim(`[SIGINT] Attempting IMMEDIATE sync save to: ${MEMORY_FILE}`));
            fs.writeFileSync(MEMORY_FILE, JSON.stringify(agentMemory, null, 2), 'utf-8');
            console.log(chalk.dim(`[SIGINT] Saved memory to ${MEMORY_FILE}.`));

            console.log(chalk.dim(`[SIGINT] Attempting IMMEDIATE sync save to: ${HISTORY_FILE}`));
            fs.writeFileSync(HISTORY_FILE, JSON.stringify(conversationHistory, null, 2), 'utf-8');
            console.log(chalk.dim(`[SIGINT] Saved history to ${HISTORY_FILE}.`));

            console.log(chalk.green(t('saveCompleted')));
        } catch (saveError) {
            console.error(chalk.red(t('saveError')), saveError);
            // Log error but continue to exit
        }
        // --- End Save Attempt ---

        // Optional: Attempt to destroy stdin afterwards, but don't rely on it finishing
        try {
            console.log(chalk.dim('[SIGINT] Attempting to destroy stdin (after save)...'));
            process.stdin.destroy();
        } catch (stdinError) {
            // Ignore errors here, main goal was saving
        }

        console.log(chalk.blue(t('exiting')));
        console.log('[SIGINT] Calling process.exit(0) IMMEDIATELY after save attempt...'); // Log before exit
        // Force exit immediately after attempting save.
        process.exit(0);
    });

    // Main loop
    while (true) {
        try {
            // Préparer le message "user" pour l'API
            let userMessageContent: string;
            if (isFirstIteration) {
                userMessageContent = (conversationHistory.length <= 1 && Object.keys(agentMemory.system_info || {}).length === 0)
                    ? t('proactiveDiscoverSystem') // Premier démarrage
                    : defaultInstruction; // Reprise ou instruction par défaut
                isFirstIteration = false;
                console.log(chalk.dim(`[Agent] Starting with instruction: "${userMessageContent}"`));
            } else {
                // Message automatique pour continuer
                userMessageContent = t('autoContinuePrompt');
                console.log(chalk.dim(`[Agent] Sending auto-continue prompt.`));
            }

            // Ajouter le message utilisateur à l'historique
            conversationHistory.push({ role: "user", content: userMessageContent });

            let needsApiCall = true;
            while(needsApiCall) {
                needsApiCall = false; // Assume only one call is needed

                // Prepare messages for the API (with memory summary)
                const apiMessagesForCall = [...conversationHistory]; // Use a copy for the call
                // Add memory summary if applicable
                if (agentMemory && (Object.keys(agentMemory.system_info || {}).length > 0 || (agentMemory.action_log || []).length > 0 || agentMemory.notes)) {
                    let memorySummary = chalk.bold(t('memorySummaryTitle') + "\n"); // Use t()
                     if (agentMemory.system_info && Object.keys(agentMemory.system_info).length > 0) memorySummary += chalk.cyan(t('memorySysInfo')) + ` ${JSON.stringify(agentMemory.system_info)}\n`; // Use t()
                    if (agentMemory.notes) memorySummary += chalk.cyan(t('memoryNotes')) + ` ${agentMemory.notes}\n`; // Use t()
                    if (agentMemory.action_log && agentMemory.action_log.length > 0) {
                        const logCount = agentMemory.action_log.length;
                        // Show max 5 recent actions
                        const recentLogs = agentMemory.action_log.slice(-5);
                        memorySummary += chalk.cyan(t('memoryActionLog', { count: recentLogs.length, total: logCount }) + "\n"); // Use t()
                        recentLogs.forEach(log => {
                            const statusColor = log.status === "Success" ? chalk.green : log.status === "Cancelled" ? chalk.yellow : chalk.red;
                            // Ensure target is a string for substring
                            const detailShort = String(log.target || '').substring(0, 80);
                            const errorInfo = log.status === "Failure" && log.errorMsg ? ` (Err: ${log.errorMsg.substring(0,50)}...)` : '';
                            // Basic placeholder replacement for the log entry string
                            let logEntryStr = t('memoryActionLogEntry');
                            // Use optional chaining for safety when splitting timestamp
                            const timePart = log.timestamp.split('T')[1]?.split('.')[0] ?? '??:??:??';
                            logEntryStr = logEntryStr.replace('{time}', chalk.dim(timePart))
                                                 .replace('{statusColor}', statusColor.toString()) // Apply color
                                                 .replace('{actionType}', log.actionType)
                                                 .replace('{status}', log.status)
                                                 .replace('{resetColor}', chalk.reset.toString()) // Reset color
                                                 .replace('{detail}', detailShort)
                                                 .replace('{errorInfo}', errorInfo);
                            memorySummary += logEntryStr + '\n';
                        });
                    }
                    memorySummary += chalk.bold(t('memoryEndOfSummary')); // Use t()
                    // Remove formatting for the API
                    const cleanSummary = memorySummary.replace(
                         /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, ''
                     );
                    apiMessagesForCall.splice(1, 0, { role: "user", content: `${t('memoryReminder')}\n${cleanSummary}` });
                }

                // OpenAI API Call
                const spinner = ora({ text: chalk.dim(t('callingApi')), spinner: 'dots' }).start(); // Use t()
                let response;
                try {
                    // Prepare messages for the API call, ensuring valid structure
                    const apiMessages = apiMessagesForCall
                        .map((msg): ChatCompletionMessageParam | null => {
                            if (!msg.role) return null;

                            // Assistant message requesting tool calls
                            if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
                                return {
                                    role: 'assistant', // Explicitly 'assistant'
                                    content: msg.content ?? null,
                                    tool_calls: msg.tool_calls,
                                };
                            }
                            // Tool message with result
                            else if (msg.role === 'tool' && msg.tool_call_id) {
                                const contentString = (msg.content === null || msg.content === undefined) ? 'null' : String(msg.content);
                                return {
                                    role: 'tool', // Explicitly 'tool'
                                    content: contentString,
                                    tool_call_id: msg.tool_call_id,
                                    ...(msg.name && { name: msg.name }),
                                };
                            }
                            // System message
                            else if (msg.role === 'system' && msg.content !== null && msg.content !== undefined) {
                                return {
                                    role: 'system', // Explicitly 'system'
                                    content: String(msg.content),
                                };
                            }
                            // User message
                            else if (msg.role === 'user' && msg.content !== null && msg.content !== undefined) {
                                return {
                                    role: 'user', // Explicitly 'user'
                                    content: String(msg.content),
                                };
                            }
                            // Regular assistant message (no tool calls)
                            else if (msg.role === 'assistant' && msg.content !== null && msg.content !== undefined) {
                                return {
                                    role: 'assistant', // Explicitly 'assistant'
                                    content: String(msg.content),
                                };
                            }
                            // Filter out any other invalid message structures
                            return null;
                        })
                        .filter((msg): msg is ChatCompletionMessageParam => msg !== null);

                    response = await openai.chat.completions.create({
                        model: MODEL_NAME,
                        messages: apiMessages, // Use the correctly filtered/mapped messages
                        tools: tools as ChatCompletionTool[],
                        tool_choice: "auto",
                    });

                    // Check if response and choices exist before accessing
                    if (!response || !response.choices || response.choices.length === 0) {
                        throw new Error(t('errorNoApiResponse')); // Use t()
                    }

                    spinner.succeed(chalk.dim(t('apiResponseReceived'))); // Use t()
                } catch (apiError: unknown) { // Catch as unknown
                    spinner.fail(chalk.red(t('apiError'))); // Use t()
                    // Use type guard for OpenAI API errors
                    if (apiError instanceof OpenAI.APIError) {
                        console.error(chalk.red(`\nOpenAI API Error (${apiError.status || 'N/A'}): ${apiError.message}`));
                        // Use apiError.error for detailed error info in SDK v4+
                        console.error(chalk.dim(JSON.stringify(apiError.error, null, 2)));
                    } else if (apiError instanceof Error) { // Check if it's a generic Error
                        console.error(chalk.red(`\nError calling API: ${apiError.message}`));
                    } else {
                        console.error(chalk.red(`\nError calling API: ${String(apiError)}`));
                    }

                    throw apiError; // Rethrow the error for main loop handler
                }

                // Use optional chaining for safe access
                const responseMessage = response.choices[0]?.message;

                if (!responseMessage) {
                    console.error(chalk.red(t('errorNoResponse')));
                    updateMemory(agentMemory, 'API Call', MODEL_NAME, 'Failure', 'No response message received');
                    continue; // Skip further processing if no message
                }

                // Add assistant's response (or tool calls) to history
                conversationHistory.push(responseMessage as ChatMessage); // Cast needed if responseMessage structure matches ChatMessage

                // --- Handle Tool Calls ---
                const toolCalls = responseMessage.tool_calls;
                if (toolCalls) {
                    updateMemory(agentMemory, 'Tool Call Decision', MODEL_NAME, 'Success'); // Log AI deciding to use tools
                    console.log(chalk.blue(t('toolCallInitiated')));

                    const toolResults: ChatMessage[] = []; // Store results to push later
                    let askUserCalled = false; // Flag pour savoir si ask_user a été appelé
                    // Correction : pas de variable globale, on détecte si un tool_call nécessite confirmation
                    let confirmationPending = false;

                    for (const toolCall of toolCalls) {
                        const functionName = toolCall.function.name;
                        const functionToCall = availableFunctions[functionName];
                        let functionArgs: any; // Déclarer ici pour la portée

                        try {
                             functionArgs = JSON.parse(toolCall.function.arguments); // Might throw
                        } catch (parseError) {
                             const errorMsg = `Argument parsing error: ${(parseError as Error).message}`;
                             // Correction: Supprimer le 2ème argument (default string) de l'appel à t()
                             console.error(chalk.red(t('errorToolArgsParse', { functionName, args: toolCall.function.arguments, message: (parseError as Error).message })));
                             updateMemory(agentMemory, `Tool: ${functionName}`, toolCall.function.arguments, 'Failure', errorMsg);
                             toolResults.push({ tool_call_id: toolCall.id, role: "tool", name: functionName, content: errorMsg });
                             continue; // Passe à l'appel d'outil suivant
                        }


                        // Log tool attempt before execution
                        updateMemory(agentMemory, `Tool: ${functionName}`, JSON.stringify(functionArgs), 'Attempted');
                        // Pass functionArgs to the translation function
                        console.log(chalk.yellow(t('toolExecuting', { functionName, args: JSON.stringify(functionArgs) }))); // Use t()

                        if (functionToCall) {
                            try {
                                let functionResponse;
                                // --- Logique d'appel spécifique ---
                                if (functionName === 'ask_user') {
                                    if (functionArgs.question) {
                                        functionResponse = await functionToCall(functionArgs.question);
                                        askUserCalled = true;
                                    } else { throw new Error(`Missing 'question' argument for ask_user`); }
                                } else if (functionName === 'run_bash_command' || functionName === 'write_file') {
                                    // On exécute la commande et on considère qu'une confirmation a eu lieu
                                    confirmationPending = true;
                                    if (functionName === 'run_bash_command' && functionArgs.command && functionArgs.purpose) {
                                        functionResponse = await functionToCall(functionArgs.command, functionArgs.purpose);
                                    } else if (functionName === 'write_file' && functionArgs.filepath && functionArgs.content) {
                                        functionResponse = await functionToCall(functionArgs.filepath, functionArgs.content);
                                    } else {
                                        throw new Error(`Arguments manquants pour ${functionName}`);
                                    }
                                    confirmationPending = false;
                                } else {
                                    // Handle single-argument functions (read_file, web_search, list_directory)
                                    const argKeys = Object.keys(functionArgs);
                                    if (argKeys.length > 0) {
                                        const primaryArgKey = argKeys[0];
                                        // Ensure primaryArgKey is not undefined before indexing
                                        if (primaryArgKey !== undefined) {
                                            functionResponse = await functionToCall(functionArgs[primaryArgKey]);
                                        } else {
                                             // This case should theoretically not happen if argKeys.length > 0
                                             throw new Error(`Could not determine primary argument key for ${functionName}`);
                                        }
                                    } else {
                                        // Handle case where no arguments were provided, though the schema requires them
                                        // Check if the function *can* be called without args, otherwise throw
                                        // Assuming all current single-arg functions require their argument:
                                        throw new Error(`Missing required argument for function ${functionName}`);
                                    }
                                }
                                // --- Fin logique d'appel ---

                                // Log tool success
                                updateMemory(agentMemory, `Tool: ${functionName}`, JSON.stringify(functionArgs), 'Success');
                                console.log(chalk.green(t('toolSuccess', { functionName }))); // Use t()

                                // Add tool result to list
                                toolResults.push({
                                    tool_call_id: toolCall.id,
                                    role: "tool", // Correct role type
                                    name: functionName,
                                    content: JSON.stringify(functionResponse), // Content must be string
                                });

                            } catch (e) {
                                // Type check the error
                                const errorMessage = (e instanceof Error) ? e.message : String(e);
                                // Log tool failure
                                updateMemory(agentMemory, `Tool: ${functionName}`, JSON.stringify(functionArgs), 'Failure', errorMessage);
                                console.error(chalk.red(t('errorToolExecution', { message: errorMessage }))); // Use t()
                                // Add error message as tool result
                                toolResults.push({
                                    tool_call_id: toolCall.id,
                                    role: "tool", // Correct role type
                                    name: functionName,
                                    // Utiliser un message d'erreur plus générique pour l'API, car l'erreur spécifique peut être trop détaillée
                                    content: t('errorToolExecutionFailed', { message: errorMessage }), // Correction: Passer l'objet de substitution en 2ème argument
                                });
                            }
                        } else {
                            const errorMsg = t('errorToolNotFound', { functionName });
                            updateMemory(agentMemory, `Tool: ${functionName}`, JSON.stringify(functionArgs), 'Failure', errorMsg);
                            console.error(chalk.red(errorMsg));
                            toolResults.push({
                                tool_call_id: toolCall.id,
                                role: "tool", // Correct role type
                                name: functionName,
                                content: errorMsg,
                            });
                        }
                    } // End for loop over toolCalls

                    // Add all tool results to history
                    toolResults.forEach(toolMessage => conversationHistory.push(toolMessage));

                    // Correction : le spinner ne s'affiche que si AUCUN tool_call du lot n'était de type run_bash_command ou write_file
                    const hasConfirmationTool = toolCalls.some(tc => ['run_bash_command', 'write_file'].includes(tc.function.name));
                    if (!hasConfirmationTool) {
                        const spinner2 = ora(t('sendingToolResults')).start();
                        // ...existing code pour l'appel API...
                        // Avant l'appel à openai.chat.completions.create avec apiMessagesWithToolResults
                        // Générer apiMessagesWithToolResults à partir de conversationHistory
                        const apiMessagesWithToolResults = conversationHistory
                            .map((msg): ChatCompletionMessageParam | null => {
                                if (!msg.role) return null;
                                if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
                                    return {
                                        role: 'assistant',
                                        content: msg.content ?? null,
                                        tool_calls: msg.tool_calls,
                                    };
                                } else if (msg.role === 'tool' && msg.tool_call_id) {
                                    const contentString = (msg.content === null || msg.content === undefined) ? 'null' : String(msg.content);
                                    return {
                                        role: 'tool',
                                        content: contentString,
                                        tool_call_id: msg.tool_call_id,
                                        ...(msg.name && { name: msg.name }),
                                    };
                                } else if (msg.role === 'system' && msg.content !== null && msg.content !== undefined) {
                                    return {
                                        role: 'system',
                                        content: String(msg.content),
                                    };
                                } else if (msg.role === 'user' && msg.content !== null && msg.content !== undefined) {
                                    return {
                                        role: 'user',
                                        content: String(msg.content),
                                    };
                                } else if (msg.role === 'assistant' && msg.content !== null && msg.content !== undefined) {
                                    return {
                                        role: 'assistant',
                                        content: String(msg.content),
                                    };
                                }
                                return null;
                            })
                            .filter((msg): msg is ChatCompletionMessageParam => msg !== null);
                        try {
                            const secondResponse = await openai.chat.completions.create({
                                model: MODEL_NAME,
                                messages: apiMessagesWithToolResults, // Use the correctly filtered/mapped messages
                                tools: tools as ChatCompletionTool[],
                                tool_choice: "auto",
                                // No tools needed here usually
                            });
                            spinner2.succeed(t('receivedFinalResponse')); // Use t()

                            // Use optional chaining
                            const finalMessage = secondResponse.choices[0]?.message;

                            if (finalMessage) {
                                conversationHistory.push(finalMessage as ChatMessage); // Add final response
                                console.log(chalk.bold(t('assistantResponseHeader'))); // Use t()
                                console.log(finalMessage.content);
                                updateMemory(agentMemory, 'API Response', MODEL_NAME, 'Success');

                                // --- Parse and update system_info from response ---
                                if (finalMessage.content) {
                                    parseAndUpdateSystemInfo(finalMessage.content, agentMemory, chalk);
                                }
                                // --- End Parse and update ---

                            } else {
                                console.error(chalk.red(t('errorNoFinalResponse')));
                                updateMemory(agentMemory, 'API Call (Post-Tool)', MODEL_NAME, 'Failure', 'No final response message');
                            }
                        } catch (error) { // Catch errors specifically from the second API call
                            spinner2.fail(chalk.red(t('apiError'))); // Use t()
                            // Use type guard for OpenAI API errors
                            if (error instanceof OpenAI.APIError) {
                                console.error(chalk.red(`\nOpenAI API Error (${error.status || 'N/A'}): ${error.message}`));
                                // Use error.error for detailed error info in SDK v4+
                                console.error(chalk.dim(JSON.stringify(error.error, null, 2)));
                            } else if (error instanceof Error) { // Check if it's a generic Error
                                console.error(chalk.red(`\nError calling API: ${error.message}`));
                            } else {
                                console.error(chalk.red(`\nError calling API: ${String(error)}`));
                            }

                            // Rethrow the error to be caught by the main loop's handler for retry logic
                            throw error; // <-- Ensure error is re-thrown
                        }
                    }
                } else {
                    // --- Handle Regular Text Response ---
                    updateMemory(agentMemory, 'API Response', MODEL_NAME, 'Success');
                    console.log(chalk.bold(t('assistantResponseHeader'))); // Use t()
                    console.log(responseMessage.content);

                    // --- Parse and update system_info from response ---
                    if (responseMessage.content) {
                        parseAndUpdateSystemInfo(responseMessage.content, agentMemory, chalk);
                    }
                    // --- End Parse and update ---
                }

            } // End while(needsApiCall)

            // Réinitialiser les états pour la prochaine itération automatique
            isFirstIteration = false; // Ne pas redémarrer avec le prompt initial
            // La boucle while(true) va simplement continuer

        } catch (error: unknown) { // Catch unknown
            // --- Main Loop Error Handling ---
             let errorType = "MainLoop";
             let errorTarget = "Instruction Processing";
             let errorStatus: ActionStatus = "Failure"; // Initialize with a valid ActionStatus
             let errorMessage = t('errorUnknown'); // Use t()

            // Use type guards for specific error types
            if (error instanceof OpenAI.APIError) { // OpenAI API Error
                console.log(chalk.red(`\nOpenAI API Error (${error.status || 'N/A'}): ${error.message}`));
                // Use error.error for detailed error info in SDK v4+
                console.log(chalk.dim(JSON.stringify(error.error, null, 2)));
                errorType = "System";
                errorTarget = `OpenAI API Error: ${error.status || 'Unknown'}`;
                errorMessage = error.message;
                errorStatus = "Failure"; // Set valid status
                 if (error.status === 401) {
                     console.log(chalk.red.bold(t('errorApi401'))); // Use t()
                     break; // Exit
                 } else if (error.status === 429) {
                     console.log(chalk.yellow.bold(t('errorApi429'))); // Use t()
                     // Could add a pause here before suggesting retry
                 } else {
                     // Generic API error message if not 401 or 429
                     console.log(chalk.red(t('errorApiGeneric', { status: error.status || 'N/A', message: error.message }))); // Use t()
                 }
            } else if (axios.isAxiosError(error)) { // Axios Error (e.g., web search)
                console.log(chalk.red(`\nNetwork Error (${error.code || 'N/A'}): ${error.message}`));
                if (error.response) {
                    console.log(chalk.dim(`Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`));
                }
                errorType = "Network";
                errorTarget = `Axios Error: ${error.code || 'Unknown'}`;
                errorMessage = error.message;
                errorStatus = "Failure"; // Set valid status
            } else if (error instanceof SyntaxError && error.message.includes("JSON.parse")) {
                 // Likely error parsing tool arguments
                 console.log(chalk.red.bold(t('errorInternalJsonParse', { message: error.message }))); // Use t()
                 errorType = "System";
                 errorTarget = "Tool Argument Parsing";
                 // errorStatus = "Critical"; // <-- Invalid status
                 errorStatus = "Failure"; // Set valid status
                 errorMessage = error.message; // Assign message here
            }
             else { // Other unexpected error
                console.log(chalk.red.bold(t('errorMainLoop'))); // Use t()
                console.error(error); // Log the full error for debugging
                errorType = "System";
                errorTarget = "Unexpected Loop Error";
                // errorStatus = "Critical"; // <-- Invalid status
                errorStatus = "Failure"; // Set valid status
                errorMessage = (error instanceof Error) ? error.message : String(error); // Convert non-Error objects to string
            }
            // Update memory with the error
            updateMemory(agentMemory, errorType, errorTarget, errorStatus, errorMessage);

            // Automatic retry - Ajustement : ne plus utiliser nextUserPrompt directement ici
            console.log(chalk.yellow.bold(t('errorOccurredRetrying'))); // Use t()
            let lastUserIndex = -1;
            for (let i = conversationHistory.length - 1; i >= 0; i--) {
                // Check if conversationHistory[i] exists before accessing role
                if (conversationHistory[i]?.role === 'user') {
                    lastUserIndex = i;
                    break;
                }
            }
            if (lastUserIndex !== -1) {
                // Nettoyer l'historique après la dernière instruction utilisateur
                conversationHistory.splice(lastUserIndex);
                console.log(chalk.dim(t('errorRetryHistoryCleaned'))); // Use t()
            } else {
                // Si aucune instruction utilisateur trouvée (étrange), réinitialiser l'historique sauf le système
                console.log(chalk.yellow(t('errorRetryNoInstruction'))); // Use t()
                if (conversationHistory.length > 1) {
                     console.log(chalk.dim(t('errorRetryResetHistory'))); // Use t()
                     conversationHistory.splice(1); // Keep only the system message
                }
            }
            // Réinitialiser les états pour la prochaine itération automatique
            isFirstIteration = false; // Ne pas redémarrer avec le prompt initial
            // La boucle while(true) va simplement continuer avec "Continue."

        } // End main try-catch
    } // End while(true)

    // --- Cleanup before exiting ---
    console.log(chalk.blue.bold(t('shuttingDown'))); // Use t()
    // SIGINT handler takes care of saving if exiting via CTRL+C
    // If exiting via 'quit', save here.
    if (!process.exitCode) { // Check if not already exiting due to fatal error or SIGINT
        try {
            await saveData(MEMORY_FILE, agentMemory);
            await saveData(HISTORY_FILE, conversationHistory);
            console.log(chalk.green(t('finalSaveCompleted'))); // Use t()
        } catch (saveError) {
            console.error(chalk.red(t('finalSaveError')), saveError); // Use t()
        }
        console.log(chalk.blue(t('agentFinished'))); // Use t()
    }
}

// No direct launch here, execution is done from index.js