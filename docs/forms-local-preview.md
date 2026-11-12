# Local document library preview

Run from `web/` with Node.js 24:

```powershell
npm.cmd run preview:forms
```

Open <http://127.0.0.1:3011/local/forms>. This standalone preview does not change the production navigation or connect to Airtable, Neon, LINE, or authentication services.

## Try the workflow

1. Search the 43 life-insurance entries from the Allianz download page (snapshot: 13 November 2026), or filter by the four source categories. Results use ten entries per page; search covers all pages.
2. In the Admin view, add a document or add a revision to an existing document.
3. Select an official Allianz link or a local PDF (maximum 15 MB).
4. Save a draft, review its details, acknowledge the review, and publish it.
5. Switch to Agent or Secretary: only published documents and the current revision are shown.
6. Return to Admin to inspect revision history.
7. Star frequently used documents and open the “ใช้บ่อย” tab. Favorites store only document IDs in this browser's local storage and survive reload. The preview role switch shares these favorites; production account synchronization is not implemented.

## Preview boundaries

- Document changes and selected PDF files stay in browser memory. Reloading restores the catalogue; no documents are uploaded or persisted. Favorites are the only preference saved locally.
- Official links open the source PDF in a new tab. Saving a linked file depends on the browser's PDF viewer.
- Sample revision labels describe this registry, not official company version numbers. Verify the source before using a form for real work.
- The catalogue includes 22 general forms, 14 Unit Linked documents, two underwriting questionnaires, and five FATCA/CRS forms. It excludes the separate non-life and former Aetna sections. Three linked PDFs could not be fetched by the research tool and are marked for link review; this does not establish that their links are broken.
- Previous external links are not immutable file archives. Automatic update detection and permanent file storage are not implemented.
- Role switching demonstrates the proposed interface; it is not production authorization.
- The route requires development mode, the preview flag, and a localhost host. Production builds return 404, even with the flag enabled.
- The launcher listens only on this computer. Mobile and tablet layouts can be previewed through browser device emulation.

Stop the local server with Ctrl+C. No deployment is required.
