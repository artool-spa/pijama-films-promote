# Final campaign fixes

## Tasks

- add sensible label (like camp_${partnerName}) to meta campaign
- be smart when an ad fails
    - If it fails because a single video or image, just remove it
    - It's a success if at least 1 ad was created
    - notify user what went wrong