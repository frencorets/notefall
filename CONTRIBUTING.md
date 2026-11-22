# Contributing

Bug fixes, features and new songs are welcome.

## Song submissions — read this first

The built-in library must stay free of copyrighted music. A pull request adding a song is only accepted if the melody is:

1. **Public domain** — the composer died long ago and the tune was published before the cutoff that applies (in practice: traditional folk tunes, hymns and classical melodies from before 1900). Transcribe it from the original tune yourself; modern arrangements can be copyrighted even when the tune is not. Include a source (composer, year, original title).
2. **Your own original composition**, which you agree to release under CC0.

Please do **not** submit:

- Music from video games, films, TV, anime or pop songs, however short — including "simplified" or "by ear" transcriptions.
- Anything you are not sure about. When in doubt, leave it out.

Pull requests that add game soundtracks or other copyrighted melodies will be closed.

Players are free to make any song for their own use in the editor; those songs stay on their device.

## Code

- No build step. Plain ES modules in `js/`.
- Keep the app free of third-party requests (no CDNs, fonts or analytics).
- Do not add third-party game assets, names or logos.
