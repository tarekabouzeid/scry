# Offline stand-in for an OpenAI-compatible LLM — see server.mjs. Demo only.
FROM node:24-alpine
WORKDIR /app
COPY server.mjs ./
ENV PORT=4010
EXPOSE 4010
HEALTHCHECK --interval=5s --timeout=3s --retries=10 \
  CMD wget -qO- http://127.0.0.1:4010/health >/dev/null || exit 1
USER node
CMD ["node", "server.mjs"]
