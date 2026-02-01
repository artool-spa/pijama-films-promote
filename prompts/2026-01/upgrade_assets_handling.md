# Upgrade Asset handling

## Context

Meta has several assets restrictions (prompts/2026-01/extra/media_reference.md), and we can create a campaign with wrongs ads, also in MUVI we don't have metinformation, and because the assets re not ready in start up it should have state so the user in font end knows whats happening.

## Requirements

- Add meta description, you may need to check the file  
- Add state to image and videos table: create sensible states names: like VALIDATING, READY
- Add meta state, check states for videos and how its handled, if an asset should work for IG and FB
- User in front should see a state in their assets