# openphone-mcp

MCP server for [OpenPhone](https://www.openphone.com) (now [Quo](https://www.quo.com)) — read SMS messages, list calls, send texts, and manage conversations from the terminal via the [Model Context Protocol](https://modelcontextprotocol.io).

## Tools

| Tool | Description |
|------|-------------|
| `get_phone_numbers` | List all phone numbers in your workspace |
| `list_messages` | List SMS messages for a phone number (with date/direction filters) |
| `get_message` | Get a specific message by ID |
| `send_message` | Send an SMS from an OpenPhone number |
| `list_conversations` | List conversation threads |
| `list_calls` | List call history for a phone number |
| `get_call` | Get details of a specific call |

## Setup

### 1. Get an API key

Go to [OpenPhone Settings > API](https://my.openphone.com/settings/api) and generate an API key.

### 2. Install

```bash
npm install -g openphone-mcp
```

Or clone and build locally:

```bash
git clone https://github.com/studio-corsair/openphone-mcp.git
cd openphone-mcp
npm install
npm run build
```

### 3. Configure Claude Code

Add to your `~/.claude.json`:

```json
{
  "mcpServers": {
    "openphone": {
      "command": "npx",
      "args": ["-y", "openphone-mcp"],
      "env": {
        "OPENPHONE_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

Or if installed locally:

```json
{
  "mcpServers": {
    "openphone": {
      "command": "node",
      "args": ["/path/to/openphone-mcp/dist/index.js"],
      "env": {
        "OPENPHONE_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

## Usage Examples

**Read recent SMS messages:**
> "Show me my recent text messages on OpenPhone"

**Read verification codes:**
> "What's the latest SMS I received?"

**Send a text:**
> "Send a text to +15551234567 from my OpenPhone number saying 'On my way'"

**Check call history:**
> "Show me my recent calls"

## API Details

- **Base URL:** `https://api.openphone.com/v1`
- **Auth:** API key in `Authorization` header (no Bearer prefix)
- **Rate limit:** 10 requests/second per API key
- **Docs:** [quo.com/docs/api-reference](https://www.quo.com/docs/api-reference/introduction)

## License

MIT
