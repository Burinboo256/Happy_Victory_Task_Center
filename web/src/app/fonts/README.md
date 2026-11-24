# Bundled web fonts

DM Sans and Noto Sans Thai are served by `next/font/local`. No Google Fonts CSS or font request is needed at build time or in the visitor's browser.

Sources downloaded on 2026-11-24 from the Google Fonts repository:

- [DM Sans variable font](https://github.com/google/fonts/blob/main/ofl/dmsans/DMSans%5Bopsz%2Cwght%5D.ttf), with `dm-sans-OFL.txt`.
- [Noto Sans Thai variable font](https://github.com/google/fonts/blob/main/ofl/notosansthai/NotoSansThai%5Bwdth%2Cwght%5D.ttf), with `noto-sans-thai-OFL.txt`.

Converted to WOFF2 using fontTools 4.68.0 and Brotli 1.2.1, without subsetting or changing glyphs/names. The source and output character maps were compared, including Thai consonants, vowels, and tone marks. Keep the accompanying SIL Open Font License notices when redistributing these files.

| File | Bytes | SHA-256 |
| --- | --- | --- |
| dm-sans.woff2 | 88,916 | `f24754d824e01fc871578acbe857242075a16c3fa83032cbb964eae0524c6327` |
| noto-sans-thai.woff2 | 108,004 | `21c47a6773bb47fad17c7b222486242e14bd3cc49b10293b96c26810a5c5e732` |

To refresh, download the official font and its license, convert with `TTFont(path)` / `font.flavor = 'woff2'` / `font.save(output)`, then update this provenance and hashes. Check Thai/Latin rendering and the browser font-loading regression before release. Conversion tools are build-maintenance tools, not runtime dependencies.
