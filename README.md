# openphone-mcp

MCP server for [OpenPhone](https://www.openphone.com) (now [Quo](https://www.quo.com)) — read SMS messages, list calls, send texts, and manage conversations from the terminal via the [Model Context Protocol](https://modelcontextprotocol.io).

## Tools

| Tool | Description |
|------|-------------|
| `get_phone_numbers` | List all phone numbers in your workspace |
| `list_messages` | List SMS messages for a phone number (with date/direction filters) |
| `get_message` | Get a specific message by ID |
| `send_message` | Send an SMS from the required `main` or `agent` line (1:1 or group, up to 10 recipients). No default line. |
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

### Updating the box

The process on the box runs compiled `dist/` through `run.mjs`. `dist/` is not committed. After a merge is approved, on that box:

```bash
npm install
npm run build
```

`npm run build` is `tsc`. It writes `dist/index.js` and `dist/lines.js`. Restart the process that runs `dist/` through `run.mjs` after that build. Pulling the source alone does not change what the box runs.

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

## Sending lines

`send_message` requires `line`. There is no default line. The server resolves the name through one map and sends from that phone-number id.

| `line` | Name | Number | Phone number id | Use |
|--------|------|--------|-----------------|-----|
| `main` | Dr Ray - Main | (805) 364-0996 | `PNMCqbEJB7` | Patient and customer texts |
| `agent` | Agent line | (805) 892-6412 | `PNMb6TbOHu` | Internal only: Matt, Julia, and staff |

Optional `from` must be that same line, as its phone-number id or its E.164 number (`+18053640996` for main, `+18058926412` for agent). If `from` does not match `line`, or `line` is omitted, the send is rejected and nothing is sent.

Optional `confirmTo` is the last 4 digits of the recipient. When it is set, every number in `to` must end with those digits. `to` is still one E.164 string, or an array of 1–10 numbers for a group SMS.

A successful result echoes the line that was used: `sentFromLine` (name, number, and id), plus `line`, `lineName`, `lineNumber`, `lineE164`, and `lineId`.

## Usage Examples

**Read recent SMS messages:**
> "Show me my recent text messages on OpenPhone"

**Read verification codes:**
> "What's the latest SMS I received?"

**Send a patient or customer text from the Main line:**
> "Send a text from the main line to +15551234567 saying 'On my way'"

**Send an internal text from the Agent line:**
> "Send a text from the agent line to +15551234567 saying 'Running late'"

**Send a group SMS from the Main line:**
> "Send a text from the main line to +15551234567 and +15559876543 saying 'See you there'"

**Check call history:**
> "Show me my recent calls"

## API Details

- **Base URL:** `https://api.openphone.com/v1` (override with `QUO_API_BASE` or `OPENPHONE_API_BASE`, e.g. `https://api.quo.com/v1`)
- **Auth:** API key in `Authorization` header (no Bearer prefix)
- **API version:** `Quo-Api-Version: 2026-03-30` (required for group SMS)
- **Rate limit:** 10 requests/second per API key
- **Docs:** [quo.com/docs/api-reference](https://www.quo.com/docs/api-reference/introduction)

### Group SMS

- `send_message.line` is required: `main` or `agent`. There is no default.
- `send_message.to` accepts a single E.164 string (1:1) or an array of 1–10 E.164 strings (group).
- `send_message.confirmTo`, when set, is the last 4 digits and must match every recipient.
- `list_messages.participants` is sent as repeated `participants` query params (not `participants[]`).

## License

MIT
