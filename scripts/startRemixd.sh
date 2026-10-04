#!/bin/sh

set -e

echo "Checking npm..."

if command -v npm >/dev/null 2>&1; then
    echo "npm is already installed:"
    npm --version
else
    echo "npm is not installed. Installing Node.js and npm..."

    sudo apt update
    sudo apt install -y nodejs npm

    echo "npm installed:"
    npm --version

    echo "Installing/updating remixd..."

    sudo npm install -g @remix-project/remixd
fi

echo "Starting remixd..."
cd ..
sudo remixd -s ./ --remix-ide https://app.remix.live
