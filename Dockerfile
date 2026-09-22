FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@11.19.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
RUN pnpm build

FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
RUN npm install --global pnpm@11.19.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
RUN node --input-type=module -e "import sharp from 'sharp'; await sharp({create:{width:1,height:1,channels:3,background:'#fff'}}).webp().toBuffer()"

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 TIE_ALLOW_REMOTE=1 PORT=4173 TIE_DB_PATH=/data/tie.sqlite
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY src/shared.js src/task-blueprints.js src/guest-blueprint.js src/vendor-categories.js ./src/
COPY src/v2/guest/geometry.mjs ./src/v2/guest/geometry.mjs
COPY --from=build /app/dist ./dist
RUN node --input-type=module -e "await import('./server/http.mjs')"
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 4173
HEALTHCHECK --interval=20s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:4173/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/http.mjs"]
