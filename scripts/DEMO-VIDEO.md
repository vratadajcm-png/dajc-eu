# English public demo walkthrough

`/demo-guide` embeds `/media/dajc-demo-en.mp4` with an English AAC narration track and `/media/dajc-demo-en.vtt` English captions. Play with sound unmutes and starts the player after a user click. Four chapter buttons seek and play; a full transcript remains available.

Narration source: `scripts/demo-narration.en.json`. Timed chapters: `src/data/demo-chapters.en.json`. Screenshots show synthetic data in the public demo, October 2026. No internal Platform or Integration Ecosystem content is included.

Speech: Piper en_US-ljspeech-high, LJ Speech dataset (public domain per model card):
https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/ljspeech/high/MODEL_CARD

Czech companion: https://www.dajc.cz/demo (Czech voice and captions).

Private prefixes redirect at the hosting layer before page routing. The SSR fallback redirects mistyped HTML page requests to `/`; missing APIs and assets keep their error status. Redirects never authorize access to private content.
