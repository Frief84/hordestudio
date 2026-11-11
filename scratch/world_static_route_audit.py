"""Check the real local HTTP handler for World script assets."""
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.request import urlopen
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from horde_mcp_bridge import BridgeHandler


paths = [
    "resolved-intent.js",
    "model-client.js",
    "universal-checks.js",
    "dynamic-object-discovery.js",
    "perception.js",
    "npc-goal-actions.js",
    "horde-client.js",
]
server = ThreadingHTTPServer(("127.0.0.1", 0), BridgeHandler)
thread = Thread(target=server.serve_forever, daemon=True)
thread.start()
try:
    for name in paths:
        with urlopen(f"http://127.0.0.1:{server.server_port}/worlds/{name}?v=audit") as response:
            assert response.status == 200, (name, response.status)
            assert "javascript" in response.headers["Content-Type"], name
            assert response.read(), name
finally:
    server.shutdown()
    server.server_close()
    thread.join(timeout=2)

print("PASS World JavaScript assets served over the local HTTP route")
