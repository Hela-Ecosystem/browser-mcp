# Browser Agent MCP Server Dockerfile
FROM mcr.microsoft.com/playwright:v1.44.1-jammy

# Create app directory
WORKDIR /app

# Install app dependencies
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy app source code
COPY . .

# Install the Cytosol visual-intelligence bridge; model weights remain lazy and
# are downloaded by Cactus on the first browser_visual_analyze call.
RUN npm run setup:mirage

# Build the application (runs the echo script we added)
RUN npm run build

# Command to run the application
CMD ["node", "src/server.js"]
