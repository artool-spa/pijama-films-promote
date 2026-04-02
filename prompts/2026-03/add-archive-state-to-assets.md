# Add archive state

## Context 

Asset management have the issue that can be saturated very early, so is needed a way to "hide" from the main view, but with rollback, in another words implement archive state

## Requirement

- Database: Create Archive Status
- Models: create only 1 function idempotent for archive / unarchive 
- Routes: create API 2 endpoints for archive / unarchive
- Views: Create Archive tab only in media/asset management src/app/(dashboard)/films/[id]/assets
