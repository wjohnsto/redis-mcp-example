# redis-mcp-chat

To install dependencies:

```bash
bun install
```

To setup environment variables:

```bash
cp .env.example .env
```

Then edit the `.env` file with your Redis connection details and Anthropic key.

To setup local Redis:

```bash
docker compose up -d
```

Update the `.env` file with the Redis connection details if necessary.

```bash
REDIS_HOST=redis
REDIS_PORT=6379
DOCKER_NETWORK=redis-mcp-chat_redis_network
```

To run the application:

```bash
bun dev
```

Example prompts:

1. Generate three sample users and store them in redis as JSON. Log each user created to a stream.
1. Generate a conversation between a parent and their child about a school project and store it in a stream.
