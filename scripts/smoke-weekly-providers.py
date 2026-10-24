#!/usr/bin/env python3
"""Read-only, nonpublishing smoke checks. Never print API responses or tokens."""
import json
import os
import sys
import urllib.error
import urllib.request

def post(url, token_headers, body):
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={
        "Content-Type": "application/json", **token_headers
    }, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=35) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError("Provider rejected request (HTTP " + str(error.code) + ")") from None
    except Exception as error:
        raise RuntimeError("Provider request failed: " + type(error).__name__) from None

def sonar():
    key = os.environ.get("PERPLEXITY_API_KEY", "")
    if not key:
        raise RuntimeError("PERPLEXITY_API_KEY repository secret missing")
    model = os.environ.get("PERPLEXITY_SEARCH_MODEL") or "sonar-pro"
    result = post("https://api.perplexity.ai/chat/completions",
        {"Authorization": "Bearer " + key},
        {"model": model,
         "messages": [
             {"role": "system", "content": "Return only JSON for a technical connectivity test. Do not search for a news article."},
             {"role": "user", "content": "Return JSON with status equal to ok and provider equal to sonar."}
         ],
         "max_tokens": 120,
         "response_format": {"type": "json_schema", "json_schema": {
             "schema": {"type": "object", "properties": {
                 "status": {"type": "string"}, "provider": {"type": "string"}
             }, "required": ["status", "provider"]}
         }}}
    )
    content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
    data = json.loads(content)
    if data.get("status") != "ok" or data.get("provider") != "sonar":
        raise RuntimeError("Sonar returned an unexpected structured response")
    print("PASS Perplexity Sonar: authenticated, structured response accepted (model " + model + ")")

def claude():
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY repository secret missing (CLAUDE_API_KEY is not the expected name)")
    model = os.environ.get("CLAUDE_REVIEW_MODEL") or "claude-sonnet-5-5"
    result = post("https://api.anthropic.com/v1/messages",
        {"x-api-key": key, "anthropic-version": "2023-06-01"},
        {"model": model, "max_tokens": 150,
         "messages": [{"role": "user", "content": "Technical connectivity check. Reply as JSON with status=ok and reviewer=claude. Do not review or publish anything."}],
         "output_config": {"format": {"type": "json_schema", "schema": {
             "type": "object", "additionalProperties": False,
             "properties": {"status": {"type": "string"}, "reviewer": {"type": "string"}},
             "required": ["status", "reviewer"]
         }}}}
    )
    if result.get("stop_reason") != "end_turn":
        raise RuntimeError("Claude response was incomplete")
    text = next((c.get("text", "") for c in result.get("content", []) if c.get("type") == "text"), "")
    data = json.loads(text)
    if data.get("status") != "ok" or data.get("reviewer") != "claude":
        raise RuntimeError("Claude returned an unexpected structured response")
    print("PASS Claude: authenticated, structured response accepted (model " + model + ")")

def main():
    results = []
    for name, fn in (("Perplexity Sonar", sonar), ("Claude", claude)):
        try:
            fn()
            results.append(True)
        except Exception as error:
            print("FAIL " + name + ": " + str(error), file=sys.stderr)
            results.append(False)
    print("No article created, no GitHub PR/commit to main, no social post sent.")
    if not all(results):
        sys.exit(1)

if __name__ == "__main__":
    main()
