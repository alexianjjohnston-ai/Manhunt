/**
 * DEMO BUILD ONLY: route the app's WebSocket and /api traffic to the in-page server,
 * so the unmodified client code runs against the real engine without a network.
 */
import type { ServerMessage } from '@shared/protocol';
import { api, disconnect, receive, type DemoConn } from './server';

const LATENCY_MS = 30;

class DemoSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  private conn: DemoConn;

  constructor(_url: string) {
    this.conn = {
      deliver: (m: ServerMessage) => {
        const data = JSON.stringify(m);
        window.setTimeout(() => this.readyState === 1 && this.onmessage?.({ data }), LATENCY_MS);
      },
      close: (code) => this.finish(code),
    };
    window.setTimeout(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.onopen?.();
    }, LATENCY_MS);
  }

  send(data: string) {
    if (this.readyState !== 1) return;
    window.setTimeout(() => receive(this.conn, data), LATENCY_MS);
  }

  close(code = 1000) {
    this.finish(code);
  }

  private finish(code: number) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    disconnect(this.conn);
    window.setTimeout(() => this.onclose?.({ code }), 0);
  }
}

(window as unknown as { WebSocket: unknown }).WebSocket = DemoSocket;

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const path = url.startsWith('/') ? url : new URL(url, location.href).pathname;
  if (!path.startsWith('/api/')) return realFetch(input, init);
  let body: unknown = {};
  try {
    body = init?.body ? JSON.parse(String(init.body)) : {};
  } catch {
    body = {};
  }
  await new Promise((r) => setTimeout(r, LATENCY_MS));
  const res = api(init?.method ?? 'GET', path.split('?')[0]!, body);
  return new Response(JSON.stringify(res.json), { status: res.status, headers: { 'content-type': 'application/json' } });
};
