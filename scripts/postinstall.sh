#!/usr/bin/env bash
patch -s node_modules/commander/index.js < patches/commander.patch
patch -s node_modules/bitcore-p2p/node_modules/buffers/index.js < patches/buffers.patch
patch -s node_modules/throbber/index.js < patches/throbber.patch
patch -s node_modules/migrate-orm2/index.js < patches/migrate-orm2.patch
patch -s node_modules/bitcore/lib/crypto/point.js < patches/bitcore-crypto-point.patch
patch -s node_modules/orm/lib/Utilities.js < patches/orm-utilities.patch
