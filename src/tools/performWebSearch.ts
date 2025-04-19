import axios from 'axios';
import chalk from 'chalk';
import { t, updateMemory } from '../utils.js';
import { MAX_SEARCH_RESULTS } from '../config/config.js';
import type { AgentMemory } from '../agent/types.js';

let agentMemoryRef: AgentMemory | null = null;
export function setAgentMemoryRef(memory: AgentMemory) {
    agentMemoryRef = memory;
}

export async function performWebSearch(query: string): Promise<string> {
    if (agentMemoryRef) updateMemory(agentMemoryRef, "WebSearch", query, "Attempted");
    console.log(chalk.cyan(t('webSearchAttempt', { query })));
    try {
        const response = await axios.get('https://html.duckduckgo.com/html/', {
            params: { q: query },
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://duckduckgo.com/'
            },
            timeout: 15000
        });
        const results: { href: string; title: string; body: string }[] = [];
        const resultRegex = /<a class="result__a"[^>]*href="(.*?)"[^>]*>(.*?)<\/a>.*?<a class="result__snippet"[^>]*>(.*?)<\/a>/gs;
        let match;
        while ((match = resultRegex.exec(response.data)) !== null && results.length < MAX_SEARCH_RESULTS) {
            const decodeEntities = (encodedString: string | undefined): string => {
                if (!encodedString) return '';
                const translate_re = /&(nbsp|amp|quot|lt|gt);/g;
                const translate: { [key: string]: string } = {
                    "nbsp":" ", "amp" : "&", "quot": '"', "lt"  : "<", "gt"  : ">"
                };
                return encodedString.replace(translate_re, (match: string, entity: string): string => {
                    return translate[entity] ?? match;
                }).replace(/&#(\d+);/gi, (match: string, numStr: string): string => {
                    const num = parseInt(numStr, 10);
                    return String.fromCharCode(num);
                });
            }
            const href = decodeEntities(match?.[1]?.trim());
            const title = decodeEntities(match?.[2]?.replace(/<.*?>/g, '')?.trim());
            const body = decodeEntities(match?.[3]?.replace(/<.*?>/g, '')?.trim());
            results.push({ href, title, body });
        }
        if (results.length === 0) {
            if (agentMemoryRef) updateMemory(agentMemoryRef, "WebSearch", query, "Success (No Results)");
            return t('webSearchNoResults', { query });
        } else {
            let resultsText = t('webSearchResultsTitle', { query }) + '\n\n';
            results.forEach((res, i) => {
                resultsText += t('webSearchResultEntry', {
                    index: i + 1,
                    title: res.title,
                    body: res.body.substring(0, 250),
                    href: res.href
                }) + '\n\n';
            });
            if (agentMemoryRef) updateMemory(agentMemoryRef, "WebSearch", query, "Success");
            return resultsText.trim();
        }
    } catch (error: unknown) {
        let errorMsg: string;
        if (axios.isAxiosError(error)) {
            if (error.code === 'ECONNABORTED') {
                errorMsg = t('webSearchTimeoutError');
            } else if (error.response) {
                errorMsg = t('webSearchHttpError', { status: error.response.status, statusText: error.response.statusText });
            } else {
                errorMsg = error.message;
            }
        } else if (error instanceof Error) {
            errorMsg = error.message;
        } else {
            errorMsg = String(error);
        }
        console.log(chalk.red(t('webSearchError', { query, message: errorMsg })));
        if (agentMemoryRef) updateMemory(agentMemoryRef, "WebSearch", query, "Failure", errorMsg);
        return t('webSearchError', { query, message: errorMsg });
    }
}
