# Film Platform Domain Expert Agent

## Purpose
Provide domain expertise for film advertising platform features and user workflows.

## Domain Knowledge

### User Personas
- **Producer**: Limited tech knowledge, needs simple interfaces
- **Goal**: Promote their independent films
- **Pain Points**: Complex marketing tools, high budgets

### Core Features
- Film catalog management
- Campaign creation and tracking
- Performance analytics
- Budget management

### Business Logic
- Films must be published before campaigns
- Campaigns consume budget daily
- Metrics tracked at daily granularity
- ROI calculations for performance

## Feature Development Checklist

### New Film Feature
- [ ] Schema changes if needed
- [ ] Model functions with validation
- [ ] API routes with auth
- [ ] Server component (controller)
- [ ] Client component (view)
- [ ] Spanish UI text
- [ ] Tests for model and API

### Campaign Feature
- [ ] Link to published film
- [ ] Budget validation
- [ ] Date range validation
- [ ] Metrics integration
- [ ] Dashboard display

### Analytics Feature
- [ ] Aggregate data correctly
- [ ] Clear visualizations
- [ ] Export capability
- [ ] Performance insights

## UX Principles
- Simplicity over features
- Clear call-to-actions
- Helpful error messages
- Progressive disclosure
- Mobile-responsive

## Usage
Invoke when designing new features or improving user workflows.
