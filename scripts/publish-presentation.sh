#!/usr/bin/env bash
# Publishes ONLY the presentation/ folder as a public GitHub Pages site under YOUR OWN account.
# Use this when you cannot switch on Pages for the shared repo. It needs the GitHub CLI (gh),
# logged in with `gh auth login`. Nothing else from this repo is uploaded (no .env, no code).
#
#   bash scripts/publish-presentation.sh [repo-name]
set -euo pipefail

REPO_NAME="${1:-selkea-presentation}"
cd "$(dirname "$0")/.."
command -v gh >/dev/null || { echo "Install the GitHub CLI first: https://cli.github.com"; exit 1; }
OWNER="$(gh api user --jq .login)"

echo "This creates a PUBLIC repo ${OWNER}/${REPO_NAME} that contains only the presentation/ folder,"
echo "and turns on GitHub Pages for it."
if [[ "${PUBLISH_YES:-}" != "1" ]]; then
  read -r -p "Continue? [y/N] " yn
  [[ "$yn" == [yY]* ]] || { echo "Cancelled."; exit 1; }
fi

tmp="$(mktemp -d)"
cp -R presentation/. "$tmp"
rm -f "$tmp/.DS_Store"
cd "$tmp"
git init -q -b main
git add .
git commit -q -m "Selkeä presentation"
gh repo create "${OWNER}/${REPO_NAME}" --public --source=. --push \
  --description "Selkeä presentation, LUMI AI Factory Open Weight LLM Hackathon"
gh api -X POST "repos/${OWNER}/${REPO_NAME}/pages" -f "source[branch]=main" -f "source[path]=/" >/dev/null

echo
echo "Done. It goes live in about a minute at"
echo "  https://${OWNER}.github.io/${REPO_NAME}/"
