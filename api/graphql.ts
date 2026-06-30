import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import cors from 'cors';
import { GraphQLError } from 'graphql';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express5';
import { typeDefs } from './_schema.js';
import { resolvers } from './_resolvers/index.js';
import { buildContext, type GqlContext } from './_gqlContext.js';
import { ensureAllSchemas } from './_trips.js';
import { logServerError } from './_log.js';
import { USER_FACING_CODES } from './_gqlError.js';

// The ONLY deployed Vercel function (issue #91): every former REST endpoint now
// lives behind this single GraphQL handler, permanently clearing the Hobby
// 12-function cap. We export the bare express app — `@vercel/node` detects
// `app.listen` and SKIPS its own body parser, so `express.json()` reads the raw
// request stream without collision (source-confirmed in @vercel/node 5.7.x).

// Codes that represent expected/client errors and must NOT be logged as server
// errors. Anything else (INTERNAL_SERVER_ERROR, an unknown code) is a genuine
// 5xx and gets logged via #20's logServerError. BAD_GATEWAY is user-facing here
// because the Gemini resolvers already log their own 502s explicitly.
const NON_LOGGED_CODES = new Set<string>([
  ...USER_FACING_CODES,
  'GRAPHQL_PARSE_FAILED',
  'GRAPHQL_VALIDATION_FAILED',
  'BAD_REQUEST',
  'PERSISTED_QUERY_NOT_FOUND',
  'PERSISTED_QUERY_NOT_SUPPORTED',
  'OPERATION_RESOLUTION_FAILURE',
]);

const server = new ApolloServer<GqlContext>({
  typeDefs,
  resolvers,
  // Error observability (#20): resolver GraphQLErrors return HTTP 200 + errors[]
  // and never reach the express error-middleware, so we log non-user errors
  // here. Logging the original error (not the located wrapper) keeps the stack.
  formatError(formatted, error) {
    const code = formatted.extensions?.code;
    const isLogged = typeof code !== 'string' || !NON_LOGGED_CODES.has(code);
    if (isLogged) {
      const original =
        error instanceof GraphQLError && error.originalError
          ? error.originalError
          : error;
      logServerError(original, {
        route: '/api/graphql',
        method: 'POST',
        status: 500,
        detail: formatted.message,
      });
    }
    return formatted;
  },
});

// Cache server.start() as one module-scope promise (serverless-safe): the cold
// start awaits it once, warm invocations reuse it.
const started = server.start();

// Schema init for ALL THREE table groups (trips/members/invites/votes + the `a`
// activities table + the `c` completed table). Cached so it runs once per
// instance. Without this, a fresh Preview DB would 500 on activities/completed/
// saveActivity/setCompleted/transitionTrip(to=past).
let schemaReady: Promise<void> | null = null;
function ready(): Promise<void> {
  if (!schemaReady) schemaReady = ensureAllSchemas();
  return schemaReady;
}

// expressMiddleware() calls server.assertStarted() at creation, so it must be
// built AFTER start() resolves. We create it lazily on first request rather
// than top-level-awaiting (which @vercel/node's bundling doesn't guarantee).
let middleware: RequestHandler | null = null;
async function graphqlMiddleware(): Promise<RequestHandler> {
  await started;
  if (!middleware) {
    middleware = expressMiddleware(server, {
      context: async ({ req }) => {
        await ready();
        return buildContext(req);
      },
    });
  }
  return middleware;
}

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/graphql', (req: Request, res: Response, next: NextFunction) => {
  graphqlMiddleware()
    .then((mw) => mw(req, res, next))
    .catch(next);
});

// Express error-middleware. Lives here (rather than wrapping the handler in the
// REST-era withErrorLogging) so the export stays the bare app with `.listen`,
// which is what makes Vercel skip its body parser. Catches anything thrown
// outside Apollo's GraphQL pipeline.
app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  logServerError(err, { route: '/api/graphql', method: req.method, status: 500 });
  // If the response already started, we can't write a clean body — hand off to
  // Express's default error handler (which closes the connection).
  if (res.headersSent) {
    next(err);
    return;
  }
  res.status(500).json({ errors: [{ message: 'internal server error' }] });
});

export default app;
