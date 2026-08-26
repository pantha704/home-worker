# Bundled handwriting fonts

These fonts provide the three built-in Homeworker personas. They are bundled so the local-first path works offline and PDF exports can embed the exact glyph program used by the preview.

| Persona | Font | Source package | Version | License |
| --- | --- | --- | --- | --- |
| Scholar | Caveat Regular | `@fontsource/caveat` | 5.2.8 | SIL Open Font License 1.1 |
| Casual | Patrick Hand Regular | `@fontsource/patrick-hand` | 5.2.8 | SIL Open Font License 1.1 |
| Compact | Kalam Regular | `@fontsource/kalam` | 5.2.8 | SIL Open Font License 1.1 |

The `.woff2` files are the original Fontsource package assets. The `.ttf` files are losslessly decompressed versions for the server-side PDF renderer. The corresponding `OFL-*.txt` files are included unchanged.

Do not replace these files with fonts scraped from arbitrary font sites. Any new persona must include its source, version, redistribution license, character-set audit, and print test.

