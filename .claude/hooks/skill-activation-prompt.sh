#!/bin/bash

# This hook analyzes user prompts and suggests relevant skills
# It runs on UserPromptSubmit events

# Read the prompt from stdin or environment
PROMPT="${CLAUDE_PROMPT:-}"

# Define skill triggers based on keywords and context
suggest_skill() {
    local skill_name="$1"
    local trigger_keywords="$2"

    for keyword in $trigger_keywords; do
        if echo "$PROMPT" | grep -iq "$keyword"; then
            echo "💡 Consider using the '$skill_name' skill for this task"
            return 0
        fi
    done
    return 1
}

# Check for backend-related tasks
suggest_skill "backend-dev-guidelines" "model prisma database api route server"

# Check for frontend-related tasks
suggest_skill "frontend-dev-guidelines" "component mui client page layout theme"

# Check for film platform-related tasks
suggest_skill "film-platform-guidelines" "film campaign producer metric analytics"

# Check for database-related tasks
suggest_skill "database-guidelines" "schema migration query transaction"

# Check for testing-related tasks
suggest_skill "testing-guidelines" "test vitest coverage mock"

exit 0
