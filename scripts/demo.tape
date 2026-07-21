# VHS tape — renders docs/demo.gif. Install charmbracelet/vhs, then:
#   vhs scripts/demo.tape
# It drives real curl calls against the live server.

Output docs/demo.gif
Set FontSize 18
Set Width 1200
Set Height 800
Set Padding 20
Set Theme "Dracula"

Type "# natural-docs-mcp — search Natural's docs from your agent"
Enter
Sleep 1s

Type "curl -s -X POST $URL -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"search_docs\",\"arguments\":{\"query\":\"idempotency\",\"limit\":2}}}' | jq -r '.result.content[0].text | fromjson | .hits[].slug'"
Enter
Sleep 3s

Type "# look up an endpoint's exact shape"
Enter
Sleep 1s

Type "curl -s -X POST $URL -d '{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"lookup_endpoint\",\"arguments\":{\"query\":\"payments.create\",\"detail\":true}}}' | jq -r '.result.content[0].text | fromjson | {op:.operationId, params:[.parameters[].name], resp:(.responses|keys)}'"
Enter
Sleep 4s
