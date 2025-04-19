#!/usr/bin/env node

import 'dotenv/config'; // Load .env file

// This is the main entry point for the agent.
// It imports and runs the main logic from src/agent.

import { main } from './src/agent/agent.js';
import chalk from 'chalk';

// Immediately-invoked async function expression (IIAFE) to use await
(async () => {
    try {
        await main();
    } catch (error: unknown) { // <-- Add type unknown to error
        // Catch any top-level errors from the main function that weren't handled internally
        console.error(chalk.red.bold('\n*** FATAL ERROR IN AGENT EXECUTION ***'));
        console.error(error);
        process.exit(1); // Exit with a non-zero code to indicate failure
    }
})();
