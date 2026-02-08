# Create Stripe Integration and debit account

## Context

Customers are needed to prepay campaigns, so we need to implement a stripe integration and handle it's usage in an internal debit account. It's posible that the ad servers don't always spend all the budget, so there can be differences, and they should be managed. 

## Requirements

- Create a special section to view all account movements, the can also add funds in this page with a modal
- In create campaign summary they need to add balances if they don't enough
- All account movement should be in a transaction 