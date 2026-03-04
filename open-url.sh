#!/bin/bash
# Helper script: routes browser opens from CLI tools (gt, gh, etc.) to the CEO Dashboard in-app browser.
# Set as BROWSER env var in the embedded terminal.
curl -s -X POST http://localhost:9145/api/open-url \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"$1\"}" > /dev/null 2>&1
