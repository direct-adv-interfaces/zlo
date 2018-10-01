#!/usr/bin/env bash
set -e
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ROOT="$DIR/.."
rm -rf "$ROOT/debian" || true
cp -R $ROOT/node_modules usr/node_modules
