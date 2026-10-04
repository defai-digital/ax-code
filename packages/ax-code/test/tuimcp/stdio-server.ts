// Real stdio transport fixture; stdout is reserved for MCP JSON-RPC.
import { serveTuiMcp } from "../../src/tuimcp/mcp-server"
await serveTuiMcp(process.argv[2])
