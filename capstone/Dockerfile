# Optional: container image for Render / Railway / Fly.io / any Docker host (not tested in the build environment).
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
# Set ADMIN_PASSWORD and JWT_SECRET as environment variables on the host.
CMD ["npm", "start"]
