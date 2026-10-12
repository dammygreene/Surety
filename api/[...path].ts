import { handle } from "@hono/node-server/vercel";
import { app } from "../src/server.js";
import type { IncomingMessage, ServerResponse } from "node:http";

const honoHandler = handle(app);

export default (request: IncomingMessage, response: ServerResponse) => {
  const originalUrl = request.url ?? "/";
  const url = new URL(originalUrl, "http://vercel.internal");
  if (url.pathname === "/api/_/" || url.pathname.startsWith("/api/_/")) {
    request.url = `${url.pathname.slice("/api/_".length) || "/"}${url.search}`;
  }
  return honoHandler(request, response);
};
