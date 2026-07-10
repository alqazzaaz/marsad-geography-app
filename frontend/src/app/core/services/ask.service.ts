import { Injectable } from '@angular/core';

export interface AskHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AskCallbacks {
  onChunk: (text: string) => void;
  onDone: () => void;
  onError: (message: string, status?: number) => void;
}

/**
 * Country Q&A over Server-Sent Events. Uses fetch directly because Angular's
 * HttpClient does not expose response streaming.
 */
@Injectable({ providedIn: 'root' })
export class AskService {
  async ask(
    code: string,
    question: string,
    history: AskHistoryMessage[],
    callbacks: AskCallbacks,
    signal?: AbortSignal,
  ): Promise<void> {
    let response: Response;
    try {
      const token = localStorage.getItem('marsad_token');
      response = await fetch(`/api/countries/${code}/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ question, history }),
        signal,
      });
    } catch {
      callbacks.onError('network');
      return;
    }

    if (!response.ok || !response.body) {
      let detail = '';
      try {
        detail = (await response.json())?.detail ?? '';
      } catch {
        /* non-JSON error body */
      }
      callbacks.onError(detail, response.status);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const event of events) {
          const line = event.trim();
          if (!line.startsWith('data:')) {
            continue;
          }
          const payload = JSON.parse(line.slice(5));
          if (payload.text) {
            callbacks.onChunk(payload.text);
          } else if (payload.error) {
            callbacks.onError(payload.error);
            return;
          } else if (payload.done) {
            callbacks.onDone();
            return;
          }
        }
      }
      callbacks.onDone();
    } catch {
      callbacks.onError('network');
    }
  }
}
