from __future__ import annotations

import json
import subprocess
import urllib.request
from dataclasses import dataclass


@dataclass
class Notifier:
    desktop: bool = True
    webhook_url: str | None = None

    def send(self, title: str, message: str, event: str = "info") -> None:
        if self.desktop:
            self._notify_desktop(title, message)
        if self.webhook_url:
            self._notify_webhook(title, message, event)

    def _notify_desktop(self, title: str, message: str) -> None:
        try:
            subprocess.run(
                ["notify-send", "--app-name=harness", title, message],
                timeout=5,
                capture_output=True,
            )
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass

    def _notify_webhook(self, title: str, message: str, event: str) -> None:
        payload = json.dumps({
            "event": event,
            "title": title,
            "message": message,
        }).encode()
        req = urllib.request.Request(
            self.webhook_url,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            urllib.request.urlopen(req, timeout=10)
        except Exception:
            pass
