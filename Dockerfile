FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies --chown=10001:0 /app/node_modules ./node_modules
COPY --chown=10001:0 package.json ./
COPY --chown=10001:0 src ./src
COPY --chown=10001:0 views ./views
COPY --chown=10001:0 public ./public
RUN mkdir -p /app/backups
USER 10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]