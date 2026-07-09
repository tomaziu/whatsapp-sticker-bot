FROM node:20-slim

# Instala ffmpeg e dependências do sistema
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copia package.json e instala dependências
COPY package.json package-lock.json ./
RUN npm install --production

# Copia o código do bot
COPY . .

# Cria pasta de sessão
RUN mkdir -p session

CMD ["node", "index.js"]
