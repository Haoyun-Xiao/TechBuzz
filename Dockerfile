FROM node:24-alpine
WORKDIR /app
RUN mkdir /data && chown node:node /data
COPY --chown=node:node *.mjs package.json THIRD_PARTY_NOTICES.md ./
COPY --chown=node:node public/ ./public/
USER node
ENV NODE_ENV=production TECHBUZZ_DB=/data/techbuzz.sqlite
EXPOSE 3000
CMD ["node","server.mjs"]
