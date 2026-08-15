declare module 'supertest' {
  import type { Express } from 'express';
  interface Test extends PromiseLike<Response> {
    set(field: string | Record<string, string>, value?: string): Test;
    send(body?: unknown): Test;
    expect(status: number): Test;
  }
  interface Response { body: any; status: number; }
  interface SuperTest { post(path: string): Test; put(path: string): Test; get(path: string): Test; delete(path: string): Test; }
  const request: (app: Express) => SuperTest;
  export default request;
}
