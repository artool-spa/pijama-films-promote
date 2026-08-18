# ghcr.io/paparga/pijama-proxy
#
# Reconstructed from the published image, which had no source anywhere: it was
# nginx:alpine plus this one config file. Keeping it here means the next change
# is a diff rather than an archaeology exercise.
#
# Build and publish:
#   docker build -t ghcr.io/paparga/pijama-proxy:latest proxy/
#   docker push ghcr.io/paparga/pijama-proxy:latest
#
# Coolify pulls this tag, so a push reaches production as soon as the service
# is redeployed.

FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000
