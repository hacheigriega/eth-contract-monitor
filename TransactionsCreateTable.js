var AWS = require("aws-sdk");

AWS.config.update({
  region: "us-east-1c",
  endpoint: "http://localhost:8000"
});

// value attributes to store: blockNumber(N), timestamp(S), from(S), to(S), value(N), input(S)
var dynamodb = new AWS.DynamoDB();
var params = {
    TableName : "Transactions",
    KeySchema: [       
        { AttributeName: "contractHash", KeyType: "HASH"},  //Partition key
        { AttributeName: "sortKey", KeyType: "RANGE" }  //Sort key = tx.blockNumber + tx.hash
    ],
    
    AttributeDefinitions: [      
        { AttributeName: "contractHash", AttributeType: "S" },
        { AttributeName: "sortKey", AttributeType: "S" }  
    ],
    ProvisionedThroughput: {       
        ReadCapacityUnits: 10, 
        WriteCapacityUnits: 10
    }
};

dynamodb.createTable(params, function(err, data) {
    if (err) {
        console.error("Unable to create table. Error JSON:", JSON.stringify(err, null, 2));
    } else {
        console.log("Created table. Table description JSON:", JSON.stringify(data, null, 2));
    }
});