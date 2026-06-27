#!/bin/bash

REPO_NAME=$(basename $(pwd))
GITHUB_USER="hoopstreet"

echo "Setting up branch protection rules for $REPO_NAME..."

# Enable branch protection for main branch
gh api -X PUT repos/$GITHUB_USER/$REPO_NAME/branches/main/protection   --field required_status_checks='{"strict":true,"contexts":["continuous-integration","security-scan"]}'   --field enforce_admins=true   --field required_pull_request_reviews='{"required_approving_review_count":1,"dismiss_stale_reviews":true,"require_code_owner_reviews":true}'   --field restrictions=null   --field required_linear_history=true   --field allow_force_pushes=false   --field allow_deletions=false

echo "Branch protection rules applied successfully!"
