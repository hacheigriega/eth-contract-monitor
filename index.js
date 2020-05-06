// Server setup
const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const port = process.env.PORT || 9000;

// Web3 and other smart contract tools
const Web3 = require('web3');
const rpcURL = "wss://mainnet.infura.io/ws/v3/02432d2e0aaf408189f15435d8fd561e";
const web3 = new Web3(rpcURL);
const abi = [{"constant":true,"inputs":[],"name":"name","outputs":[{"name":"","type":"string"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_spender","type":"address"},{"name":"_value","type":"uint256"}],"name":"approve","outputs":[],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"totalSupply","outputs":[{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_from","type":"address"},{"name":"_to","type":"address"},{"name":"_value","type":"uint256"}],"name":"transferFrom","outputs":[],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"decimals","outputs":[{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"_who","type":"address"}],"name":"balanceOf","outputs":[{"name":"balance","type":"uint256"}],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"symbol","outputs":[{"name":"","type":"string"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_to","type":"address"},{"name":"_value","type":"uint256"}],"name":"transfer","outputs":[],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"_owner","type":"address"},{"name":"_spender","type":"address"}],"name":"allowance","outputs":[{"name":"remaining","type":"uint256"}],"payable":false,"type":"function"},{"anonymous":false,"inputs":[{"indexed":true,"name":"from","type":"address"},{"indexed":true,"name":"to","type":"address"},{"indexed":false,"name":"value","type":"uint256"}],"name":"Transfer","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"owner","type":"address"},{"indexed":true,"name":"spender","type":"address"},{"indexed":false,"name":"value","type":"uint256"}],"name":"Approval","type":"event"}];

const ABIDecoder = require('abi-decoder');
const ABISet = new Set(); //set of contracts whose ABIs we have in ABIDecoder

const getJSON = require('get-json');

// Database
const AWS = require("aws-sdk");
AWS.config.update({
  region: "us-east-1",
  endpoint: "http://localhost:8000"
});
const docClient = new AWS.DynamoDB.DocumentClient({
  convertEmptyValues: true
});
const table = "Transactions";


// Makes a partition key (contractAddr) based query
// Returns all txs in DB corresponding to the given contract
function queryDB(contractAddr) {
  var params = {
    TableName : table,
    KeyConditionExpression: '#ch = :chash',
    ExpressionAttributeNames:{
        '#ch': 'contractHash'
    },
    ExpressionAttributeValues: {
        ':chash': contractAddr
    }
  };

  return new Promise((resolve, reject) => {
    docClient.query(params, (error, data) => {
      if (error || data.Count == 0) {
        console.error('DB query failed for contract ' + contractAddr);
        reject(Error('DB query caused an error or did not return any results'));
      } else {
        console.log('DB query succeeded.');
        resolve(data);
      }
    });
  });
}

function contractLoader(abi, contractAddr) {
  return new Promise((resolve, reject) => {
    var contract = new web3.eth.Contract(abi, contractAddr);
    resolve(contract);
  })
}

//
function getHistoryData(contract) {
  return new Promise((resolve, reject) => {
    contract.getPastEvents("allEvents", { fromBlock: 0 })
      .then( (events) => {
        if (typeof events !== 'undefined') {
          resolve(events);
        } else {
          //console.log("server failed at getting past events");
          reject(events);
          res.status(204).end();
          return;
        }
    });
  })
}


// Responds to a URL query on tx history given a contract hash
app.get("/getHistory", async (req, res) => {
  var contractAddr = req.query.chash;

  // try querying our DB first
  // if exists, simply send data from DB (FIX: UPDATING DB)
  var loadedData;
  try {
    loadedData = await queryDB(contractAddr);
    var output = new Array();
    loadedData.Items.forEach((item) => {
      var tx = {};
      tx.hash = item.txHash;
      tx.input = item.input;
      tx.blockNumber = item.blockNumber;
      tx.timestamp = item.timestamp;
      tx.from = item.from;
      tx.to = item.to;
      tx.value = item.value;
      output.push(tx);
    });
    res.send(output);
    console.log('taken from db - no. of txs: ' + output.length);
    return;
  } catch(error) {
    console.error(error);
  }

  // quick address validity check
  if (!web3.utils.isAddress(contractAddr)) {
    console.error('Incorrect address cannot get history ' + contractAddr);
    res.status(404).end();
    return;
  }
  
  contractLoader(abi, contractAddr) //load contract
    .then(contract => getHistoryData(contract)) // get past events from web3
    .then(events => getTransactionData(events, contractAddr))
    .then(results => { 
      res.send(results); 
      console.log(results.length + ' data sent to front');
    })
    .catch((error) => { console.error('Error getting history ' + error); });
    //{ // populate tx data 
    //  getTransactionData(events, contractAddr, (results) => { res.send(results); });
    //});
});




// Enter tx data into database
function txToDatabase(tx, contractAddr) {
  var entry = {
    TableName: table,
    Item:{
      "contractHash": contractAddr,
      //"sortKey": tx.blockNumber + tx.hash,
      "sortKey": tx.blockNumber.pad(8) + tx.hash,
      "txHash": tx.hash,
      "blockNumber": tx.blockNumber,
      "timestamp": tx.timestamp,
      "from": tx.from,
      "to": tx.to,
      "value": tx.value, 
      "input": tx.input
    }//,
    //ReturnValues: "ALL_OLD"
  };

  docClient.put(entry, (err, data) => {
    if (err) {
      //console.error("Unable to add item to DB. Error JSON:", JSON.stringify(err, null, 2));
      console.error("Error while adding tx hash: " + tx.hash);
      console.error("tx blockNumber: " + tx.timestamp);
    } else {
      console.log("Added item to DB - tx: ", tx.hash);
      console.log("Added item to DB - contract: ", contractAddr);
      console.log("Added item to DB: ", JSON.stringify(data, null, 2));
    }
  });
}

function getABI(contractAddr) {
  if (ABISet.has(contractAddr)) {
    return;
  } else {
    ABISet.add(contractAddr);
    console.log('etherscan query for ' + contractAddr);
    return new Promise((resolve, reject) => {
      getJSON('http://api.etherscan.io/api?module=contract&action=getabi&address=' + contractAddr)
        .then((response) => {
          if (response.result != '') {
            console.log('response from etherscan ' + response + ' ' + response.result);
            ABIDecoder.addABI(eval(response.result));
            resolve();
          } else {
            console.log('Error while obtaining contract ABI for ' + contractAddr);
            reject();
          }
        })
        .catch((error) => {
            console.log('Error while obtaining abi ' + error);
            reject();
        });
    });
  } 
}

// Given a list of contractAddr and "events",
// removes returns a list of tx data (with duplicates removed)
async function getTransactionData(events, contractAddr) {

  return getABI(contractAddr) //get contract ABI if necessary
    .then(async () => {
      // Obtain tx data, disregard duplicates
      // To fix: Inefficient async structure?
      var seen = new Map();
      var seenBlock = new Map(); // blockNumber to timeStamp
      var output = new Array();
      for (var i = 0; i < events.length; i++) {
        if (!seen.has(events[i].transactionHash)) {
          seen.set(events[i].transactionHash, 1);  
          
          var tx = {};
          await web3.eth.getTransaction(events[i].transactionHash)
            .then((data) => {
              tx.input = ABIDecoder.decodeMethod(data.input); // to obtain info about invoked function
              tx.hash = data.hash;
              tx.blockNumber = data.blockNumber;
              tx.from = data.from;
              tx.to = data.to;
              tx.txIndex = data.transactionIndex;
              tx.value = data.value/(10**18);
            })
            .then(async () => {
              if (seenBlock.has(tx.blockNumber)) {
                tx.timestamp = seenBlock.get(tx.blockNumber);
              } else {
                await web3.eth.getBlock(tx.blockNumber)
                  .then(function(block) {
                    //console.log(block);
                    if (block) {
                      var time = block.timestamp;
                      var timec = new Date(time*1000);
                      var timeStamp = timec.toUTCString();
                      tx.timestamp = timeStamp;
                      seenBlock.set(tx.blockNumber, timeStamp);
                    } else {
                      tx.timestamp = null;
                    }
                  }); 
              }
              txToDatabase(tx, contractAddr);
              output.push(tx);
            });
        }
      } // for each event / tx
      
      return new Promise((resolve, reject) => {
        //console.log(output);
        console.log('here resolving ' + output.length)
        resolve(output);
      })
    })
}
  
  /*
  // Obtain the contract's ABI, if we don't have it already
  if (!ABISet.has(contractAddr)) {
    ABISet.add(contractAddr);
    console.log('etherscan query for ' + contractAddr);
    getJSON('http://api.etherscan.io/api?module=contract&action=getabi&address=' + contractAddr)
      .then(function(response) {
        if (response.result != '') {
          console.log('response from etherscan ' + response + ' ' + response.result);
          ABIDecoder.addABI(eval(response.result));
        } else {
          console.log('Error while obtaining contract ABI for ' + contractAddr);
        }
      }).catch(function(error) {
          //console.log(error);
          console.log('error while obtaining abi for ' + contractAddr);
      });  
  }
  ...

  callback(output);
  */



// For monitoring live updates on contract events 
io.on('connection', (socket) => {
  socket.emit('hi', { hello: 'world' });

  // Client sends monitor request with contract address
  socket.on('contract', (data) => {
    const contractAddr = data.chash;

    // quick address validity check
    if (!web3.utils.isAddress(contractAddr)) {
      console.error('Incorrect address ' + contractAddr);
      terminate();
      return;
    }

    var contract;
    try {
      contract = new web3.eth.Contract(abi, contractAddr);
    }
    catch(err) {
      console.error('error encountered', err);
      return;
    }

    // begin monitoring
    console.log('monitoring for tx ' + contractAddr);
    io.sockets.emit('monitoring start', {});

    var seen = new Map(); // to prevent duplicate tx hashes
    var em = contract.events.allEvents(); //event emitter
    em.on('data', (event) => { 
        if (seen.has(event.transactionHash)) {
        } else {
          seen.set(event.transactionHash, 1);
          getTransactionData([event], contractAddr, function(results) {
            io.sockets.emit('new tx', { message: results[0] });          
          });
        }
      })
      .on('error', console.error); 

    // make sure to properly terminate all socket.io connections
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
  }
}); // io.on('connect')



// Serving static files
app.get("/result", function(req, res) {
  res.sendFile(__dirname + "/result.html");
}); 

app.get("/", function(req, res) {
  res.sendFile(__dirname + "/index.html");
});

//app.listen(port, () =>
//  console.log(`Server running at http://localhost:${port}`)
//);
const server = http.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
});

// misc. tools
Number.prototype.pad = function(size) {
  var s = String(this);
  while (s.length < (size || 2)) {
    s = "0" + s;
  }
  return s;
}