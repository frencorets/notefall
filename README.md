# Notefall

A free, open-source play-along rhythm game that **listens**. Notes fall down five lanes; you play them on your instrument and Notefall hears the pitch through the microphone and scores your timing.

Any melodic instrument works: a real ocarina, a recorder, a tin whistle, whistling or humming, or a wind instrument inside a video game played through your TV speakers.

**Play it:** `https://frencorets.github.io/notefall/`

## Features

- **Guided first-time setup**: allow the microphone, press each button once to check Notefall hears it, and a quick timing check.
- **Four short lessons** that teach the five buttons, D-pad bends, stick bends and both together. Lessons wait for you on every note.
- **Notes show the real input**: the button letter plus a drawn D-pad (lit arm) or stick (ringed arrow). Yellow means up, blue means down. A "Next" bar spells out the coming input in plain words.
- Real-time pitch detection (YIN) in the browser. No install, no account, works on phones.
- Perfect / Great / Good timing, streaks, stars, and a hold bonus for long notes.
- Practice tools: Slow / Relaxed / Normal speed and practice mode, where the song waits for you.
- **English and Spanish**, chosen automatically from the device language (changeable in Settings).
- Labels for a 5-button controller, or plain note names for a real ocarina, recorder or voice.
- A library of public-domain melodies and original songs.
- **Song editor**: record a phrase by playing it, or tap notes into a piano roll. Export/import `.json` files or share a song as a link (the song is stored inside the URL, so nothing is uploaded).

## Privacy

Audio is analysed on your device in real time. Nothing is recorded, stored or sent anywhere. Settings, best scores and your songs live in your browser's local storage. The site makes no third-party requests (no analytics, fonts or CDNs).

## Publish on GitHub Pages

1. Create a new public repository (for example `notefall`) and upload all files in this folder, keeping the structure.
2. Edit `js/config.js` and `.github/FUNDING.yml` with your Buy Me a Coffee username and repository URL.
3. In the repository: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
4. After a minute the game is live at `https://frencorets.github.io/notefall/`.

The microphone only works on `https` or `localhost`, which GitHub Pages provides.

### Run locally

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` directly from disk will not work (browsers block the microphone and module loading on `file://`).

## Song file format

```json
{
  "format": "notefall-song-1",
  "title": "My Song",
  "composer": "Me",
  "license": "original",
  "bpm": 100,
  "beatsPerBar": 4,
  "notes": [[0, 1, "D5"], [1, 1, "F5"], [2, 2, "A5"]]
}
```

Each note is `[start beat, length in beats, pitch]`. The playable range is B4–F6 (19 pitches); notes outside it are folded into it by octave.

## Controller hint mapping

The 5-button profile follows the remake's default layout: L = D5, R = F5, A = A5, Y = B5, X = D6 (sounding pitch). The D-pad bends a note by a half step and the left stick by a whole step; holding both gives three half steps. That makes 19 pitches, B4 to F6. Each note on the highway shows the easiest input: fewest buttons, with the D-pad preferred over the stick. Hold the bend first, then press the note button. Bends only work when playing freely; the game itself recognises songs from the five natural notes.

Badges: ♯ = D-pad up, ♭ = D-pad down, ↑ = stick up, ↓ = stick down, ♯↑ / ♭↓ = both together. To change the mapping, edit `PROFILES` in `js/theory.js`. Scoring is unaffected because it only listens to pitch.

Thanks to the community note chart at github.com/diacoviello/LoZ-Ocarina-Note-Charts, which this mapping was checked against.

## Contributing songs

See [CONTRIBUTING.md](CONTRIBUTING.md). Only public-domain melodies and original compositions are accepted into the built-in library.

## Legal

Notefall is an independent fan-made tool. It is not affiliated with, endorsed by or sponsored by Nintendo or any other game company. It contains no third-party game code, assets, music, characters or logos. All trademarks belong to their respective owners.

Code: [MIT](LICENSE). Song transcriptions and original songs in `songs/`: [CC0 1.0](songs/LICENSE). See [NOTICE.md](NOTICE.md) for song sources.

## Support

If you enjoy Notefall, you can [buy me a coffee](https://buymeacoffee.com/YOUR_USERNAME). Donations are voluntary and don't unlock anything.
