from fastapi.testclient import TestClient

from app.main import app, service


def test_live_websocket_reports_truthful_disconnected_state(monkeypatch):
    monkeypatch.setattr(service, "start_services", lambda: None)
    monkeypatch.setattr(service, "shutdown", lambda: None)
    with TestClient(app) as client:
        with client.websocket_connect("/ws/live") as websocket:
            payload = websocket.receive_json()
    assert payload["status"]["connection"]["connected"] is False
    assert payload["status"]["waveform"] == []
