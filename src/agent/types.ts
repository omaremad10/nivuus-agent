// Types et interfaces extraits de agent.ts
export type ActionStatus = 'Attempted' | 'Success' | 'Failure' | 'Cancelled' | 'Success (No Results)';

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    name?: string;
    tool_calls?: any[];
    tool_call_id?: string;
}

export interface ActionLogEntry {
    timestamp: string;
    actionType: string;
    target: string;
    status: ActionStatus;
    errorMsg?: string | null;
}

export interface AgentMemory {
    system_info: any;
    action_log: ActionLogEntry[];
    notes: string;
}
