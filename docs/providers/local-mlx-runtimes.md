# MTPLX and oMLX local runtimes

Status: Active

Scope: source-checkout integration

Last reviewed: 2026-09-19

Owner: ax-code runtime

The source checkout includes separate **MTPLX** (`mtplx`) and **oMLX** (`omlx`) presets under
`/connect` → **Local LLM runtime**. These presets are not included in the v7.19.3 packaged binaries.
They connect to an already-running server; AX Code does not install, launch, or tune these runtimes.

## Connect

1. Start your runtime and load a model that supports coding tools. Follow the
   [MTPLX instructions](https://github.com/youssofal/MTPLX#the-server) or
   [oMLX instructions](https://github.com/jundot/omlx#quickstart).
2. Select **MTPLX** or **oMLX** in AX Code's local runtime menu and confirm the server endpoint.
3. Select a coding-capable model. Model IDs come from the server's `GET /v1/models` response.

| Runtime | Provider ID | Default API endpoint       | AX Code host override |
| ------- | ----------- | -------------------------- | --------------------- |
| MTPLX   | `mtplx`     | `http://localhost:8000/v1` | `MTPLX_HOST`          |
| oMLX    | `omlx`      | `http://localhost:8000/v1` | `OMLX_HOST`           |

Both upstream servers default to port 8000. Run them one at a time, or assign different ports and save
those endpoints separately. AX Code appends `/v1` once if omitted. A saved endpoint takes precedence
over the host override. Listing a preset does not probe or activate it. Existing provider enable/disable
lists remain authoritative; if you use an allowlist, add the new ID without removing your other providers.

Examples with explicit ports:

```sh
mtplx serve --model /path/to/your/mtplx-model --host 127.0.0.1 --port 8000
omlx serve --model-dir /path/to/your/models --host 127.0.0.1 --port 8001
```

Use the endpoint corresponding to the server you started. Inspect its model IDs with
`curl http://localhost:8000/v1/models` (change the port for your configuration).

## Coding tools and authentication

MTPLX's native chat listing identifies `owned_by: "mtplx"` and `capability: "chat"` separately from
retrieval models. AX Code admits that chat transport for tool use unless it explicitly disables tools.
A generic or unrecognized listing retains conservative defaults.

oMLX's model listing does not declare per-model tool support and can include non-chat models.
Enable tools only for a model whose chat template supports them. Add this to your AX Code configuration,
replacing the exact model ID returned by your server:

```json
{
  "provider": {
    "omlx": {
      "options": { "baseURL": "http://localhost:8001/v1" },
      "models": {
        "your-tool-capable-model-id": { "tool_call": true }
      }
    }
  }
}
```

The explicit tool choice survives discovery. Other discovered models are not promoted to coding models.
oMLX's native `max_model_len` is used for the context limit when present. Runtime sampler settings,
MTP enablement, and server-side output limits remain owned by the runtime.

For a server requiring authentication, set `provider.mtplx.options.apiKey` or
`provider.omlx.options.apiKey` in your configuration, for example `"{env:OMLX_API_KEY}"`.
AX Code sends that configured bearer credential for discovery as well as inference. The local endpoint
dialog does not prompt for a token. Do not put credentials in the endpoint URL.

## AXQuant Qwen MTP in oMLX

AXQuant's Qwen MTP packs include a separate `mtp.safetensors` head and a
`mtplx_runtime.json` execution contract. Recent metadata also includes
`axquant_omlx_compat.json`, which lists the 15 MTP tensors for this 27B pack.
These files describe compatibility; turning on Lightning MTP alone does not import the head.

For oMLX 0.6.4, use a complete, writable local model copy. In **Model Settings**, select
**Import MTP side-car**, then enable **Lightning MTP**. The upstream importer prepares an
MTP shard and updates that local copy's checkpoint index. Keep the original downloaded pack
intact for other runtimes; do not edit a shared Hugging Face cache snapshot in place.
See the [AXQuant model instructions](https://huggingface.co/AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-6bit-MTP#use-with-omlx-lightning-mtp).
AX Code connects to the prepared server and does not modify model weights or perform this import.

## Performance and scope

Loopback MTPLX and oMLX connections receive the local prefix-stability behavior: deterministic tool
ordering and transient context after conversation history. Remote endpoints and AX Trust-managed
connections retain their existing behavior; cloud and AX Trust settings are not changed by these presets.

See the [local inference measurements](../guides/local-inference-results-2026-09-19.md) for tested
hardware, versions, model identity, cache state, and timing definitions. A working OpenAI-compatible
connection does not establish a model's coding quality or guarantee a decode rate.
