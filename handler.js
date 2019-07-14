'use strict';

const AWS = require('aws-sdk');
const uuid = require('uuid/v4');
const fileType = require('file-type');
const rp = require('request-promise');
AWS.config.setPromisesDependency(require('bluebird'));

const s3BasePath = 'https://sumitaudios.s3-us-west-2.amazonaws.com/';

module.exports.uploadAudio = async (event, context) => {
  const dynamoDb = new AWS.DynamoDB.DocumentClient();
  var s3 = new AWS.S3();
  //console.log("body : " + event.body);
  var json = JSON.parse(event.body);
  const meetingOwnerEmail = json.meetingOwnerEmail || uuid() + "@gmail.com";
  console.log("meetingOwner Email: " + meetingOwnerEmail);
  const meetingId = json.meetingId;
  if (meetingId === null) {
    console.log("Meeting id is required");
    return {
      statusCode: 504,
      headers: {
        'Access-Control-Allow-Origin': '*' //probably only allow the AWS ec2 instance to access
      },
      body: JSON.stringify({ Error: "MeetingId is required in the body" }),
    };
  }
  console.log("meeting id: " + meetingId);

  //check if meetingId exists in dynamoDB
  var getItemParams = {
    TableName : process.env.ddbTable,
    Key: {
      MeetingId: meetingId
    }
  };

  let getItem = await dynamoDb.get(getItemParams).promise();
  
  if(getItem != null && Object.entries(getItem).length != 0){
    return {
      statusCode: 504,
      headers: {
        'Access-Control-Allow-Origin': '*' //probably only allow the AWS ec2 instance to access
      },
      body: JSON.stringify({ Error: "MeetingId already exists for this room. The audio/video is already submitted for processing." }),
    };
  }

  let base64String = json.file;
  let buffer = Buffer.from(base64String, 'base64');

  let fileMime = fileType(buffer);

  if (fileMime === null) {
    return context.fail("file type is not supported");
  }

  console.log("extension : " + fileMime.ext);

  var fileName = uuid() + '.' + fileMime.ext;

  var fileFullPath = s3BasePath + fileName;

  console.log('fileFullPath: ' + fileFullPath);

  console.log("MIME: " + fileMime.mime);

  var s3Params = {
    Bucket: 'sumitaudios',
    Key: fileName,
    Body: buffer,
    ContentType: fileMime.mime,
    ACL: 'public-read'
  };

  await s3.putObject(s3Params).promise();
  let audioRecord = {
    MeetingId: meetingId,
    MeetingOwnerEmail: meetingOwnerEmail,
    s3AudioFile: fileFullPath
  }
  await postToDDB(audioRecord,dynamoDb);
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*' //probably only allow the AWS ec2 instance to access
      },
      body: JSON.stringify({ uploadURL: fileFullPath }),
    }
};

let postToDDB = (audioRecord,dynamoDb) => {
  console.log('Submitting audioRecord' + JSON.stringify(audioRecord));
  console.log("table: " + process.env.ddbTable);
  const audioInfo = {
    TableName: process.env.ddbTable,
    Item: audioRecord,
  };
  return dynamoDb.put(audioInfo).promise()
    .then(res => audioInfo);
}

module.exports.summarize = (event, context, callback) => {
  const dynamoDb = new AWS.DynamoDB.DocumentClient();
  console.log("BODY sent : " + event.body);
  var json = JSON.parse(event.body);
  console.log('json: ' + json);
  var s3transcribedUrl = json.transcribeUrl;
  var meetingId = json.meetingId;

  console.log("transcribeUrl: " + s3transcribedUrl);
  if (s3transcribedUrl === null) {
    console.log('No s3 url passed');
    return context.fail("No s3 url passed");
  }

  var getJsonOptions = {
    uri: s3transcribedUrl,
    headers: {
      'User-Agent': 'Request-Promise'
    },
    json: true // Automatically parses the JSON string in the response
  };

  //read json transcribed object from s3
  rp(getJsonOptions)
    .then((s3transcribedJson) => {
      var transcript = s3transcribedJson.results.transcripts[0].transcript;
      console.log('json object: ' + transcript);
      return transcript;
    })
    .catch(function (err) {
      // API call failed...
      console.log("getting json transcribed failed, " + err);
    }).then((ts) => {
      var summarizeOptions = {
        uri: 'https://resoomer.pro/summarizer/',
        method: 'POST',
        headers: {
          'User-Agent': 'Super Agent/0.0.1',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        form: { 'API_KEY': '80F0D9B0265ABD0F98E33EB9316A578C', 'text': ts },
        json: true
      }

      // Start the request to get summary
      rp(summarizeOptions)
        .then((parsedBody) => {
          // POST succeeded...
          console.log("resoomer call successful, response: " + parsedBody);
          var summary = parsedBody.text.content.replace(/<[^>]*>/g, '');
          console.log("Summary: " + summary);

          const params = {
            TableName: process.env.ddbTable,
            Key: {
              MeetingId: meetingId,
            },
            ExpressionAttributeNames: {
              '#MS': 'MeetingSummary',
            },
            ExpressionAttributeValues: {
              ':summary': summary
            },
            UpdateExpression: 'SET #MS = :summary',
            ReturnValues: 'ALL_NEW',
          };

          //put parsedBody in dynamoDb
          dynamoDb.update(params).promise().then((res) => {
            console.log("Updated dynamo db with : " + res);
          }).catch((e) => {
            console.log("Exception updating ddb" + e);
            return context.fail('Failed to update dynamoDB with the summary, Error : ' + e);
          }).then(() => {
            callback(null, {
              statusCode: 200,
              headers: {
                'Access-Control-Allow-Origin': '*' //probably only allow the AWS ec2 instance to access
              },
              body: JSON.stringify({ result: "Updated dynamoDB with summary", summary: summary }),
            })
          })
        })
        .catch((err) => {
          // POST failed...
          console.log('resoomer call failed' + err);
          return context.fail('resoomer call failed' + err);
        });
    })
}

module.exports.getSummary = async (event, context) => {
  const dynamoDb = new AWS.DynamoDB.DocumentClient();
    var queryParams = event.queryStringParameters;
    console.log('params : ' + JSON.stringify(queryParams));
    var meetingId = queryParams.meetingId;
    if(meetingId === null){
      return {
        statusCode: 500,
        headers: {
          'Access-Control-Allow-Origin': '*' //probably only allow the AWS ec2 instance to access
        },
        body: JSON.stringify({ Error: "meetingId is required in the body" }),
      };
    }

    console.log("MEETING ID is " + meetingId);
    //check if meetingId exists in dynamoDB
  var getItemParams = {
    TableName : process.env.ddbTable,
    Key: {
      MeetingId: meetingId
    }
  };

  let getItem = await dynamoDb.get(getItemParams).promise();

  console.log("GETITEM: " + JSON.stringify(getItem));

  if(getItem === null || Object.entries(getItem).length === 0){
    return {
      statusCode: 504,
      headers: {
        'Access-Control-Allow-Origin': '*' //probably only allow the AWS ec2 instance to access
      },
      body: JSON.stringify({ Error: "MeetingId does not exist!" }),
    };
  }

  var entry = getItem.Item;

  var summary = entry.MeetingSummary;

  //has not finished processing
  if(summary === null){
    return {
      statusCode: 305,
      headers: {
        'Access-Control-Allow-Origin': '*' //probably only allow the AWS ec2 instance to access
      },
      body: JSON.stringify({ Result:  "Audio File has not yet finished processing, try again in some time." }),
    };
  }

  //need to put together symmaryJson + transcribedJson

  var s3TranscribedTextLink = entry.s3TranscribedTextLink;

  //assume this exists since summary is created from 
  var getJsonOptions = {
    uri: s3transcribedUrl,
    headers: {
      'User-Agent': 'Request-Promise'
    },
    json: true // Automatically parses the JSON string in the response
  };
  let s3transcribedJson = rp(getJsonOptions).promise();
  var transcript = s3transcribedJson.results.transcripts[0].transcript;

  var ObjectToReturn = {
    summary : summary,
    transcript : transcript, 
    timestamps : s3transcribedJson.results.items
  }

  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*' //probably only allow the AWS ec2 instance to access
    },
    body: JSON.stringify({ Result:  JSON.stringify(ObjectToReturn) }),
  };

    
}
