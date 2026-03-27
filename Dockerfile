FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/data/reports

EXPOSE 3004

CMD ["node", "server.js"]
