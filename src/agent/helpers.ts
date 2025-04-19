// Fonctions utilitaires extraites de agent.ts
export function parseAndUpdateSystemInfo(content: string, agentMemory: any, chalk: any) {
    const lines = content.split('\n');
    const systemInfoRegex = /^\s*([\w_.-]+)\s*:\s*(.+)$/;
    let updated = false;
    lines.forEach(line => {
        const match = line.match(systemInfoRegex);
        if (match && match[1] !== undefined && match[2] !== undefined) {
            const key = match[1].trim();
            const value = match[2].trim();
            if (!agentMemory.system_info) {
                agentMemory.system_info = {};
            }
            if (agentMemory.system_info[key] !== value) {
                agentMemory.system_info[key] = value;
                updated = true;
                if (chalk) console.log(chalk.dim(`[Memory Update] system_info.${key} = "${value}"`));
            }
        }
    });
}
