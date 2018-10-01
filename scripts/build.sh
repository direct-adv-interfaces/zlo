#!/usr/bin/env bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ROOT="$DIR/.."
rm -rf "$ROOT/debian"
cp -R $ROOT/node_modules usr/node_modules
