FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=node:node server.mjs ./
USER node
ENV PORT=8787
EXPOSE 8787
CMD ["node", "server.mjs"]
