FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY packages/web/package.json packages/web/package.json
COPY packages/server/package.json packages/server/package.json
RUN npm ci

COPY packages packages
COPY scripts scripts
RUN npm run build

EXPOSE 2010
CMD ["npm", "start"]
