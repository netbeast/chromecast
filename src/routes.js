var express = require('express')
var router = express.Router()
var mqtt = require('mqtt')
var async = require('async')

var client = mqtt.connect('ws://' + process.env.NETBEAST)

// Require the discovery function
var loadResources = require('./resources')

var values = {status: '', volume: '', track: ''}

var lastTrack

loadResources(function (err, devices) {
  if (err) return console.log(new Error(err))
  if (!devices || devices.length < 1) return false

  router.get('/chromecast/:id', function (req, res, next) {
    var device = devices.filter(function (elem) {
      if (elem.config.addresses[0] === req.params.id) return true
    })[0]

    if (device.length < 1) return res.status(404).send('Device not found')

    const actions = Object.keys(req.query).length ? req.query : values

    for (var key in req.query) {
      if (!values.hasOwnProperty(key)) delete actions[key]
    }

    if (!Object.keys(actions).length) return res.status(202).send('Values not available on this Chromecast')

    var connected = false
    device.connect()
    device.on('connected', function () {
      if (connected) return
      connected = true
      var result = {}
      device.getStatus(function (status) {
        if (!status) {
          result = {
            status: 'stop',
            volume: '',
            track: ''
          }
        } else {
          result = {
            status: status.volume.muted ? 'mute' : (status.playerState === 'PAUSED' ? 'pause' : 'play'),
            volume: status.volume.muted ? '0' : status.volume.level * 100,
            track: status.media.contentId
          }
        }
        const keys = Object.keys(actions) // serialize action keys
        var response = {}
        keys.forEach(function (key) {
          response[key] = result[key]
        })
        device.close()
        return res.json(response)
      })
    })
  })

  router.get('/discover', function (req, res, next) {
    loadResources(function (err, devices) {
      if (err) return res.status(500).send(err)
      return res.json(devices)
    })
  })

  router.post('/chromecast/:id', function (req, res, next) {
    var device = devices.filter(function (elem) {
      if (elem.config.addresses[0] === req.params.id) return true
    })[0]

    if (device.length < 1) return res.status(404).send('Device not found')

    var response = {}
    var connected = false

    function onConnect () {
      if (connected) return
      connected = true
      async.series([function play (done) {
        if (!req.body.track) return done() // nothing to do here
        if (req.body.status === 'stop' || req.body.status === 'pause') return done()
        device.play(req.body.track, 0, function (err, result) {
          if (err) return done(err)
          lastTrack = req.body.track
          response.track = req.body.track
          return done(null, result)
        })
      },
      function volume (done) {
        if (!req.body.volume || (req.body.status && req.body.status === 'mute')) return done()
        if (!lastTrack) {
          response.volume = ''
          return done()
        }
        device.setVolume(_parseVolume(req.body.volume), function (err, result) {
          if (err) return done(err)
          response.volume = req.body.volume
          return done(null, result)
        })
      },
      function status (done) {
        if (!req.body.status) return done() // nothing to do here
        if (!lastTrack) {
          response.status = 'stop'
          return done()
        }
        switch (req.body.status) {
          case 'play':
            device.getStatus(function (status) {
              if (status.playerState === 'PAUSED') {
                device.unpause()
                response.status = req.body.status
              } else if (!req.body.track && lastTrack) {
                device.play(lastTrack, 0, function (err, result) {
                  if (err) return done(err)
                  response.track = req.body.track
                  response.status = req.body.status
                  return done(null, result)
                })
              } else {
                return done(new Error('There is no content to play'))
              }
            })
            break
          case 'pause':
            device.stop(function (err, result) {
              if (err) return done(err)
              response.status = req.body.status
              return done(null, result)
            })
            break
          case 'stop':
            device.stop(function (err, result) {
              if (err) return done(err)
              response.status = req.body.status
              return done(null, result)
            })
            break
          case 'mute':
            device.setVolumeMuted(function (err, result) {
              if (err) return done(err)
              response.status = req.body.status
              return done(null, result)
            })
            break
          case 'unmute':
            device.setVolume(req.body.volume || 50, function (err, result) {
              if (err) return done(err)
              response.status = req.body.status
              response.volume = !req.body.volume ? 50 : req.body.volume
              return done(null, result)
            })
            break
          case 'info':
            device.getStatus(function (status) {
              response.status = status
            })
            break
        }
      }], function (err, results) {
        if (err) return res.status(500).send(err)
        client.publish('netbeast/video', JSON.stringify(response))
        return res.send(response)
      })
    }

    if (!device.client) {
      device.connect()
      device.on('connected', onConnect)
    } else onConnect()
  })
})

function _parseVolume (volume) {
  if (typeof volume === 'string') return volume
  volume = (volume < 0) ? 0 : volume
  volume = (volume > 100) ? 100 : volume
  volume /= 100

  return volume
}

// Used to serve the routes
module.exports = router
