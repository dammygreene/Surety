import { handle } from "@hono/node-server/vercel";
import type { IncomingMessage, ServerResponse } from "node:http";
import { app } from "./server.js";

const honoHandler = handle(app);

export function routeHandler(path: string) {
  return (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://vercel.internal");
    request.url = `${path}${url.search}`;
    return honoHandler(request, response);
  };
}
