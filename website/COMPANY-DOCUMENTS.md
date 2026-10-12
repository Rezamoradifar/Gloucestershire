# Company registration and operating licence images

The `#company-documents` section appears below the FAQ and has a link in the footer. The default configuration intentionally has no document images: neither a registration certificate nor an operating licence was supplied for this release. The pending state does not claim registration, authorisation or an application in progress.

To publish a supplied document:

1. Place its actual image in `website/public/documents/`. Use a legible PNG, JPEG or WebP; preserve the complete page rather than cropping its contents. An original PDF can be included alongside its image preview.
2. Edit the corresponding `document` field in `website/src/companyDocuments.ts`. Set `image` to its public path, `imageAlt` to an accurate description, and `original` to the original file when different from the image. Optional `issuer`, `reference` and `verificationUrl` must come from the document and its issuing authority.
3. Rebuild and publish. The card supports image enlargement, Escape/close controls, an original-file link and an optional issuer-record link. Failed image loads show an explicit unavailable state.

Publish only the intended public copy. Do not add decorative seals, invented reference numbers, sample certificates or another company's records. Registration documentation must not be relabelled as an operating or financial licence. Reconcile the existing company-status text in the terms only when supported by the actual documents.
