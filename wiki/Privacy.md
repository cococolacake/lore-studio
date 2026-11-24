# Privacy

Lore Studio runs on your computer. There are no accounts, no tracking and no telemetry. It only goes online when you ask it to:

| What | When | Where it goes |
| --- | --- | --- |
| Transcripts, matching lore pages and recent recaps | You draft a recap, check for loose threads, suggest a scene or tags, or chat | **Claude:** Anthropic's API, under [Anthropic's commercial terms](https://www.anthropic.com/legal/commercial-terms). **A local model:** nowhere; it stays on your computer or network. **AI off:** nothing is sent. |
| Recordings | Never | Transcription runs on your own GPU or CPU. Speaker detection downloads its models from Hugging Face once. |
| A recap or handout | You press **Post** in the Discord preview | The Discord channel you picked |
| Pages, recaps and handouts | You press **Send to Foundry** | Your Foundry world, through the bridge on your own computer |
| Map and header images | You import from LegendKeeper or paste an image link | Downloaded from where they're hosted, once, into your campaign folder |
| The player lore book | You upload it yourself | Wherever you host it. GM-only content is removed first. |

API keys and passwords stay in Lore Studio's settings on your computer, never in your campaign folder. See [SECURITY.md](https://github.com/cococolacake/lore-studio/blob/main/SECURITY.md).
