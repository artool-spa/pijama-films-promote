# Create Muvi Service

## Documentation

https://developer.muvi.com/api


## Use Cases

- Get movies from a user with basic information
- Get details of a movies including its assets

## Scope

Only implement functions needed for use cases

## Design guidelines

- Should be a class singleton MuviTokenH
    - receives as parameters .env values if there are not valid throw an exception
    - should handle token refresh
    - should export the singleton already initializes
- Every function should receive MuviTokenH as parameter

## TASK

Read the documentation only focusing in use cases and generate a plan

