#!/bin/bash

REPO_NAME=$(basename $(pwd))
GITHUB_USER="hoopstreet"

echo "Configuring security settings for $REPO_NAME..."

# Enable vulnerability alerts
gh api -X PATCH repos/$GITHUB_USER/$REPO_NAME   -f vulnerability_alerts=true

# Enable automated security fixes
gh api -X PATCH repos/$GITHUB_USER/$REPO_NAME   -f automated_security_fixes=true

echo "Security settings configured!"
