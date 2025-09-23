# Use a base image that already has Bun
FROM oven/bun:1
WORKDIR /app

# Copy package files and install dependencies
COPY package.json .
RUN bun install --frozen-lockfile

# Copy the rest of the bot's files
COPY . .

# Start the bot
CMD ["bun", "index.js"]