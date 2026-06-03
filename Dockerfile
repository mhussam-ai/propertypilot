# syntax=docker/dockerfile:1
#
# Multi-stage build → lean standalone Next.js runtime image.
# Proves PropertyPilot is a deployable system, not a localhost script.
#
# NEXT_PUBLIC_* are inlined by Next at BUILD time (used by both the browser and
# server code), so they are build ARGs, not runtime env. Everything else
# (service-role key, KMS key, Bolna/Inngest/Resend secrets) is read at runtime
# from the container environment — see docker-compose.yml.

# ---------- deps ----------
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@9.15.2 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---------- builder ----------
FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@9.15.2 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Browser-visible config, baked at build. Default to host.docker.internal so the
# in-container server can reach the host's `supabase start` stack.
ARG NEXT_PUBLIC_SUPABASE_URL=http://host.docker.internal:54321
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=
ARG NEXT_PUBLIC_SENTRY_DSN=
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    NEXT_TELEMETRY_DISABLED=1

# Ensure a public/ dir exists so the runner COPY never fails (repo has none today).
RUN mkdir -p public
# Sentry source-map upload is a no-op without SENTRY_AUTH_TOKEN (see next.config.ts).
RUN pnpm build

# ---------- runner ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

# Run as the unprivileged built-in `node` user.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

USER node
EXPOSE 3000
CMD ["node", "server.js"]
