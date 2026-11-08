# Security

## Reporting a problem

Please **don't** open a public issue for security problems. Report them privately instead:
[open a security advisory](https://github.com/cococolacake/lore-studio/security/advisories/new) on GitHub.

Include what you found, how to reproduce it, and which version you're on (Settings → About).
I'll reply as soon as I can, and credit you in the fix if you'd like.

## What Lore Studio keeps where

- **API keys, tokens and passwords** (Anthropic, a local model server, Hugging Face, OBS) are stored only in
  Lore Studio's settings on your computer, never in your campaign folder, and never shown back in the app.
- **Discord webhooks** are stored in the campaign's settings, since they belong to that campaign's server.
  Anyone with a webhook URL can post to that channel, so don't share a campaign folder publicly without removing them.
- **The app** listens only on your own computer (127.0.0.1). The Foundry bridge talks to it there,
  with a token that Lore Studio makes for you.
- **The player lore book** is a folder of static files with GM-only content removed before it's written.
  Check it before you put it online, since anything not marked GM-only is included.

## Supported versions

Only the latest release gets fixes during the beta.
