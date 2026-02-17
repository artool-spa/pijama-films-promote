# Create campaign ads async when needed

## Context

There some assets that need preprocessing like Meta video ads, right now if you want to use some videos you need to wait to be ready. Becuase the ads are accepted async it can be waiting in background.

## Requirements

- Create an endpoint to have a cronjob init
- Give the correct information to user **always** in english
- make changes to database as needed

