# Multi-stage: build the static site with Node, serve with nginx
# (DESIGN.md §6.2 — helix.brooks-security.com on the existing Traefik Gateway)

# ── Stage 1: Build ─────────────────────────────────────────
FROM node:26-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Stage 2: Serve ─────────────────────────────────────────
FROM nginx:alpine

# Copy static dist/ into nginx's default document root
COPY --from=build /app/dist /usr/share/nginx/html

# Single-page static file — no SPA fallback needed.
# Default nginx config serves index.html for / and static files as-is.

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]