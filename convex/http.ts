import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

const http = httpRouter();

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age": "86400",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function errorResponse(error: any) {
  const data = error?.data || {};
  return json({
    error: {
      code: data.code || error?.code || "SERVER_ERROR",
      message: data.message || error?.message || "Unexpected server error.",
      details: data.details || null,
    },
  }, data.status || error?.status || 500);
}

async function body(request: Request) {
  const raw = await request.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw { code: "BAD_REQUEST", message: "Request body must be valid JSON.", status: 400 };
  }
}

function wordIdFrom(request: Request) {
  const url = new URL(request.url);
  return decodeURIComponent(url.pathname.replace(/^\/api\/words\//, ""));
}

http.route({
  pathPrefix: "/api/",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
});

http.route({
  path: "/api/bootstrap",
  method: "GET",
  handler: httpAction(async (ctx) => {
    try {
      return json(await ctx.runQuery(api.data.getBootstrap, {}));
    } catch (error) {
      return errorResponse(error);
    }
  }),
});

http.route({
  path: "/api/words",
  method: "GET",
  handler: httpAction(async (ctx) => {
    try {
      return json(await ctx.runQuery(api.data.listWords, {}));
    } catch (error) {
      return errorResponse(error);
    }
  }),
});

http.route({
  path: "/api/review-queue",
  method: "GET",
  handler: httpAction(async (ctx) => {
    try {
      return json(await ctx.runQuery(api.data.getReviewQueue, {}));
    } catch (error) {
      return errorResponse(error);
    }
  }),
});

http.route({
  path: "/api/profile",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      return json(await ctx.runMutation(api.data.saveProfile, await body(request)));
    } catch (error) {
      return errorResponse(error);
    }
  }),
});

http.route({
  path: "/api/words",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const payload = await body(request);
      const word = await ctx.runMutation(api.data.saveWord, {
        card: payload.card || payload,
        source: payload.source || {},
      });
      const bootstrap = await ctx.runQuery(api.data.getBootstrap, {});
      return json({ word, stats: bootstrap.stats });
    } catch (error) {
      return errorResponse(error);
    }
  }),
});

http.route({
  path: "/api/review",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const payload = await body(request);
      return json(await ctx.runMutation(api.data.recordReview, {
        word_id: String(payload.word_id || ""),
        rating: String(payload.rating || ""),
      }));
    } catch (error) {
      return errorResponse(error);
    }
  }),
});

http.route({
  pathPrefix: "/api/words/",
  method: "PUT",
  handler: httpAction(async (ctx, request) => {
    try {
      const payload = await body(request);
      const word = await ctx.runMutation(api.data.updateWord, {
        id: wordIdFrom(request),
        card: payload.card || payload,
      });
      const bootstrap = await ctx.runQuery(api.data.getBootstrap, {});
      return json({ word, stats: bootstrap.stats });
    } catch (error) {
      return errorResponse(error);
    }
  }),
});

http.route({
  pathPrefix: "/api/words/",
  method: "DELETE",
  handler: httpAction(async (ctx, request) => {
    try {
      const word = await ctx.runMutation(api.data.deleteWord, { id: wordIdFrom(request) });
      const bootstrap = await ctx.runQuery(api.data.getBootstrap, {});
      return json({ deleted: true, word, stats: bootstrap.stats });
    } catch (error) {
      return errorResponse(error);
    }
  }),
});

export default http;
