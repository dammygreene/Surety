import { handle } from "@hono/node-server/vercel";
import { app } from "../src/server.js";

export default handle(app);
