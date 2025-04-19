import fs from 'node:fs/promises';
import chalk from 'chalk';
import { t } from '../utils.js';

export async function loadData<T>(filePath: string, defaultData: T): Promise<T> {
    try {
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data) as T;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            console.log(chalk.yellow(t('fileNotFound', { filePath })));
            return defaultData;
        } else {
            console.error(chalk.red(t('errorLoadingData', { filePath })), error);
            return defaultData;
        }
    }
}

export async function saveData(filePath: string, data: any): Promise<void> {
    try {
        await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
        console.error(chalk.red(t('errorSavingData', { filePath })), error);
        throw error;
    }
}
