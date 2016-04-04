var request = require('request')
var chromecastjs = require('chromecast-js')

var browser = new chromecastjs.Browser()

var devices = []

module.exports = function (callback) {
  var objects = []
  // Request to the database
  request.get('http://' + process.env.NETBEAST + '/api/resources?app=chromecast',
  function (err, resp, body) {
    if (err) return callback(err, null)
    if (body) {
      body = JSON.parse(body)

      // Store the found devices in 'objects' array
      if (body.length > 0) {
        body.forEach(function (device) {
          if (objects.indexOf(device.hook) < 0) objects.push(device.hook)
        })
      }
    }
  })

  // Implement the device discovery method
  browser.on('deviceOn', function (device) {
      devices.push(device)

      var indx = objects.indexOf('/chromecast/' + device.config.addresses[0])

      if (indx >= 0) {
        objects.splice(indx, 1)
      } else {
        //  Use this block to register the found device on the netbeast database
        //  in order to using it later
        request.post({url: 'http://' + process.env.NETBEAST + '/api/resources',
        json: {
          app: 'chromecast',
          location: 'none',
          topic: 'video',
          groupname: 'none',
          hook: '/chromecast/' + device.config.addresses[0]
        }},
        function (err, resp, body) {
          if (err) return callback(err, null)
        })
      }
  })

  setTimeout(function () {
    if (objects.length > 0) {
      objects.forEach(function (hooks) {
        //  Use this block to delete a device from the netbeast database
        request.del('http://' + process.env.NETBEAST + '/api/resources?hook=' + hooks)
      })
    }
    callback(null, devices)
  }, 15000)
}
