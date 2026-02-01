# Multiple Front Fixes

## Context

In new campaign src/app/(dashboard)/films/[id]/campaigns/new/client.tsx

## Tasks

- In tab schedule
    - Always start Instagram checked
    - Hide momentary LGBT option
    - Validate that end_date > start_date
    - Don't let go next if it not ready
- In tab copies
    - At start automatically generate copies
- In review
    - Hide reels
    - Sometimes Meta is too slow to load iframe, something we can do about?
- Create summary tab
    - It should show a loading bar when promoting, get progress by SSE
- You can edit campaign name 

