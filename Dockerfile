FROM node:16

WORKDIR /app/bots

COPY . .

RUN npm install
RUN npm run build

ENTRYPOINT ["node" , "./dist/index.js"]

EXPOSE 8080
