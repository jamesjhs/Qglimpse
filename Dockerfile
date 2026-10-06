FROM node:20-alpine AS deps

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
COPY packages/web/package.json packages/web/package.json
COPY packages/server/package.json packages/server/package.json
RUN npm ci

FROM deps AS build

COPY packages packages
COPY scripts scripts
RUN npm run build

RUN npm prune --omit=dev --workspaces

FROM node:20-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN apk add --no-cache libstdc++

COPY package*.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/server/package.json packages/server/package.json
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/web/package.json packages/web/package.json
COPY --from=build /app/packages/web/dist packages/web/dist
COPY --from=build /app/scripts scripts

EXPOSE 2010
CMD ["npm", "start"]
