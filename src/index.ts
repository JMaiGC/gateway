/**
 * Rubeus (Hard)worker
 *
 * @module index
 */

import { Hono } from "hono";
import { prettyJSON } from "hono/pretty-json";
import { HTTPException } from 'hono/http-exception'
// import { env } from 'hono/adapter' // Have to set this up for multi-environment deployment

import { completeHandler } from "./handlers/completeHandler.js";
import { chatCompleteHandler } from "./handlers/chatCompleteHandler.js";
import { embedHandler } from "./handlers/embedHandler.js";
import { proxyHandler } from "./handlers/proxyHandler.js";
import { proxyGetHandler } from "./handlers/proxyGetHandler.js";
import { chatCompletionsHandler } from "./handlers/chatCompletionsHandler.js";
import { completionsHandler } from "./handlers/completionsHandler.js";
import { embeddingsHandler } from "./handlers/embeddingsHandler.js";
import { requestValidator } from "./middlewares/requestValidator/index.js";

// Create a new Hono server instance
const app = new Hono();

/**
 * GET route for the root path.
 * Returns a greeting message.
 */
app.get("/", (c) => c.text("Rubeus says hey! Read the docs on https://rubeus.dev"));

// Use prettyJSON middleware for all routes
app.use("*", prettyJSON());

/**
 * Default route when no other route matches.
 * Returns a JSON response with a message and status code 404.
 */
app.notFound((c) => c.json({ message: "Not Found", ok: false }, 404));

/**
 * Global error handler.
 * If error is instance of HTTPException, returns the custom response.
 * Otherwise, logs the error and returns a JSON response with status code 500.
 */
app.onError((err, c) => {
  if (err instanceof HTTPException) {
      return err.getResponse()
  }
  c.status(500);
  return c.json({status: "failure", message: err.message});
});

/**
 * POST route for '/v1/complete'.
 * Handles requests by passing them to the completeHandler.
 */
app.post("/v1/complete", completeHandler);

/**
 * POST route for '/v1/chatComplete'.
 * Handles requests by passing them to the chatCompleteHandler.
 */
app.post("/v1/chatComplete", chatCompleteHandler);

/**
 * POST route for '/v1/embed'.
 * Handles requests by passing them to the embedHandler.
 */
app.post("/v1/embed", embedHandler);

/**
 * POST route for '/v1/chat/completions'.
 * Handles requests by passing them to the chatCompletionsHandler.
 */
app.post("/v1/chat/completions",requestValidator, chatCompletionsHandler);

/**
 * POST route for '/v1/completions'.
 * Handles requests by passing them to the completionsHandler.
 */
app.post("/v1/completions", requestValidator, completionsHandler);

/**
 * POST route for '/v1/embeddings'.
 * Handles requests by passing them to the embeddingsHandler.
 */
app.post("/v1/embeddings", requestValidator, embeddingsHandler);

// Support the /v1 proxy endpoint
app.post("/v1/proxy/*", proxyHandler);

// Support the /v1 proxy endpoint after all defined endpoints so this does not interfere.
app.post("/v1/*", requestValidator, proxyHandler)

// Support the /v1 proxy endpoint after all defined endpoints so this does not interfere.
app.get('/v1/*', requestValidator, proxyGetHandler)

app.delete('/v1/*', requestValidator, proxyGetHandler)

// Export the app
export default app;
