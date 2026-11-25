import { handle, type Env } from "./handler.js";

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handle(req, env, { fetch: (...a) => fetch(...a), now: () => new Date() });
  },
};
