# The hosted service: `pine-computer serve` for every project, each by its own key. See docs/hosting.md.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PINE_HOSTED=1 PINE_SERVE_HOST=0.0.0.0 PINE_SERVE_PORT=8080 PINE_COMPUTER_HOME=/data
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
CMD ["node", "dist/cli.js", "serve"]
