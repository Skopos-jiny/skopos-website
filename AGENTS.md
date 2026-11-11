# SKOPOS deployment handoff

The user requires Google Drive synchronization after every deployment or material update.

- Shared folder: https://drive.google.com/drive/folders/1GmnRJ98ZLI-ZWj06EWJjWHJxni1xjZaL
- After verifying an authorized deployment, create or update a dated handoff document in that folder. Include the actual production commit SHA, deployment status, changed behavior, validation and limitations, service links, and remaining work for Claude.
- Identify unshipped local changes as drafts; never label a merged commit as deployed without deployment evidence.
- Use the full production commit SHA as the synchronization key. Search existing handoff records before creating another record. Preserve other authors' content and the folder's sharing settings.
- Never include access tokens, service keys, payment credentials, active coupon codes, customer names or contact details in the handoff.
- Verify the Drive document and folder placement before reporting synchronization complete. If Drive access fails, save the handoff locally and report the unsynchronized state.
- A Drive handoff does not automatically update Claude's private project knowledge. Report that distinction honestly.
- This instruction does not authorize unrelated changes or automatic deployment by the periodic synchronization task.
