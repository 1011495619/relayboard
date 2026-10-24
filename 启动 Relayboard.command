#!/bin/zsh
set -e
cd -- "$(dirname -- "$0")"
node -e 'if(Number(process.versions.node.split(".")[0]) < 24){console.error("Relayboard 需要 Node.js 24 或更高版本。");process.exit(1)}'
if [[ ! -d node_modules ]]; then
  npm ci
fi
if [[ ! -f dist/index.html || ! -f lib/bin/relayboard.js ]]; then
  npm run build
fi
export RELAYBOARD_OPEN=1
npm start
