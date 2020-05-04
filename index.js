const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);

const port = process.env.PORT || 4000;

const Web3 = require('web3');
const rpcURL = "wss://mainnet.infura.io/ws/v3/02432d2e0aaf408189f15435d8fd561e";
const web3 = new Web3(rpcURL);
const abi = [{"constant":true,"inputs":[],"name":"name","outputs":[{"name":"","type":"string"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_spender","type":"address"},{"name":"_value","type":"uint256"}],"name":"approve","outputs":[],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"totalSupply","outputs":[{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_from","type":"address"},{"name":"_to","type":"address"},{"name":"_value","type":"uint256"}],"name":"transferFrom","outputs":[],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"decimals","outputs":[{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"_who","type":"address"}],"name":"balanceOf","outputs":[{"name":"balance","type":"uint256"}],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"symbol","outputs":[{"name":"","type":"string"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_to","type":"address"},{"name":"_value","type":"uint256"}],"name":"transfer","outputs":[],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"_owner","type":"address"},{"name":"_spender","type":"address"}],"name":"allowance","outputs":[{"name":"remaining","type":"uint256"}],"payable":false,"type":"function"},{"anonymous":false,"inputs":[{"indexed":true,"name":"from","type":"address"},{"indexed":true,"name":"to","type":"address"},{"indexed":false,"name":"value","type":"uint256"}],"name":"Transfer","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"owner","type":"address"},{"indexed":true,"name":"spender","type":"address"},{"indexed":false,"name":"value","type":"uint256"}],"name":"Approval","type":"event"}];


// For obtaining historical data of the contract
app.get("/getHistory", function(req, res) {
  var contractAddr = req.query.chash;

  if (!web3.utils.isAddress(contractAddr)) {
    console.error('Incorrect address cannot get history ' + contractAddr);
    res.status(404).end();
    return; //??
  }
  
  var contract;
  try {
    contract = new web3.eth.Contract(abi, contractAddr);
  }
  catch(err) {
    console.error('Error while loading contract for history', err);
    return;
  }

  // here if contract address is valid (but possibly a user address)
  contract.getPastEvents("allEvents", { 
    fromBlock: 0 //9991160
    }, function (error, events) { 
      //console.log(events);
      if (typeof events !== 'undefined') {
        getTransactionData(events, function(results) {
          res.send(results);
        });
      } else {
        console.log("server failed at getting past events");
        res.status(204).end();
        return;
      }
  });
});

// Removes duplicates and returns tx data in an array 
async function getTransactionData(events, callback) {
  var seen = new Map();
  var output = new Array();
  
  for (var i = 0; i < events.length; i++) {
    if (seen.has(events[i].transactionHash)) {
    } else {
      seen.set(events[i].transactionHash, 1);  
      var tx = {};
      

      await web3.eth.getTransaction(events[i].transactionHash)
        .then(function(data) {
          tx.hash = data.hash;
          tx.blockNumber = data.blockNumber;
          tx.from = data.from;
          tx.to = data.to;
          tx.value = data.value/(10**18);
          tx.gasPrice = data.gasPrice;
        })
        .then(function() {
          //console.log(tx);
          output.push(tx);
        })
        //.then(function() {
        //  done();
        //});
    }
    //function done() {
    //  console.log(output);
    //  callback(output);
    //}
  }
  //console.log(output);
  callback(output);
}



// Serving static files
app.get("/result", function(req, res) {
  res.sendFile(__dirname + "/result.html");

  // For monitoring live updates on contract events 
  io.on('connection', (socket) => {
    socket.emit('hi', { hello: 'world' });

    // Client sends monitor request with contract address
    socket.on('contract', (data) => {
      // Check contract address validity and load
      const contractAddr = data.chash;
      if (!web3.utils.isAddress(contractAddr)) {
        console.error('Incorrect address ' + contractAddr);
        terminate();
        return; // ??
      }
      var contract;
      try {
        contract = new web3.eth.Contract(abi, contractAddr);
      }
      catch(err) {
        console.error('error encountered', err);
        return;
      }

      // Begin monitoring
      console.log('monitoring for tx ' + contractAddr);
      io.sockets.emit('monitoring start', {});
      var seen = new Map(); // to prevent duplicate tx hashes

      var em = contract.events.allEvents(); //event emitter
      em.on('data', (event) => { 
          if (seen.has(event.transactionHash)) {
          } else {
            seen.set(event.transactionHash, 1);
            getTransactionData([event], function(results) {
              io.sockets.emit('new tx', { message: results[0] });
            }); 
          }
        })
        .on('error', console.error); 

      socket.on('disconnect', (reason) => {
        socket.disconnect(true);
        socket.removeAllListeners();
        em.removeAllListeners();
        terminate();
        console.log('socket.io disconnected');
      });

    }); // socket.on('contract' ...

    function terminate() {
      socket.removeAllListeners();
      io.removeAllListeners();
    }
  }); // io.on('connect')
}); // app.get("/result" ...

app.get("/", function(req, res) {
  res.sendFile(__dirname + "/index.html");
});

//app.listen(port, () =>
//  console.log(`Server running at http://localhost:${port}`)
//);

const server = http.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
});
//module.exports.handler = serverless(http);