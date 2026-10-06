FROM node:20-alpine
WORKDIR /
COPY package*.json ./
RUN npm ci
COPY . .
# If you use a build step for TypeScript, keep the next line. Otherwise, remove it.
RUN npm run build
# Expose the internal port your Node app listens on (e.g., 3000)
EXPOSE 2010
# Change this to your actual start command
CMD ["npm", "start"]