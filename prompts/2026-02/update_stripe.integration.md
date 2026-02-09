# Update Stripe integration

## Context

Stripe has a Fee that it's not currently handled, if the customer deposit 100 USD it will have less for campaigns. We don't know the current fee upfront, so charge wthe worst case

## Goals

- Take into account fees, calculate them and add them
- Add that information in the 2 modals
- Fix UX, the buttons are wirdly separed
- Check real fee if it less add it to account

## Strapi fees

2.9% + 30¢
per successful transaction for domestic cards
+ 0.5% for manually entered cards
+ 1.5% for international cards
+ 1% if currency conversion is required