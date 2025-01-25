from node:23-alpine as base
workdir /app
run corepack enable pnpm

from base as build
copy pnpm-lock.yaml .
run --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm fetch --frozen-lockfile
copy package.json .
run --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm i --frozen-lockfile
copy src src
run pnpm run build

from node:23-alpine as runtime
run apk add --no-cache curl
run addgroup --system --gid 1001 nodejs
run adduser --system --uid 1001 nodejs
copy --from=build --chown=nodejs:nodejs /app/dist/server.js .
user nodejs
env NODE_ENV="production"
cmd ["node", "server.js"]
healthcheck --start-period=5s --start-interval=5s cmd curl --fail http://localhost:${PORT:-8000}/health || exit 1
