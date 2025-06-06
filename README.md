# redis-mcp-chat

[!Redis MCP Terminal Chat](./demo/redis-mcp-terminal-chat.gif)

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

To run the application:

```bash
bun dev
```

Example prompts:

1. Generate and store three separate users. Then generate a login stream that indicates the users logging in and out of a system.
1. Generate a conversation between a parent and their child about a school project and store it in a stream.
1. Generate some example cached queries and responses for a weather application.
