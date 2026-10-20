"""Exercise the actual Python HTTP route without starting user services."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
with tempfile.TemporaryDirectory(prefix="horde-binding-test-") as isolated_config:
    os.environ["HORDE_CONFIG_DIR"] = isolated_config
    os.environ["HORDE_NODE_EXECUTABLE"] = shutil.which("node") or "node"
    import horde_mcp_bridge as bridge

    server = bridge.ThreadingHTTPServer(("127.0.0.1", 0), bridge.BridgeHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        canonical = json.loads(subprocess.check_output([
            os.environ["HORDE_NODE_EXECUTABLE"], "-e",
            "process.stdout.write(JSON.stringify(require('./worlds/scene-draft').schema("
            "{events:{type:'array',items:{type:'object',properties:{type:{type:'string'},"
            "actor_id:{type:'string'},status:{type:'string'}}}}},'scene_draft_v3',{linkedRequired:true})))"
        ], cwd=ROOT, text=True, encoding="utf-8"))
        body = {"canonical": canonical, "context": {"worldId": "test", "sessionId": "save",
                "version": 1, "nonce": "same-retry", "input": "Hello.", "now": 485},
                "draft": {"protocol": "scene_draft_v3", "actions": [{"kind": "speech",
                    "status": "resolved", "effects": [], "response": [{"text": "Good day."}]}]}}

        def post(payload):
            request = urllib.request.Request(
                f"http://127.0.0.1:{server.server_port}/worlds/bind-turn",
                data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(request, timeout=20) as response:
                return json.load(response)

        first, second = post(body), post(body)
        assert first["ok"] and second["ok"]
        assert first["binding"]["turnId"] == second["binding"]["turnId"]
        assert first["draft"]["actions"][0]["action_id"] == first["draft"]["narrative"][0]["action_id"]
        body["draft"]["actions"][0]["action_id"] = "model_guess"
        rejected = post(body)
        assert not rejected["ok"]
        assert any(error["reason"] == "engine_owned_binding_required" for error in rejected["errors"])
        print("PASS real HTTP route: stable server IDs, structural binding, rejected model-supplied IDs")
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
