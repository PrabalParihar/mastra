import { describe, expect, it } from 'vitest';
import { filterMessagesForPersistence } from './filter-messages-for-persistence';
import { MessageList } from './message-list';
import type { MastraDBMessage } from './types';

/**
 * Gemini 3 puts `thoughtSignature` on the first function call of a parallel step.
 * Persisting that step strips `updateWorkingMemory`, and a same-turn replay is
 * rejected with "Function call is missing a thought_signature" (#27231).
 */
describe('filterMessagesForPersistence', () => {
  it('replays a parallel Gemini step with the thought signature on the remaining tool call (#27231)', () => {
    const signature = { google: { thoughtSignature: 'sig-wm' } };
    const assistant: MastraDBMessage = {
      id: 'm2',
      role: 'assistant',
      createdAt: new Date('2026-01-01T00:00:01Z'),
      threadId: 'thread-1',
      resourceId: 'user-1',
      content: {
        format: 2,
        parts: [
          { type: 'step-start' },
          {
            type: 'tool-invocation',
            toolInvocation: {
              state: 'result',
              toolCallId: 'wm-1',
              toolName: 'updateWorkingMemory',
              args: { memory: 'Sam likes hiking' },
              result: { ok: true },
            },
            providerMetadata: signature,
          },
          {
            type: 'tool-invocation',
            toolInvocation: {
              state: 'result',
              toolCallId: 'suggest-1',
              toolName: 'suggestReplies',
              args: { replies: ['Hike the ridge'] },
              result: { ok: true },
            },
          },
        ],
        toolInvocations: [
          {
            state: 'result',
            toolCallId: 'wm-1',
            toolName: 'updateWorkingMemory',
            args: { memory: 'Sam likes hiking' },
            result: { ok: true },
          },
          {
            state: 'result',
            toolCallId: 'suggest-1',
            toolName: 'suggestReplies',
            args: { replies: ['Hike the ridge'] },
            result: { ok: true },
          },
        ],
      },
    };

    const [persisted] = filterMessagesForPersistence([assistant]);
    if (!persisted) throw new Error('assistant message was dropped');
    expect(persisted.content.toolInvocations?.map(invocation => invocation.toolName)).toEqual(['suggestReplies']);
    const storedPart = persisted.content.parts.find(part => part.type === 'tool-invocation');
    expect(storedPart?.type === 'tool-invocation' && storedPart.toolInvocation.toolName).toBe('suggestReplies');
    expect(storedPart?.type === 'tool-invocation' && storedPart.providerMetadata).toEqual(signature);

    const replay = new MessageList().add([persisted], 'memory').get.all.aiV5.prompt();
    const toolCalls = replay.flatMap(message =>
      message.role === 'assistant' && Array.isArray(message.content)
        ? message.content.filter(part => part.type === 'tool-call')
        : [],
    );

    expect(toolCalls.map(part => part.toolName)).toEqual(['suggestReplies']);
    expect(toolCalls[0] && 'providerOptions' in toolCalls[0] && toolCalls[0].providerOptions).toMatchObject(signature);
    expect(JSON.stringify(replay)).not.toContain('updateWorkingMemory');
  });
});
