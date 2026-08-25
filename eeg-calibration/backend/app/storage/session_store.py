from __future__ import annotations

import csv
import json
import queue
import shutil
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from app import config
from app.models.schemas import EEGSample, Marker

EEG_FIELDS = list(EEGSample.model_fields)


class BufferedSessionWriter:
    def __init__(self, session_dir: Path) -> None:
        self.session_dir = session_dir
        self._queue: queue.Queue[tuple[str, Any] | None] = queue.Queue()
        self._thread = threading.Thread(target=self._run, name="session-writer", daemon=True)
        self._thread.start()

    def put_osc(self, record: dict) -> None:
        self._queue.put(("osc", record))

    def put_eeg(self, sample: EEGSample) -> None:
        self._queue.put(("eeg", sample.csv_row()))

    def put_marker(self, marker: Marker) -> None:
        self._queue.put(("marker", marker.model_dump()))

    def flush(self) -> None:
        self._queue.join()

    def close(self) -> None:
        self._queue.put(None)
        self._thread.join(timeout=5)

    def _run(self) -> None:
        paths = {kind: self.session_dir / name for kind, name in {"osc": "raw_osc.jsonl", "marker": "markers.jsonl"}.items()}
        handles = {kind: path.open("a", encoding="utf-8", newline="") for kind, path in paths.items()}
        eeg_handle = (self.session_dir / "raw_eeg.csv").open("a", encoding="utf-8", newline="")
        csv_writer = csv.DictWriter(eeg_handle, fieldnames=EEG_FIELDS)
        if eeg_handle.tell() == 0:
            csv_writer.writeheader()
        try:
            while True:
                item = self._queue.get()
                if item is None:
                    self._queue.task_done()
                    break
                kind, record = item
                if kind == "eeg":
                    csv_writer.writerow(record)
                else:
                    handles[kind].write(json.dumps(record, allow_nan=False) + "\n")
                self._queue.task_done()
                if self._queue.empty():
                    eeg_handle.flush()
                    for handle in handles.values():
                        handle.flush()
        finally:
            eeg_handle.flush()
            eeg_handle.close()
            for handle in handles.values():
                handle.flush()
                handle.close()


class SessionStore:
    def __init__(self, root: Path = config.DATA_DIR) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.session_id: str | None = None
        self.session_dir: Path | None = None
        self.writer: BufferedSessionWriter | None = None

    def create(self, participant_id: str, local_ipv4: str) -> dict:
        if self.writer:
            self.writer.close()
        self.session_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "_" + uuid4().hex[:8]
        self.session_dir = self.root / self.session_id
        self.session_dir.mkdir(parents=True)
        metadata = {
            "participant_id": participant_id,
            "session_id": self.session_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "local_ipv4": local_ipv4,
            "osc_port": config.OSC_PORT,
            "sampling_rate_hz": config.SAMPLING_RATE_HZ,
            "researcher_quality_override": False,
        }
        self.write_json("session_metadata.json", metadata)
        self.writer = BufferedSessionWriter(self.session_dir)
        return metadata

    def write_json(self, name: str, data: dict) -> None:
        if not self.session_dir:
            raise RuntimeError("No active session")
        (self.session_dir / name).write_text(json.dumps(data, indent=2, allow_nan=False), encoding="utf-8")

    def update_metadata(self, **updates: Any) -> None:
        if not self.session_dir:
            return
        path = self.session_dir / "session_metadata.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        data.update(updates)
        self.write_json("session_metadata.json", data)

    def list_sessions(self) -> list[dict]:
        records = []
        for path in sorted(self.root.glob("*/session_metadata.json"), reverse=True):
            try:
                records.append(json.loads(path.read_text(encoding="utf-8")))
            except (OSError, json.JSONDecodeError):
                continue
        return records

    def details(self, session_id: str) -> dict:
        target = (self.root / session_id).resolve()
        if target.parent != self.root.resolve() or not target.is_dir():
            raise FileNotFoundError(session_id)
        result: dict[str, Any] = {"session_id": session_id, "files": [path.name for path in target.iterdir()]}
        for name, key in (("session_metadata.json", "metadata"), ("calibration_record.json", "calibration_record"), ("calibration_profile.json", "profile"), ("quality_report.json", "quality")):
            path = target / name
            if path.exists():
                result[key] = json.loads(path.read_text(encoding="utf-8"))
        return result

    def archive(self, session_id: str) -> Path:
        target = (self.root / session_id).resolve()
        if target.parent != self.root.resolve() or not target.is_dir():
            raise FileNotFoundError(session_id)
        return Path(shutil.make_archive(str(target), "zip", target))

    def close(self) -> None:
        if self.writer:
            self.writer.close()
            self.writer = None
