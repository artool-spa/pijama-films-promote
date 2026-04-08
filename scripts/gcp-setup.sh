#!/bin/bash
# One-time GCP infrastructure setup for Pijama Films
#
# Usage: yarn deploy:gcp-setup
#
# Prerequisites:
#   - gcloud CLI installed and authenticated (run: gcloud auth login)
#   - A GCP project created (set GCP_PROJECT below or pass as env var)

set -euo pipefail

# Configuration -- edit these values
GCP_PROJECT="${GCP_PROJECT:-pijama-films}"
GCP_REGION="${GCP_REGION:-us-west1}"
GCP_ZONE="${GCP_ZONE:-${GCP_REGION}-a}"
DB_INSTANCE="pijama-db"
DB_NAME="pijama_films"
DB_USER="pijama"
REPO_NAME="pijama-films"
VM_NAME="pijama-gateway"

echo "═══════════════════════════════════════════════════════════════"
echo "  Pijama Films - GCP Infrastructure Setup"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Project:  $GCP_PROJECT"
echo "  Region:   $GCP_REGION"
echo ""

# Set project
gcloud config set project "$GCP_PROJECT"

# Step 1: Enable required APIs
echo "1. Enabling APIs..."
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com \
  compute.googleapis.com
echo "   Done."

# Step 2: Create Artifact Registry repository
echo ""
echo "2. Creating Artifact Registry repository..."
if gcloud artifacts repositories describe "$REPO_NAME" --location="$GCP_REGION" &>/dev/null; then
  echo "   Repository '$REPO_NAME' already exists, skipping."
else
  gcloud artifacts repositories create "$REPO_NAME" \
    --repository-format=docker \
    --location="$GCP_REGION" \
    --description="Pijama Films Docker images"
  echo "   Created repository '$REPO_NAME'."
fi

# Step 3: Configure Docker authentication
echo ""
echo "3. Configuring Docker for Artifact Registry..."
gcloud auth configure-docker "${GCP_REGION}-docker.pkg.dev" --quiet
echo "   Done."

# Step 4: Create Cloud SQL instance
echo ""
echo "4. Creating Cloud SQL instance..."
if gcloud sql instances describe "$DB_INSTANCE" &>/dev/null; then
  echo "   Instance '$DB_INSTANCE' already exists, skipping."
else
  echo "   This may take a few minutes..."
  gcloud sql instances create "$DB_INSTANCE" \
    --database-version=POSTGRES_16 \
    --edition=enterprise \
    --tier=db-f1-micro \
    --region="$GCP_REGION" \
    --storage-size=10GB \
    --storage-auto-increase
  echo "   Created instance '$DB_INSTANCE'."
fi

# Step 5: Create database
echo ""
echo "5. Creating database..."
if gcloud sql databases describe "$DB_NAME" --instance="$DB_INSTANCE" &>/dev/null; then
  echo "   Database '$DB_NAME' already exists, skipping."
else
  gcloud sql databases create "$DB_NAME" --instance="$DB_INSTANCE"
  echo "   Created database '$DB_NAME'."
fi

# Step 6: Create database user
echo ""
echo "6. Creating database user..."
DB_PASSWORD=$(openssl rand -base64 24)
if gcloud sql users list --instance="$DB_INSTANCE" --format="value(name)" | grep -q "^${DB_USER}$"; then
  echo "   User '$DB_USER' already exists, skipping."
  echo "   To reset password: gcloud sql users set-password $DB_USER --instance=$DB_INSTANCE --password=NEW_PASSWORD"
else
  gcloud sql users create "$DB_USER" \
    --instance="$DB_INSTANCE" \
    --password="$DB_PASSWORD"
  echo "   Created user '$DB_USER'."
  echo ""
  echo "   ╔══════════════════════════════════════════════════════════╗"
  echo "   ║  SAVE THIS PASSWORD - it won't be shown again!         ║"
  echo "   ║  DB_PASSWORD=$DB_PASSWORD"
  echo "   ╚══════════════════════════════════════════════════════════╝"
fi

# Step 7: Reserve static IP for gateway VM
echo ""
echo "7. Reserving static IP for gateway VM..."
if gcloud compute addresses describe "${VM_NAME}-ip" --region="$GCP_REGION" &>/dev/null; then
  echo "   Static IP '${VM_NAME}-ip' already exists, skipping."
else
  gcloud compute addresses create "${VM_NAME}-ip" --region="$GCP_REGION"
  echo "   Reserved static IP."
fi
VM_IP=$(gcloud compute addresses describe "${VM_NAME}-ip" --region="$GCP_REGION" --format="value(address)")
echo "   IP: $VM_IP"

# Step 8: Create firewall rules for HTTP/HTTPS
echo ""
echo "8. Creating firewall rules..."
if gcloud compute firewall-rules describe allow-gateway-http --project="$GCP_PROJECT" &>/dev/null; then
  echo "   Firewall rules already exist, skipping."
else
  gcloud compute firewall-rules create allow-gateway-http \
    --project="$GCP_PROJECT" \
    --allow=tcp:80,tcp:443 \
    --target-tags=gateway \
    --source-ranges=0.0.0.0/0
  echo "   Created firewall rule for HTTP/HTTPS."
fi

# Step 9: Create gateway VM (Caddy + Mercure)
echo ""
echo "9. Creating gateway VM..."
if gcloud compute instances describe "$VM_NAME" --zone="$GCP_ZONE" &>/dev/null; then
  echo "   VM '$VM_NAME' already exists, skipping."
else
  # Startup script installs Docker and Caddy
  cat > /tmp/gateway-startup.sh << 'STARTUP_EOF'
#!/bin/bash
set -e

# Install Docker
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
fi

# Install Caddy
if ! command -v caddy &>/dev/null; then
  apt-get update
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
  systemctl enable caddy
fi

echo "Gateway VM startup complete."
STARTUP_EOF

  gcloud compute instances create "$VM_NAME" \
    --zone="$GCP_ZONE" \
    --project="$GCP_PROJECT" \
    --machine-type=e2-micro \
    --image-family=debian-12 \
    --image-project=debian-cloud \
    --boot-disk-size=10GB \
    --tags=gateway \
    --address="$VM_IP" \
    --metadata-from-file=startup-script=/tmp/gateway-startup.sh \
    --scopes=cloud-platform

  rm -f /tmp/gateway-startup.sh
  echo "   Created VM '$VM_NAME'."
fi

# Summary
INSTANCE_CONNECTION=$(gcloud sql instances describe "$DB_INSTANCE" --format="value(connectionName)" 2>/dev/null || echo "$GCP_PROJECT:$GCP_REGION:$DB_INSTANCE")

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Setup Complete!"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Artifact Registry: ${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT}/${REPO_NAME}"
echo "  Cloud SQL:         $INSTANCE_CONNECTION"
echo "  Database:          $DB_NAME"
echo "  User:              $DB_USER"
echo "  Gateway VM:        $VM_NAME ($VM_IP)"
echo ""
echo "  DATABASE_URL for Cloud Run:"
echo "  postgresql://${DB_USER}:<PASSWORD>@/${DB_NAME}?host=/cloudsql/${INSTANCE_CONNECTION}"
echo ""
echo "  Next steps:"
echo "    1. Add DNS A record: promote.pijamafilms.com -> $VM_IP"
echo "    2. Save the DATABASE_URL (with real password) in your .env"
echo "    3. Run: yarn deploy:cloudrun:secrets    (push secrets to GCP)"
echo "    4. Run: yarn deploy:cloudrun            (deploy the app)"
echo "    5. Run: yarn deploy:cloudrun:mercure    (deploy Caddy + Mercure on VM)"
echo ""
