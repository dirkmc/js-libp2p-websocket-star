'use strict'

const SocketIO = require('socket.io')
const sp = require("../../socket-pull")

const noop = () => {}

module.exports = (config, http) => {
  const log = config.log
  const _log = log
  const io = new SocketIO(http.listener)
  io.on('connection', handle)

  const peers = {}

  this.peers = () => {
    return peers
  }

  function safeEmit(addr, event, arg) {
    const peer = peers[addr]
    if (!peer) {
      log('trying to emit %s but peer is gone', event)
      return
    }

    peer.emit(event, arg)
  }

  function handle(socket) {
    socket.on('ss-join', (ma, cb) => join(socket, ma, typeof cb == "function" ? cb : noop))
    socket.on('ss-leave', ma => leave(socket, ma))
    socket.on('disconnect', () => disconnect(socket)) // socket.io own event
    sp(socket)
    socket.on("ss-dial", (data, cb) => dialHandle(socket, data, cb))
  }

  // join this signaling server network
  function join(socket, multiaddr, cb) {
    //if (peers[multiaddr] && peers[multiaddr].id != socket.id) return cb("Already taken")
    peers[multiaddr] = socket // socket
    let refreshInterval = setInterval(sendPeers, config.refreshPeerListIntervalMS)

    socket.once('ss-leave', ma => {
      if (ma == multiaddr)
        stopSendingPeers()
    })
    socket.once('disconnect', stopSendingPeers)

    sendPeers()

    function sendPeers() {
      Object.keys(peers).forEach((mh) => {
        if (mh === multiaddr) {
          return
        }
        safeEmit(mh, 'ws-peer', multiaddr)
      })
    }

    function stopSendingPeers() {
      if (refreshInterval) {
        clearInterval(refreshInterval)
        refreshInterval = null
      }
    }

    cb()
  }

  function leave(socket, multiaddr) {
    if (peers[multiaddr]) {
      delete peers[multiaddr]
    }
  }

  function disconnect(socket) {
    Object.keys(peers).forEach((mh) => {
      if (peers[mh].id === socket.id) {
        delete peers[mh]
      }
    })
  }

  function dialHandle(socket, data, cb) {
    const to = data.dialTo
    const dialId = data.dialId
    const peer = peers[to]
    const log = _log.bind(_log, "[" + dialId + "]")
    log(data.dialFrom, "is dialing", to)
    if (!peer) return cb("Peer not found")
    socket.createProxy(dialId + ".dialer", peer)
    peer.emit("ss-incomming", {
      dialId,
      dialFrom: data.dialFrom
    }, err => {
      if (err) return cb(err)
      else {
        peer.createProxy(dialId + ".listener", socket)
        return cb()
      }
    })
  }

  return this
}
