#!/bin/bash

# Exit on error
set -e

echo "🔨 Building metis-db..."
bun run build

TARGET_DIR="/usr/local/bin"
TARGET_FILE="$TARGET_DIR/metis-db"

echo "📦 Installing to $TARGET_FILE..."

# Check if we need sudo
if [ -w "$TARGET_DIR" ]; then
    cp ./metis-db "$TARGET_FILE"
else
    echo "🔒 Root privileges required to write to $TARGET_DIR"
    sudo cp ./metis-db "$TARGET_FILE"
fi

echo "✅ Done! You can now run 'metis-db' from anywhere."
