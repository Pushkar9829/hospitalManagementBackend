# Print fonts

Hindi bills, receipts and other PDFs need a Devanagari font. Put these two files here:

- `NotoSansDevanagari-Regular.ttf`
- `NotoSansDevanagari-Bold.ttf`

Noto Sans Devanagari is free under the SIL Open Font License 1.1, so it can be shipped with the
app. Keep its `OFL.txt` next to the files.

Without the files, documents asked for in Hindi print in English. For a quick check on Windows
you can point the server at the system font instead (not for production):

```
PDF_DEVANAGARI_FONT=C:/Windows/Fonts/Nirmala.ttc#NirmalaUI
PDF_DEVANAGARI_FONT_BOLD=C:/Windows/Fonts/Nirmala.ttc#NirmalaUI-Bold
```
