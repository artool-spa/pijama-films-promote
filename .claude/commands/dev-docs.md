# dev-docs

Create structured development documentation for the current work session.

## Purpose
Preserve project context, decisions, and progress across Claude Code sessions.

## Creates Three Files

### 1. dev/active/plan.md
Current implementation plan with:
- Feature overview
- Step-by-step tasks
- Dependencies and blockers
- Completion status

### 2. dev/active/context.md
Essential context including:
- Recent decisions made
- Architecture choices
- Key files modified
- Integration points
- Gotchas and learnings

### 3. dev/active/tasks.md
Task tracking with:
- Completed tasks
- In-progress tasks
- Blocked tasks
- Next steps

## Usage
Run `/dev-docs` at the start of significant feature work to establish documentation structure.

## Example Output

**plan.md:**
```markdown
# Feature: Campaign Analytics Dashboard

## Overview
Add analytics dashboard for campaign performance tracking.

## Tasks
1. [x] Create CampaignMetric model
2. [ ] Add metrics aggregation functions
3. [ ] Create analytics API route
4. [ ] Build dashboard UI component
```

**context.md:**
```markdown
# Campaign Analytics Context

## Decisions
- Metrics stored daily (not real-time)
- ROI calculated as (revenue - spend) / spend
- Dashboard shows last 30 days by default

## Key Files
- src/models/campaignMetric.ts
- src/app/api/analytics/route.ts
- src/app/dashboard/analytics/client.tsx
```
