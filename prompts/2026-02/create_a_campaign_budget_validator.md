# Create a campaign budget validator

## Context

Google ads and meta have restriction for a minimun daily budget equivalent. These are not taking into account when creating a campaign. Also because whe are running with dynamic ads in meta it can only be 1 adset for the combination of language and asset type.

## Requirements

- Create a validator in campaign create
- Asume that for meta always it should have an image and video
- Display a sensible error message in **english** when the requirements are not meeted and don't allow to continue in campaign creation
- It should taking into account languages and platforms (meta is 1 for IG and Facebook)
- Use oficial information of the platforms.