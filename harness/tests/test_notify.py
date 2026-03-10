from unittest.mock import patch, MagicMock

from harness.notify import Notifier


@patch("harness.notify.subprocess.run")
def test_desktop_notification(mock_run: MagicMock):
    n = Notifier(desktop=True)
    n.send("Title", "Message", "info")
    mock_run.assert_called_once()
    args = mock_run.call_args[0][0]
    assert args[0] == "notify-send"
    assert "Title" in args
    assert "Message" in args


@patch("harness.notify.subprocess.run")
def test_desktop_disabled(mock_run: MagicMock):
    n = Notifier(desktop=False)
    n.send("Title", "Message")
    mock_run.assert_not_called()


@patch("harness.notify.urllib.request.urlopen")
def test_webhook_notification(mock_urlopen: MagicMock):
    n = Notifier(desktop=False, webhook_url="https://example.com/hook")
    n.send("Title", "Message", "test_event")
    mock_urlopen.assert_called_once()
    req = mock_urlopen.call_args[0][0]
    assert req.full_url == "https://example.com/hook"
    assert req.method == "POST"


@patch("harness.notify.subprocess.run", side_effect=FileNotFoundError)
def test_desktop_graceful_failure(mock_run: MagicMock):
    n = Notifier(desktop=True)
    n.send("Title", "Message")  # Should not raise


@patch("harness.notify.urllib.request.urlopen", side_effect=Exception("network"))
def test_webhook_graceful_failure(mock_urlopen: MagicMock):
    n = Notifier(desktop=False, webhook_url="https://example.com/hook")
    n.send("Title", "Message")  # Should not raise
