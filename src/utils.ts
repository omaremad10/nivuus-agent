import { strings } from './locales.js';
import chalk from 'chalk';
import { getUserInput, getUserConfirmation, closeActiveReadlineInterface, selectFromChoices } from './utils/userIO.js';
import { loadData, saveData } from './utils/persistence.js';
import { updateMemory } from './utils/memoryHelpers.js';

// Dynamic system language detection (robust and typed)
const envLang = process.env.LANG;
let envLocale: string = 'en';
if (typeof envLang === 'string') {
    const langPart = envLang.split('.')[0];
    if (langPart) {
        const localeCandidate = langPart.split('_')[0];
        if (localeCandidate && ['fr', 'en'].includes(localeCandidate)) {
            envLocale = localeCandidate;
        }
    }
}
export const currentLocale: 'fr' | 'en' = (envLocale === 'fr') ? 'fr' : 'en';

export function t(key: string, params: Record<string, string | number | boolean> = {}): string {
    const localeStrings = strings[currentLocale] || strings.en || {};
    let str = localeStrings[key];
    if (!str) {
        console.warn(chalk.yellow(`Missing translation key: ${key} for locale: ${currentLocale}`));
        return `[${key}]`;
    }
    for (const [paramKey, paramValue] of Object.entries(params)) {
        str = str.replace(`{${paramKey}}`, String(paramValue));
    }
    return str;
}

export { getUserInput, getUserConfirmation, closeActiveReadlineInterface, selectFromChoices };
export { loadData, saveData };
export { updateMemory };