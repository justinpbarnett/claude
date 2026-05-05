# notifications

Turn-complete notifications for pi.

## Slash commands

- `/notifications status`
- `/notifications on|off|toggle`
- `/notifications desktop on|off|toggle`
- `/notifications audio on|off|toggle`
- `/notifications test`
- `/notifications config` writes/prints the config path
- `/notifications reload` reloads config from disk

## Config

Config lives at `~/.pi/agent/notifications.json`:

```json
{
  "enabled": true,
  "desktop": {
    "enabled": true,
    "title": "pi",
    "message": "Turn complete",
    "includeResponsePreview": true,
    "responseWordCount": 8
  },
  "audio": {
    "enabled": false,
    "sound": "Glass"
  }
}
```

macOS uses `osascript` for desktop notifications and `afplay` with `/System/Library/Sounds/<sound>.aiff` for audio. Linux uses `notify-send` and `paplay` when available.
