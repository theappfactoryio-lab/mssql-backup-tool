FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache su-exec
COPY --from=dependencies --chown=10001:0 /app/node_modules ./node_modules
COPY --chown=10001:0 package.json ./
COPY --chown=10001:0 src ./src
COPY --chown=10001:0 views ./views
COPY --chown=10001:0 public ./public
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p /app/backups/.incoming /app/backups/.work \
    && chown -R 10001:0 /app/backups \
    && chmod -R 0770 /app/backups
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "src/server.js"]