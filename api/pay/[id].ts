import { routeHandler } from "../../src/vercel-handler.js";

export default (request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse) => {
  const id = new URL(request.url ?? "/", "http://vercel.internal").pathname.split("/").filter(Boolean).pop();
  if (!id) {
    response.statusCode = 400;
    response.end("Missing payment ID");
    return;
  }
  const host = request.headers.host;
  if (host) {
    fetch(`https://${host}/api/submissions/${encodeURIComponent(id)}`)
      .then(async (result) => {
        if (!result.ok) {
          response.statusCode = result.status;
          response.end("Submission not found");
          return;
        }
        const payload = await result.json() as { id?: string };
        if (payload.id !== id) {
          response.statusCode = 404;
          response.end("Submission not found");
          return;
        }
        const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
        request.url = `/pay/${id}?submission=${encoded}`;
        return routeHandler(`/pay/${id}`)(request, response);
      })
      .catch(() => {
        response.statusCode = 502;
        response.end("Unable to load submission");
      });
    return;
  }
  return routeHandler(`/pay/${id}`)(request, response);
};
