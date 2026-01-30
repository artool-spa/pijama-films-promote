#!/bin/bash

# This hook tracks file edits and runs TypeScript checks
# It runs on PostToolUse events

# Get the tool that was used
TOOL_NAME="${CLAUDE_TOOL_NAME:-}"

# Only track Edit and Write tools
if [ "$TOOL_NAME" != "Edit" ] && [ "$TOOL_NAME" != "Write" ]; then
    exit 0
fi

# Get the file that was edited
FILE_PATH="${CLAUDE_FILE_PATH:-}"

# Only track TypeScript/JavaScript files
if [[ ! "$FILE_PATH" =~ \.(ts|tsx|js|jsx)$ ]]; then
    exit 0
fi

echo "📝 File modified: $FILE_PATH"
echo "💡 Remember to run 'yarn lint' and 'yarn build' to check for errors"

exit 0
