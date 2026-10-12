import { routeHandler } from "../../src/vercel-handler.js";

export default (request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse) => {
  const id = new URL(request.url ?? "/", "http://vercel.internal").pathname.split("/").filter(Boolean).pop();
  if (!id) {
    response.statusCode = 400;
    response.end("Missing payment ID");
    return;
  }
  return routeHandler(`/pay/${id}`)(request, response);
};
