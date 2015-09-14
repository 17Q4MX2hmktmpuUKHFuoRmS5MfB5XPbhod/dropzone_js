var bitcore = require('bitcore')
var p2p = require('bitcore-p2p')

var Throbber = require('throbber')

var Pool = p2p.Pool
var Messages = p2p.Messages
var Inventory = p2p.Inventory

var HASH_BUFFER = 2000

function Network (options) {
  if (!(this instanceof Network)) {
    return new Network(options)
  }

  options = options || {}

  if (!options.relay) {
    options.relay = true
  }

  if (!options.maxSize) {
    options.maxSize = 32
  }

  this.network = options.network
    ? bitcore.Networks[options.network.toString()]
    : bitcore.Networks.defaultNetwork

  this.messages = new Messages({
    network: this.network
  })

  this.pool = new Pool(options)
}

Network.prototype.getFilteredTxs = function (filter, next) {
  var network = this.network
  var messages = this.messages
  var pool = this.pool

  var tip = ({
    testnet: {
      hash: '00000000aac43d0734c8a9346b58ac0ce539c94853ed15cfa03a6f4d698ddaf3',
      height: 533832
    },
    livenet: {
      hash: '000000000000000013341e0afa2edda3e22dcc3974b711c8c4fb3170d35bb39d',
      height: 372184
    }
  })[network.name]

  if (arguments.length > 2) {
    if (next) {
      tip = next
    }
    next = arguments[2]
  }

  var FilterLoad = messages.FilterLoad
  var GetHeaders = messages.GetHeaders
  var GetData = messages.GetData

  var InventoryForFilteredBlock = Inventory.forFilteredBlock

  var loaderPeer

  var txs = []

  var cached = {
    tx: { col: [], hashes: [] },
    block: { col: [], hashes: [] }
  }

  var pushBlock = function (block) {
    for (var t = 0, tl = cached.tx.col.length; t < tl; t++) {
      if (block.hasTransaction(cached.tx.col[t])) {
        cached.tx.col[t].block = {
          hash: block.header.hash,
          height: tip.height -
            (cached.block.hashes.length -
            cached.block.hashes.indexOf(block.header.hash) - 1)
        }
        txs.push(cached.tx.col.splice(t, 1)[0])
        return
      }
    }
    if (cached.block.col.length > HASH_BUFFER) {
      cached.block.col.shift()
    }
    cached.block.col.push(block)
  }

  var pushTx = function (tx) {
    var col = cached.tx.col
    for (var b = 0, bl = cached.block.col.length; b < bl; b++) {
      if (cached.block.col[b].hasTransaction(tx)) {
        var hash = cached.block.col[b].header.hash
        tx.block = {
          hash: hash,
          height: tip.height -
            (cached.block.hashes.length -
            cached.block.hashes.indexOf(hash) - 1)
        }
        cached.block.col.splice(b, 1)
        col = txs
        break
      }
    }
    col.push(tx)
    cached.tx.hashes.push(tx.hash)
    if (cached.tx.hashes.length > HASH_BUFFER) {
      cached.tx.hashes.shift()
    }
  }

  var loading = new Throbber()
  loading.start('Scanning transactions...')

  pool.on('peerready', function (peer, addr) {
    peer.hash = addr.hash
    if (!loaderPeer && peer.bestHeight > tip.height) {
      loaderPeer = peer
      loaderPeer.sendMessage(new FilterLoad(filter))
      loaderPeer.getHeaders = function (hash) {
        this.sendMessage(new GetHeaders({
          starts: [hash],
          stops: new Array(33).join('0')
        }))
      }
      loaderPeer.getHeaders(tip.hash)
    }
  })

  pool.on('peerheaders', function (peer, message) {
    if (loaderPeer.hash !== peer.hash) {
      return
    }
    var headers = message.headers
    if (headers.length) {
      var inventories = []

      for (var header, h = 0, l = headers.length; h < l; h++) {
        header = headers[h]
        if (!header || !header.validProofOfWork()) {
          break
        }
        header.hexPrevHash = header.toObject().prevHash
        if (header.hexPrevHash === tip.hash.toString()) {
          tip = {
            hash: header.hash,
            height: tip.height + 1
          }
          cached.block.hashes.push(tip.hash)
          if (cached.block.hashes.length > HASH_BUFFER) {
            cached.block.hashes.shift()
          }
          inventories.push(new InventoryForFilteredBlock(header.hash))
        }
      }
      if (inventories.length) {
        loaderPeer.sendMessage(new GetData(inventories))
      }
    }
    if (headers.length && header) {
      return loaderPeer.getHeaders(tip.hash)
    }
    pool.disconnect()
    loading.stop()
    next(null, txs)
  })

  pool.on('peermerkleblock', function (peer, message) {
    pushBlock(message.merkleBlock)
  })

  pool.on('peertx', function (peer, message) {
    var script
    var tx = message.transaction
    var address
    if (cached.tx.hashes.indexOf(tx.hash) > -1) {
      return
    }
    for (var input, i = 0, il = tx.inputs.length; i < il; i++) {
      input = tx.inputs[i]
      if (!input.script) {
        break
      }
      script = input.script
      if (!script.isPublicKeyHashIn() && !script.isPublicKeyIn()) {
        break
      }
      address = input.script.toAddress(network).toString()
      if (filter.isRelevantAddress(address)) {
        pushTx(tx)
        break
      }
    }
    for (var output, o = 0, ol = tx.outputs.length; o < ol; o++) {
      output = tx.outputs[o]
      if (!output.script) {
        break
      }
      script = output.script
      if (!script.isPublicKeyHashOut() && !script.isPublicKeyOut()) {
        break
      }
      address = output.script.toAddress(network).toString()
      if (filter.isRelevantAddress(address)) {
        pushTx(tx)
        break
      }
    }
  })

  pool.on('error', function (err) {
    pool.disconnect()
    loading.stop()
    next(err)
  })

  pool.on('peerdisconnect', function (peer, err) {
    if (peer.getHeaders) {
      loaderPeer = null
    }
  })

  pool.connect()
}

module.exports = {
  Network: Network,
  main: bitcore.Networks.livenet,
  test: bitcore.Networks.testnet
}
