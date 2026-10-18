import { describe, expect, it } from 'vitest';
import { filterMessagesForPersistence } from './filter-messages-for-persistence';
import { MessageList } from './message-list';
import type { MastraDBMessage } from './types';

/**
 * Gemini 3 signs only the first function call of a parallel step. Persistence
 * removes updateWorkingMemory before the step is stored, so that signature has
 * to travel with the call that remains or a same-turn replay is rejected (#27231).
 */
describe('filterMessagesForPersistence Gemini thought signatures (#27231)', () => {
  const message: MastraDBMessage = {
    id: 'assistant-1',
    role: 'assistant',
    createdAt: new Date('2026-01-01T00:00:01Z'),
    threadId: 'thread-1',
    resourceId: 'resource-1',
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
            result: { success: true },
          },
          providerMetadata: { google: { thoughtSignature: 'sig-wm' } },
        },
        {
          type: 'tool-invocation',
          toolInvocation: {
            state: 'result',
            toolCallId: 'replies',
            toolName: 'suggestReplies',
            args: { replies: ['Hike'] },
            result: { ok: true },
          },
        },
      ],
    },
  };

  it('replays the remaining tool call with the working-memory thought signature', () => {
    const [saved] = filterMessagesForPersistence([message]);
    expect(saved?.content.parts).toEqual([
      { type: 'step-start' },
      {
        type: 'tool-invocation',
        toolInvocation: {
          state: 'result',
          toolCallId: 'replies',
          toolName: 'suggestReplies',
          args: { replies: ['Hike'] },
          result: { ok: true },
        },
        providerMetadata: { google: { thoughtSignature: 'sig-wm' } },
      },
    ]);

    const list = new MessageList({ threadId: 'thread-1', resourceId: 'resource-1' });
    list.add(saved!, 'memory');
    const toolCalls = list.get.all.aiV5
      .model()
      .flatMap(modelMessage =>
        Array.isArray(modelMessage.content) ? modelMessage.content.filter(part => part.type === 'tool-call') : [],
      );

    expect(toolCalls).toEqual([
      expect.objectContaining({
        type: 'tool-call',
        toolName: 'suggestReplies',
        providerOptions: expect.objectContaining({
          google: expect.objectContaining({ thoughtSignature: 'sig-wm' }),
        }),
      }),
    ]);
  });

  it('does not overwrite a signature already on the remaining call', () => {
    const signedSurvivor: MastraDBMessage = {
      ...message,
      content: {
        format: 2,
        parts: [
          { type: 'step-start' },
          message.content.parts[1]!,
          {
            type: 'tool-invocation',
            toolInvocation: {
              state: 'result',
              toolCallId: 'replies',
              toolName: 'suggestReplies',
              args: {},
              result: { ok: true },
            },
            providerMetadata: { google: { thoughtSignature: 'sig-keep' } },
          },
        ],
      },
    };

    const [saved] = filterMessagesForPersistence([signedSurvivor]);
    const kept = saved?.content.parts.find(part => part.type === 'tool-invocation');
    expect(kept).toMatchObject({
      toolInvocation: { toolName: 'suggestReplies' },
      providerMetadata: { google: { thoughtSignature: 'sig-keep' } },
    });
  });

  it('keeps text when no tool call survives the working-memory removal', () => {
    const textOnly: MastraDBMessage = {
      ...message,
      content: {
        format: 2,
        parts: [{ type: 'step-start' }, { type: 'text', text: 'Saved that.' }, message.content.parts[1]!],
      },
    };

    const [saved] = filterMessagesForPersistence([textOnly]);
    expect(saved?.content.parts).toEqual([{ type: 'step-start' }, { type: 'text', text: 'Saved that.' }]);
  });
});
